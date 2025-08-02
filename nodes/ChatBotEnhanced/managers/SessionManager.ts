import { RedisClientType } from 'redis';
import { NodeOperationError } from 'n8n-workflow';
import { RedisManager } from './RedisManager';

export interface SessionConfig {
	defaultTtl: number; // in seconds
	maxSessions: number;
	enableCleanup: boolean;
	cleanupInterval: number; // in seconds
	contextStorage: boolean;
	maxContextSize: number; // max items in context
	compression: boolean;
	keyPrefix?: string;
}

export interface SessionData {
	sessionId: string;
	userId?: string;
	channelId?: string;
	createdAt: number;
	lastActivity: number;
	messageCount: number;
	context: Record<string, any>;
	metadata: Record<string, any>;
	conversationHistory?: ConversationMessage[];
}

export interface ConversationMessage {
	message: string;
	timestamp: number;
	type: 'user' | 'bot' | 'system';
	metadata?: Record<string, any>;
}

export interface SessionStats {
	totalSessions: number;
	activeSessions: number;
	expiredSessions: number;
	averageMessageCount: number;
	oldestSession: number;
	newestSession: number;
}

export interface SessionCreateOptions {
	userId?: string;
	channelId?: string;
	initialContext?: Record<string, any>;
	customTtl?: number;
	metadata?: Record<string, any>;
}

export interface SessionUpdateOptions {
	message?: string;
	messageType?: 'user' | 'bot' | 'system';
	context?: Record<string, any>;
	metadata?: Record<string, any>;
	extendTtl?: boolean;
	customTtl?: number;
}

export class SessionManager {
	private redisManager: RedisManager;
	private config: SessionConfig;
	private keyPrefix: string;
	private cleanupTimer: NodeJS.Timeout | null = null;

	constructor(redisManager: RedisManager, config: Partial<SessionConfig> = {}) {
		this.redisManager = redisManager;
		this.config = {
			defaultTtl: 1800, // 30 minutes
			maxSessions: 10000,
			enableCleanup: true,
			cleanupInterval: 300, // 5 minutes
			contextStorage: true,
			maxContextSize: 100,
			compression: false,
			keyPrefix: 'session',
			...config,
		};
		this.keyPrefix = this.config.keyPrefix || 'session';

		if (this.config.enableCleanup) {
			this.startCleanupScheduler();
		}
	}

	/**
	 * Create a new session
	 */
	async createSession(
		sessionId: string,
		options: SessionCreateOptions = {}
	): Promise<SessionData> {
		const now = Date.now();
		
		const sessionData: SessionData = {
			sessionId,
			userId: options.userId,
			channelId: options.channelId,
			createdAt: now,
			lastActivity: now,
			messageCount: 0,
			context: options.initialContext || {},
			metadata: options.metadata || {},
		};

		if (this.config.contextStorage) {
			sessionData.conversationHistory = [];
		}

		const ttl = options.customTtl || this.config.defaultTtl;
		const key = this.generateSessionKey(sessionId);

		await this.redisManager.executeOperation(async (client) => {
			// Check if we're at max sessions limit
			if (this.config.maxSessions > 0) {
				await this.enforceSessionLimit(client);
			}

			const serializedData = this.serializeSession(sessionData);
			await client.setEx(key, ttl, serializedData);

			// Add to session index
			await this.addToSessionIndex(client, sessionId, now);
		});

		return sessionData;
	}

	/**
	 * Retrieve an existing session
	 */
	async getSession(sessionId: string): Promise<SessionData | null> {
		const key = this.generateSessionKey(sessionId);

		return this.redisManager.executeOperation(async (client) => {
			const data = await client.get(key);
			
			if (!data) {
				return null;
			}

			try {
				return this.deserializeSession(data);
			} catch (error) {
				console.warn(`Failed to deserialize session ${sessionId}:`, error.message);
				// Clean up corrupted session
				await client.del(key);
				return null;
			}
		});
	}

	/**
	 * Update an existing session
	 */
	async updateSession(
		sessionId: string,
		options: SessionUpdateOptions = {}
	): Promise<SessionData | null> {
		const key = this.generateSessionKey(sessionId);

		return this.redisManager.executeOperation(async (client) => {
			const existingData = await client.get(key);
			
			if (!existingData) {
				return null;
			}

			const sessionData = this.deserializeSession(existingData);
			const now = Date.now();

			// Update basic fields
			sessionData.lastActivity = now;
			
			if (options.message) {
				sessionData.messageCount++;
				
				// Add to conversation history if enabled
				if (this.config.contextStorage && sessionData.conversationHistory) {
					const message: ConversationMessage = {
						message: options.message,
						timestamp: now,
						type: options.messageType || 'user',
						metadata: options.metadata,
					};
					
					sessionData.conversationHistory.push(message);
					
					// Limit history size
					if (sessionData.conversationHistory.length > this.config.maxContextSize) {
						sessionData.conversationHistory = sessionData.conversationHistory
							.slice(-this.config.maxContextSize);
					}
				}
			}

			// Update context
			if (options.context) {
				Object.assign(sessionData.context, options.context);
				
				// Limit context size
				const contextKeys = Object.keys(sessionData.context);
				if (contextKeys.length > this.config.maxContextSize) {
					// Remove oldest context entries
					const sortedKeys = contextKeys.sort();
					const keysToRemove = sortedKeys.slice(0, contextKeys.length - this.config.maxContextSize);
					keysToRemove.forEach(key => delete sessionData.context[key]);
				}
			}

			// Update metadata
			if (options.metadata) {
				Object.assign(sessionData.metadata, options.metadata);
			}

			// Determine TTL
			let ttl = this.config.defaultTtl;
			if (options.customTtl) {
				ttl = options.customTtl;
			} else if (options.extendTtl !== false) {
				// Get current TTL and extend it
				const currentTtl = await client.ttl(key);
				if (currentTtl > 0) {
					ttl = Math.max(currentTtl, this.config.defaultTtl);
				}
			}

			// Store updated session
			const serializedData = this.serializeSession(sessionData);
			await client.setEx(key, ttl, serializedData);

			// Update session index
			await this.updateSessionIndex(client, sessionId, now);

			return sessionData;
		});
	}

	/**
	 * Delete a session
	 */
	async deleteSession(sessionId: string): Promise<boolean> {
		const key = this.generateSessionKey(sessionId);

		return this.redisManager.executeOperation(async (client) => {
			const pipeline = client.multi();
			
			pipeline.del(key);
			pipeline.zRem(this.getSessionIndexKey(), sessionId);
			
			const results = await pipeline.exec();
			return results && results[0] && (results[0] as any).reply === 1;
		});
	}

	/**
	 * Check if a session exists
	 */
	async sessionExists(sessionId: string): Promise<boolean> {
		const key = this.generateSessionKey(sessionId);

		return this.redisManager.executeOperation(async (client) => {
			const exists = await client.exists(key);
			return exists === 1;
		});
	}

	/**
	 * Get session TTL
	 */
	async getSessionTTL(sessionId: string): Promise<number> {
		const key = this.generateSessionKey(sessionId);

		return this.redisManager.executeOperation(async (client) => {
			return client.ttl(key);
		});
	}

	/**
	 * Extend session TTL
	 */
	async extendSession(sessionId: string, additionalTime: number): Promise<boolean> {
		const key = this.generateSessionKey(sessionId);

		return this.redisManager.executeOperation(async (client) => {
			const currentTtl = await client.ttl(key);
			
			if (currentTtl <= 0) {
				return false; // Session doesn't exist or has no expiry
			}

			const newTtl = currentTtl + additionalTime;
			await client.expire(key, newTtl);
			return true;
		});
	}

	/**
	 * Get all active sessions for a user
	 */
	async getUserSessions(userId: string): Promise<SessionData[]> {
		const pattern = `${this.keyPrefix}:*`;
		
		return this.redisManager.executeOperation(async (client) => {
			const keys = await client.keys(pattern);
			const sessions: SessionData[] = [];

			for (const key of keys) {
				try {
					const data = await client.get(key);
					if (data) {
						const session = this.deserializeSession(data);
						if (session.userId === userId) {
							sessions.push(session);
						}
					}
				} catch (error) {
					console.warn(`Failed to deserialize session from key ${key}:`, error.message);
				}
			}

			return sessions.sort((a, b) => b.lastActivity - a.lastActivity);
		});
	}

	/**
	 * Get session statistics
	 */
	async getStats(): Promise<SessionStats> {
		return this.redisManager.executeOperation(async (client) => {
			const indexKey = this.getSessionIndexKey();
			const now = Date.now();
			
			// Get all sessions from index
			const allSessions = await client.zRangeWithScores(indexKey, 0, -1);
			
			let totalMessages = 0;
			let expiredCount = 0;
			let oldestTime = now;
			let newestTime = 0;

			// Check each session
			for (const session of allSessions) {
				const sessionKey = this.generateSessionKey(session.value);
				const ttl = await client.ttl(sessionKey);
				
				if (ttl <= 0) {
					expiredCount++;
				} else {
					try {
						const data = await client.get(sessionKey);
						if (data) {
							const sessionData = this.deserializeSession(data);
							totalMessages += sessionData.messageCount;
							oldestTime = Math.min(oldestTime, sessionData.createdAt);
							newestTime = Math.max(newestTime, sessionData.createdAt);
						}
					} catch (error) {
						expiredCount++;
					}
				}
			}

			const activeSessions = allSessions.length - expiredCount;

			return {
				totalSessions: allSessions.length,
				activeSessions,
				expiredSessions: expiredCount,
				averageMessageCount: activeSessions > 0 ? totalMessages / activeSessions : 0,
				oldestSession: oldestTime === now ? 0 : oldestTime,
				newestSession: newestTime,
			};
		});
	}

	/**
	 * Clean up expired sessions
	 */
	async cleanup(): Promise<number> {
		return this.redisManager.executeOperation(async (client) => {
			const indexKey = this.getSessionIndexKey();
			const allSessions = await client.zRange(indexKey, 0, -1);
			
			let cleanedCount = 0;
			const expiredSessions: string[] = [];

			// Check each session for expiry
			for (const sessionId of allSessions) {
				const sessionKey = this.generateSessionKey(sessionId);
				const exists = await client.exists(sessionKey);
				
				if (!exists) {
					expiredSessions.push(sessionId);
					cleanedCount++;
				}
			}

			// Remove expired sessions from index
			if (expiredSessions.length > 0) {
				await client.zRem(indexKey, ...expiredSessions);
			}

			return cleanedCount;
		});
	}

	/**
	 * Start automatic cleanup scheduler
	 */
	private startCleanupScheduler(): void {
		if (this.cleanupTimer) {
			clearInterval(this.cleanupTimer);
		}

		this.cleanupTimer = setInterval(async () => {
			try {
				await this.cleanup();
			} catch (error) {
				console.warn('Session cleanup failed:', error.message);
			}
		}, this.config.cleanupInterval * 1000);
	}

	/**
	 * Stop cleanup scheduler
	 */
	stopCleanup(): void {
		if (this.cleanupTimer) {
			clearInterval(this.cleanupTimer);
			this.cleanupTimer = null;
		}
	}

	/**
	 * Force cleanup of all sessions (use with caution)
	 */
	async clearAllSessions(): Promise<number> {
		return this.redisManager.executeOperation(async (client) => {
			const pattern = `${this.keyPrefix}:*`;
			const keys = await client.keys(pattern);
			
			if (keys.length === 0) {
				return 0;
			}

			// Delete all session keys
			await client.del(...keys);
			
			// Clear session index
			await client.del(this.getSessionIndexKey());

			return keys.length;
		});
	}

	/**
	 * Generate Redis key for session
	 */
	private generateSessionKey(sessionId: string): string {
		return `${this.keyPrefix}:${sessionId}`;
	}

	/**
	 * Get session index key for tracking active sessions
	 */
	private getSessionIndexKey(): string {
		return `${this.keyPrefix}:index`;
	}

	/**
	 * Add session to index
	 */
	private async addToSessionIndex(client: RedisClientType, sessionId: string, timestamp: number): Promise<void> {
		const indexKey = this.getSessionIndexKey();
		await client.zAdd(indexKey, { score: timestamp, value: sessionId });
	}

	/**
	 * Update session in index
	 */
	private async updateSessionIndex(client: RedisClientType, sessionId: string, timestamp: number): Promise<void> {
		const indexKey = this.getSessionIndexKey();
		await client.zAdd(indexKey, { score: timestamp, value: sessionId });
	}

	/**
	 * Enforce maximum session limit
	 */
	private async enforceSessionLimit(client: RedisClientType): Promise<void> {
		const indexKey = this.getSessionIndexKey();
		const sessionCount = await client.zCard(indexKey);

		if (sessionCount >= this.config.maxSessions) {
			// Remove oldest sessions to make room
			const toRemove = sessionCount - this.config.maxSessions + 1;
			const oldestSessions = await client.zRange(indexKey, 0, toRemove - 1);

			for (const sessionId of oldestSessions) {
				const sessionKey = this.generateSessionKey(sessionId);
				await client.del(sessionKey);
			}

			// Remove from index
			await client.zRemRangeByRank(indexKey, 0, toRemove - 1);
		}
	}

	/**
	 * Serialize session data for storage
	 */
	private serializeSession(sessionData: SessionData): string {
		try {
			const data = this.config.compression
				? JSON.stringify(sessionData, null, 0) // Remove whitespace
				: JSON.stringify(sessionData, null, 2);
			
			return data;
		} catch (error) {
			throw new NodeOperationError(
				null as any,
				'Failed to serialize session data',
				{ cause: error }
			);
		}
	}

	/**
	 * Deserialize session data from storage
	 */
	private deserializeSession(data: string): SessionData {
		try {
			return JSON.parse(data);
		} catch (error) {
			throw new NodeOperationError(
				null as any,
				'Failed to deserialize session data',
				{ cause: error }
			);
		}
	}

	/**
	 * Get configuration
	 */
	getConfig(): SessionConfig {
		return { ...this.config };
	}

	/**
	 * Update configuration
	 */
	updateConfig(newConfig: Partial<SessionConfig>): void {
		this.config = { ...this.config, ...newConfig };
		
		// Restart cleanup if interval changed
		if (newConfig.cleanupInterval && this.config.enableCleanup) {
			this.startCleanupScheduler();
		}
		
		// Stop cleanup if disabled
		if (newConfig.enableCleanup === false) {
			this.stopCleanup();
		}
	}
}