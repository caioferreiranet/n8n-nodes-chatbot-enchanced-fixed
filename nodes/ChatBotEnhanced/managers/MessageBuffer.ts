import { RedisClientType } from 'redis';
import { NodeOperationError } from 'n8n-workflow';
import { RedisManager } from './RedisManager';

export type BufferPattern = 'collect_send' | 'throttle' | 'batch' | 'priority';
export type FlushTrigger = 'time' | 'size' | 'manual' | 'priority';

export interface BufferConfig {
	pattern: BufferPattern;
	maxSize: number;
	flushInterval: number; // in seconds
	enableStreams: boolean;
	streamMaxLength?: number;
	priorityLevels?: number;
	keyPrefix?: string;
	enableCompression?: boolean;
	retentionTime?: number; // in seconds
}

export interface BufferedMessage {
	id: string;
	content: string;
	timestamp: number;
	priority?: number;
	metadata?: Record<string, any>;
	retryCount?: number;
	userId?: string;
	channelId?: string;
}

export interface BufferState {
	bufferId: string;
	pattern: BufferPattern;
	messages: BufferedMessage[];
	totalMessages: number;
	lastFlush: number;
	nextFlush: number;
	size: number;
	maxSize: number;
}

export interface FlushResult {
	flushedMessages: BufferedMessage[];
	remainingMessages: BufferedMessage[];
	trigger: FlushTrigger;
	flushTime: number;
	processingTime: number;
}

export interface BufferStats {
	totalBuffers: number;
	totalMessages: number;
	averageBufferSize: number;
	oldestMessage: number;
	newestMessage: number;
	flushesLast24h: number;
}

export interface StreamMessage {
	id: string;
	fields: Record<string, string>;
	timestamp: number;
}

export class MessageBuffer {
	private redisManager: RedisManager;
	private config: BufferConfig;
	private keyPrefix: string;
	private flushTimers: Map<string, NodeJS.Timeout> = new Map();
	private cancellationTokens: Map<string, boolean> = new Map();

	constructor(redisManager: RedisManager, config: Partial<BufferConfig> = {}) {
		this.redisManager = redisManager;
		this.config = {
			pattern: 'collect_send',
			maxSize: 100,
			flushInterval: 30,
			enableStreams: true,
			streamMaxLength: 10000,
			priorityLevels: 3,
			keyPrefix: 'buffer',
			enableCompression: false,
			retentionTime: 3600, // 1 hour
			...config,
		};
		this.keyPrefix = this.config.keyPrefix || 'buffer';
	}

	/**
	 * Add message to buffer
	 */
	async addMessage(
		bufferId: string,
		message: Omit<BufferedMessage, 'id' | 'timestamp'>
	): Promise<{ bufferId: string; messageId: string; shouldFlush: boolean }> {
		const messageId = this.generateMessageId();
		const timestamp = Date.now();

		const bufferedMessage: BufferedMessage = {
			id: messageId,
			timestamp,
			retryCount: 0,
			...message,
		};

		return this.redisManager.executeOperation(async (client) => {
			let shouldFlush = false;

			if (this.config.enableStreams) {
				// Use Redis Streams for better performance and persistence
				await this.addToStream(client, bufferId, bufferedMessage);
			}

			// Update buffer state
			const bufferState = await this.getOrCreateBufferState(client, bufferId);
			bufferState.messages.push(bufferedMessage);
			bufferState.totalMessages++;
			bufferState.size = this.calculateBufferSize(bufferState.messages);

			// Check flush conditions
			shouldFlush = await this.checkFlushConditions(bufferState);

			// Store updated buffer state
			await this.storeBufferState(client, bufferId, bufferState);

			// Schedule flush if needed
			if (shouldFlush) {
				await this.scheduleFlush(bufferId, 'size');
			} else {
				this.ensureTimerScheduled(bufferId, bufferState.nextFlush);
			}

			return {
				bufferId,
				messageId,
				shouldFlush,
			};
		});
	}

	/**
	 * Flush buffer manually
	 */
	async flush(bufferId: string, trigger: FlushTrigger = 'manual'): Promise<FlushResult> {
		return this.redisManager.executeOperation(async (client) => {
			const startTime = Date.now();
			const bufferState = await this.getBufferState(client, bufferId);

			if (!bufferState || bufferState.messages.length === 0) {
				return {
					flushedMessages: [],
					remainingMessages: [],
					trigger,
					flushTime: startTime,
					processingTime: 0,
				};
			}

			// Apply pattern-specific flushing logic
			const { flushedMessages, remainingMessages } = await this.applyFlushPattern(
				bufferState,
				trigger
			);

			// Update buffer state
			bufferState.messages = remainingMessages;
			bufferState.lastFlush = startTime;
			bufferState.nextFlush = startTime + (this.config.flushInterval * 1000);
			bufferState.size = this.calculateBufferSize(remainingMessages);

			await this.storeBufferState(client, bufferId, bufferState);

			// Clear timer for this buffer
			this.clearTimer(bufferId);

			// Log flush to streams if enabled
			if (this.config.enableStreams && flushedMessages.length > 0) {
				await this.logFlushToStream(client, bufferId, flushedMessages, trigger);
			}

			const processingTime = Date.now() - startTime;

			return {
				flushedMessages,
				remainingMessages,
				trigger,
				flushTime: startTime,
				processingTime,
			};
		});
	}

	/**
	 * Get buffer contents without flushing
	 */
	async getBuffer(bufferId: string): Promise<BufferState | null> {
		return this.redisManager.executeOperation(async (client) => {
			return this.getBufferState(client, bufferId);
		});
	}

	/**
	 * Clear buffer completely
	 */
	async clearBuffer(bufferId: string): Promise<boolean> {
		return this.redisManager.executeOperation(async (client) => {
			const bufferKey = this.generateBufferKey(bufferId);
			const streamKey = this.generateStreamKey(bufferId);

			const pipeline = client.multi();
			pipeline.del(bufferKey);
			
			if (this.config.enableStreams) {
				pipeline.del(streamKey);
			}

			const results = await pipeline.exec();
			
			// Clear any pending timers
			this.clearTimer(bufferId);
			this.cancellationTokens.set(bufferId, true);

			return results !== null;
		});
	}

	/**
	 * Get buffer statistics
	 */
	async getStats(): Promise<BufferStats> {
		return this.redisManager.executeOperation(async (client) => {
			const pattern = `${this.keyPrefix}:*`;
			const keys = await client.keys(pattern);
			
			let totalMessages = 0;
			let totalBufferSize = 0;
			let oldestMessage = Date.now();
			let newestMessage = 0;
			let validBuffers = 0;

			for (const key of keys) {
				try {
					const data = await client.get(key);
					if (data) {
						const bufferState: BufferState = JSON.parse(data);
						totalMessages += bufferState.messages.length;
						totalBufferSize += bufferState.size;
						validBuffers++;

						// Find oldest and newest messages
						for (const message of bufferState.messages) {
							oldestMessage = Math.min(oldestMessage, message.timestamp);
							newestMessage = Math.max(newestMessage, message.timestamp);
						}
					}
				} catch (error) {
					console.warn(`Failed to parse buffer state from key ${key}:`, error.message);
				}
			}

			// Get flush count from last 24 hours (if using streams)
			let flushesLast24h = 0;
			if (this.config.enableStreams) {
				const yesterday = Date.now() - (24 * 60 * 60 * 1000);
				const flushStreamKey = `${this.keyPrefix}:flushes`;
				
				try {
					const flushes = await client.xRange(flushStreamKey, yesterday, '+');
					flushesLast24h = flushes.length;
				} catch (error) {
					// Stream might not exist yet
				}
			}

			return {
				totalBuffers: validBuffers,
				totalMessages,
				averageBufferSize: validBuffers > 0 ? totalMessages / validBuffers : 0,
				oldestMessage: oldestMessage === Date.now() ? 0 : oldestMessage,
				newestMessage,
				flushesLast24h,
			};
		});
	}

	/**
	 * Cancel pending operations for a buffer
	 */
	cancelBuffer(bufferId: string): void {
		this.cancellationTokens.set(bufferId, true);
		this.clearTimer(bufferId);
	}

	/**
	 * Resume operations for a buffer
	 */
	resumeBuffer(bufferId: string): void {
		this.cancellationTokens.delete(bufferId);
	}

	/**
	 * Add message to Redis Stream
	 */
	private async addToStream(
		client: RedisClientType,
		bufferId: string,
		message: BufferedMessage
	): Promise<void> {
		const streamKey = this.generateStreamKey(bufferId);
		
		const fields: Record<string, string> = {
			messageId: message.id,
			content: message.content,
			timestamp: message.timestamp.toString(),
			priority: (message.priority || 0).toString(),
		};

		if (message.userId) fields.userId = message.userId;
		if (message.channelId) fields.channelId = message.channelId;
		if (message.metadata) fields.metadata = JSON.stringify(message.metadata);

		await client.xAdd(streamKey, '*', fields);

		// Trim stream if it gets too long
		if (this.config.streamMaxLength) {
			await client.xTrim(streamKey, 'MAXLEN', '~', this.config.streamMaxLength);
		}
	}

	/**
	 * Get or create buffer state
	 */
	private async getOrCreateBufferState(
		client: RedisClientType,
		bufferId: string
	): Promise<BufferState> {
		const existing = await this.getBufferState(client, bufferId);
		
		if (existing) {
			return existing;
		}

		const now = Date.now();
		return {
			bufferId,
			pattern: this.config.pattern,
			messages: [],
			totalMessages: 0,
			lastFlush: now,
			nextFlush: now + (this.config.flushInterval * 1000),
			size: 0,
			maxSize: this.config.maxSize,
		};
	}

	/**
	 * Get buffer state from Redis
	 */
	private async getBufferState(
		client: RedisClientType,
		bufferId: string
	): Promise<BufferState | null> {
		const key = this.generateBufferKey(bufferId);
		const data = await client.get(key);
		
		if (!data) {
			return null;
		}

		try {
			return JSON.parse(data);
		} catch (error) {
			console.warn(`Failed to parse buffer state for ${bufferId}:`, error.message);
			return null;
		}
	}

	/**
	 * Store buffer state to Redis
	 */
	private async storeBufferState(
		client: RedisClientType,
		bufferId: string,
		state: BufferState
	): Promise<void> {
		const key = this.generateBufferKey(bufferId);
		const ttl = this.config.retentionTime || 3600;
		
		const data = this.config.enableCompression
			? JSON.stringify(state, null, 0)
			: JSON.stringify(state, null, 2);

		await client.setEx(key, ttl, data);
	}

	/**
	 * Check if buffer should be flushed
	 */
	private async checkFlushConditions(state: BufferState): Promise<boolean> {
		const now = Date.now();

		// Size-based flush
		if (state.messages.length >= this.config.maxSize) {
			return true;
		}

		// Time-based flush
		if (now >= state.nextFlush) {
			return true;
		}

		// Priority-based flush (for priority pattern)
		if (this.config.pattern === 'priority') {
			const highPriorityMessages = state.messages.filter(
				msg => (msg.priority || 0) >= (this.config.priorityLevels! - 1)
			);
			if (highPriorityMessages.length > 0) {
				return true;
			}
		}

		return false;
	}

	/**
	 * Apply pattern-specific flushing logic
	 */
	private async applyFlushPattern(
		state: BufferState,
		trigger: FlushTrigger
	): Promise<{ flushedMessages: BufferedMessage[]; remainingMessages: BufferedMessage[] }> {
		switch (state.pattern) {
			case 'collect_send':
				// Send all messages, clear buffer
				return {
					flushedMessages: [...state.messages],
					remainingMessages: [],
				};

			case 'throttle':
				// Send oldest messages up to max size, keep rest
				const throttleCount = Math.min(state.messages.length, this.config.maxSize);
				return {
					flushedMessages: state.messages.slice(0, throttleCount),
					remainingMessages: state.messages.slice(throttleCount),
				};

			case 'batch':
				// Send in fixed batches
				const batchSize = Math.ceil(this.config.maxSize / 2);
				return {
					flushedMessages: state.messages.slice(0, batchSize),
					remainingMessages: state.messages.slice(batchSize),
				};

			case 'priority':
				// Sort by priority and send high priority first
				const sortedMessages = [...state.messages].sort(
					(a, b) => (b.priority || 0) - (a.priority || 0)
				);
				const priorityThreshold = this.config.priorityLevels! - 1;
				const highPriority = sortedMessages.filter(msg => (msg.priority || 0) >= priorityThreshold);
				const lowPriority = sortedMessages.filter(msg => (msg.priority || 0) < priorityThreshold);

				return {
					flushedMessages: highPriority,
					remainingMessages: lowPriority,
				};

			default:
				return {
					flushedMessages: [...state.messages],
					remainingMessages: [],
				};
		}
	}

	/**
	 * Schedule buffer flush
	 */
	private async scheduleFlush(bufferId: string, trigger: FlushTrigger): Promise<void> {
		// Clear existing timer
		this.clearTimer(bufferId);

		// Schedule immediate flush
		setImmediate(async () => {
			if (this.cancellationTokens.get(bufferId)) {
				return;
			}

			try {
				await this.flush(bufferId, trigger);
			} catch (error) {
				console.error(`Failed to flush buffer ${bufferId}:`, error.message);
			}
		});
	}

	/**
	 * Ensure timer is scheduled for buffer
	 */
	private ensureTimerScheduled(bufferId: string, nextFlushTime: number): void {
		if (this.flushTimers.has(bufferId)) {
			return; // Timer already scheduled
		}

		const now = Date.now();
		const delay = Math.max(0, nextFlushTime - now);

		const timer = setTimeout(async () => {
			this.flushTimers.delete(bufferId);
			
			if (this.cancellationTokens.get(bufferId)) {
				return;
			}

			try {
				await this.flush(bufferId, 'time');
			} catch (error) {
				console.error(`Failed to flush buffer ${bufferId} on timer:`, error.message);
			}
		}, delay);

		this.flushTimers.set(bufferId, timer);
	}

	/**
	 * Clear timer for buffer
	 */
	private clearTimer(bufferId: string): void {
		const timer = this.flushTimers.get(bufferId);
		if (timer) {
			clearTimeout(timer);
			this.flushTimers.delete(bufferId);
		}
	}

	/**
	 * Log flush event to stream
	 */
	private async logFlushToStream(
		client: RedisClientType,
		bufferId: string,
		flushedMessages: BufferedMessage[],
		trigger: FlushTrigger
	): Promise<void> {
		const flushStreamKey = `${this.keyPrefix}:flushes`;
		
		const fields: Record<string, string> = {
			bufferId,
			trigger,
			messageCount: flushedMessages.length.toString(),
			timestamp: Date.now().toString(),
		};

		await client.xAdd(flushStreamKey, '*', fields);

		// Trim flush log stream
		await client.xTrim(flushStreamKey, 'MAXLEN', '~', 1000);
	}

	/**
	 * Calculate buffer size in bytes (approximate)
	 */
	private calculateBufferSize(messages: BufferedMessage[]): number {
		return messages.reduce((size, message) => {
			return size + JSON.stringify(message).length;
		}, 0);
	}

	/**
	 * Generate unique message ID
	 */
	private generateMessageId(): string {
		return `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
	}

	/**
	 * Generate Redis key for buffer
	 */
	private generateBufferKey(bufferId: string): string {
		return `${this.keyPrefix}:${bufferId}`;
	}

	/**
	 * Generate Redis key for stream
	 */
	private generateStreamKey(bufferId: string): string {
		return `${this.keyPrefix}:stream:${bufferId}`;
	}

	/**
	 * Cleanup all timers (call when shutting down)
	 */
	cleanup(): void {
		// Clear all timers
		for (const [bufferId, timer] of this.flushTimers) {
			clearTimeout(timer);
		}
		this.flushTimers.clear();

		// Set all buffers as cancelled
		for (const bufferId of this.cancellationTokens.keys()) {
			this.cancellationTokens.set(bufferId, true);
		}
	}

	/**
	 * Get configuration
	 */
	getConfig(): BufferConfig {
		return { ...this.config };
	}

	/**
	 * Update configuration
	 */
	updateConfig(newConfig: Partial<BufferConfig>): void {
		this.config = { ...this.config, ...newConfig };
	}
}