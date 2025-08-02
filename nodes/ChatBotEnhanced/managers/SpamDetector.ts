import { NodeOperationError } from 'n8n-workflow';
import { RedisManager } from './RedisManager';
import * as crypto from 'crypto';

export type SpamDetectionType = 'disabled' | 'repeated' | 'flood' | 'pattern';
export type SpamAction = 'block' | 'delay' | 'mark';
export type PredefinedPattern = 'urls' | 'caps' | 'chars' | 'phones' | 'emails';

export interface SpamDetectionConfig {
	detectionType: SpamDetectionType;
	action: SpamAction;
	
	// Repeated text detection
	similarityThreshold?: number; // 10-100
	detectionTimeWindow?: number; // minutes
	
	// Flood protection
	floodMaxMessages?: number;
	floodTimeWindow?: number; // seconds
	
	// Pattern matching
	predefinedPatterns?: PredefinedPattern[];
	customRegexPattern?: string;
	
	// Action configuration
	extraDelayTime?: number; // seconds
	
	// General config
	keyPrefix?: string;
	userId: string;
	sessionId: string;
}

export interface SpamDetectionResult {
	isSpam: boolean;
	spamType: 'repeated' | 'flood' | 'pattern' | null;
	confidence: number; // 0-100
	matchedPattern?: string;
	actionTaken: 'blocked' | 'delayed' | 'marked' | 'allowed';
	additionalDelay?: number; // seconds
	timestamp: number;
	reason?: string;
}

export interface MessageHistory {
	content: string;
	hash: string;
	timestamp: number;
	similarity?: number;
}

export interface FloodState {
	count: number;
	windowStart: number;
	messages: number[]; // timestamps within window
}

export interface SpamTrackingState {
	userId: string;
	sessionId: string;
	messageHistory: MessageHistory[];
	floodState: FloodState;
	totalSpamDetected: number;
	lastSpamDetection: number;
	createdAt: number;
	updatedAt: number;
}

// Predefined spam detection patterns
export const PREDEFINED_PATTERNS = {
	urls: /https?:\/\/[^\s]+|www\.[^\s]+|[^\s]+\.(com|org|net|edu|gov|io|co|app)[^\s]*/gi,
	caps: /[A-Z]{5,}/g, // 5 or more consecutive capitals
	chars: /(.)\1{4,}/g, // 5 or more repeated characters
	phones: /(?:\+?1[-.\s]?)?\(?[0-9]{3}\)?[-.\s]?[0-9]{3}[-.\s]?[0-9]{4}/g,
	emails: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g
};

export class SpamDetector {
	private redisManager: RedisManager;
	private config: SpamDetectionConfig;
	private keyPrefix: string;

	constructor(redisManager: RedisManager, config: SpamDetectionConfig) {
		this.redisManager = redisManager;
		this.config = {
			// Default values
			similarityThreshold: 80,
			detectionTimeWindow: 5,
			floodMaxMessages: 5,
			floodTimeWindow: 30,
			extraDelayTime: 60,
			keyPrefix: 'spam',
			predefinedPatterns: [],
			...config
		};
		this.keyPrefix = this.config.keyPrefix!;
	}

	/**
	 * Detect spam in a message
	 */
	async detectSpam(messageContent: string): Promise<SpamDetectionResult> {
		if (this.config.detectionType === 'disabled') {
			return {
				isSpam: false,
				spamType: null,
				confidence: 0,
				actionTaken: 'allowed',
				timestamp: Date.now()
			};
		}

		try {
			const result = await this.redisManager.executeOperation(async (client) => {
				const trackingState = await this.getTrackingState(client);
				const currentTime = Date.now();

				// Check different spam detection types
				let detectionResult: SpamDetectionResult = {
					isSpam: false,
					spamType: null,
					confidence: 0,
					actionTaken: 'allowed',
					timestamp: currentTime
				};

				switch (this.config.detectionType) {
					case 'repeated':
						detectionResult = await this.detectRepeatedText(
							client, 
							messageContent, 
							trackingState, 
							currentTime
						);
						break;
					
					case 'flood':
						detectionResult = await this.detectFlood(
							client, 
							messageContent, 
							trackingState, 
							currentTime
						);
						break;
					
					case 'pattern':
						detectionResult = await this.detectPattern(
							client, 
							messageContent, 
							trackingState, 
							currentTime
						);
						break;
				}

				// Apply action if spam detected
				if (detectionResult.isSpam) {
					detectionResult = await this.applySpamAction(detectionResult);
					await this.updateSpamDetection(client, trackingState, detectionResult);
				}

				// Always update tracking state with new message
				await this.updateTrackingState(client, trackingState, messageContent, currentTime);

				return detectionResult;
			});

			return result;
		} catch (error) {
			throw new NodeOperationError(
				{} as any,
				`Spam detection failed: ${error.message}`
			);
		}
	}

	/**
	 * Detect repeated/similar text
	 */
	private async detectRepeatedText(
		client: any,
		messageContent: string,
		trackingState: SpamTrackingState,
		currentTime: number
	): Promise<SpamDetectionResult> {
		const messageHash = this.generateMessageHash(messageContent);
		const timeWindow = (this.config.detectionTimeWindow! * 60 * 1000); // Convert to ms
		const threshold = this.config.similarityThreshold! / 100; // Convert to decimal

		// Filter recent messages within time window
		const recentMessages = trackingState.messageHistory.filter(
			msg => currentTime - msg.timestamp <= timeWindow
		);

		// Check for exact duplicates first
		const exactMatch = recentMessages.find(msg => msg.hash === messageHash);
		if (exactMatch) {
			return {
				isSpam: true,
				spamType: 'repeated',
				confidence: 100,
				actionTaken: 'blocked',
				timestamp: currentTime,
				reason: 'Exact duplicate message detected'
			};
		}

		// Check for similar messages
		let maxSimilarity = 0;
		let mostSimilarMessage = '';

		for (const msg of recentMessages) {
			const similarity = this.calculateSimilarity(messageContent, msg.content);
			if (similarity > maxSimilarity) {
				maxSimilarity = similarity;
				mostSimilarMessage = msg.content;
			}
		}

		if (maxSimilarity >= threshold) {
			return {
				isSpam: true,
				spamType: 'repeated',
				confidence: Math.round(maxSimilarity * 100),
				actionTaken: 'blocked',
				timestamp: currentTime,
				reason: `Message similarity ${Math.round(maxSimilarity * 100)}% exceeds threshold ${Math.round(threshold * 100)}%`,
				matchedPattern: mostSimilarMessage.substring(0, 50) + '...'
			};
		}

		return {
			isSpam: false,
			spamType: null,
			confidence: Math.round(maxSimilarity * 100),
			actionTaken: 'allowed',
			timestamp: currentTime
		};
	}

	/**
	 * Detect message flooding
	 */
	private async detectFlood(
		client: any,
		messageContent: string,
		trackingState: SpamTrackingState,
		currentTime: number
	): Promise<SpamDetectionResult> {
		const windowSize = this.config.floodTimeWindow! * 1000; // Convert to ms
		const maxMessages = this.config.floodMaxMessages!;

		// Clean old messages outside window
		const windowStart = currentTime - windowSize;
		const messagesInWindow = trackingState.floodState.messages.filter(
			timestamp => timestamp >= windowStart
		);

		// Add current message
		messagesInWindow.push(currentTime);

		if (messagesInWindow.length > maxMessages) {
			return {
				isSpam: true,
				spamType: 'flood',
				confidence: Math.min(100, (messagesInWindow.length / maxMessages) * 100),
				actionTaken: 'blocked',
				timestamp: currentTime,
				reason: `${messagesInWindow.length} messages in ${this.config.floodTimeWindow}s exceeds limit of ${maxMessages}`
			};
		}

		return {
			isSpam: false,
			spamType: null,
			confidence: Math.round((messagesInWindow.length / maxMessages) * 100),
			actionTaken: 'allowed',
			timestamp: currentTime
		};
	}

	/**
	 * Detect pattern-based spam
	 */
	private async detectPattern(
		client: any,
		messageContent: string,
		trackingState: SpamTrackingState,
		currentTime: number
	): Promise<SpamDetectionResult> {
		const patterns = this.config.predefinedPatterns || [];
		
		// Check predefined patterns
		for (const patternType of patterns) {
			const pattern = PREDEFINED_PATTERNS[patternType];
			if (pattern.test(messageContent)) {
				return {
					isSpam: true,
					spamType: 'pattern',
					confidence: 95,
					actionTaken: 'blocked',
					timestamp: currentTime,
					reason: `Message matches predefined pattern: ${patternType}`,
					matchedPattern: patternType
				};
			}
		}

		// Check custom regex pattern
		if (this.config.customRegexPattern) {
			try {
				const customPattern = new RegExp(this.config.customRegexPattern, 'gi');
				if (customPattern.test(messageContent)) {
					return {
						isSpam: true,
						spamType: 'pattern',
						confidence: 90,
						actionTaken: 'blocked',
						timestamp: currentTime,
						reason: 'Message matches custom regex pattern',
						matchedPattern: this.config.customRegexPattern
					};
				}
			} catch (error) {
				// Invalid regex pattern - log and continue
				console.warn(`Invalid custom regex pattern: ${this.config.customRegexPattern}`);
			}
		}

		return {
			isSpam: false,
			spamType: null,
			confidence: 0,
			actionTaken: 'allowed',
			timestamp: currentTime
		};
	}

	/**
	 * Apply spam action based on configuration
	 */
	private async applySpamAction(result: SpamDetectionResult): Promise<SpamDetectionResult> {
		switch (this.config.action) {
			case 'block':
				result.actionTaken = 'blocked';
				break;
			
			case 'delay':
				result.actionTaken = 'delayed';
				result.additionalDelay = this.config.extraDelayTime;
				break;
			
			case 'mark':
				result.actionTaken = 'marked';
				break;
		}

		return result;
	}

	/**
	 * Get tracking state from Redis
	 */
	private async getTrackingState(client: any): Promise<SpamTrackingState> {
		const key = this.generateTrackingKey();
		const data = await client.get(key);
		
		if (data) {
			try {
				return JSON.parse(data);
			} catch (error) {
				console.warn(`Failed to parse spam tracking state: ${error.message}`);
			}
		}

		// Return default state
		const now = Date.now();
		return {
			userId: this.config.userId,
			sessionId: this.config.sessionId,
			messageHistory: [],
			floodState: {
				count: 0,
				windowStart: now,
				messages: []
			},
			totalSpamDetected: 0,
			lastSpamDetection: 0,
			createdAt: now,
			updatedAt: now
		};
	}

	/**
	 * Update tracking state in Redis
	 */
	private async updateTrackingState(
		client: any,
		state: SpamTrackingState,
		messageContent: string,
		timestamp: number
	): Promise<void> {
		const messageHash = this.generateMessageHash(messageContent);
		const maxHistorySize = 50; // Keep last 50 messages
		const timeWindow = (this.config.detectionTimeWindow! * 60 * 1000);

		// Add new message to history
		state.messageHistory.push({
			content: messageContent,
			hash: messageHash,
			timestamp
		});

		// Clean old messages from history
		state.messageHistory = state.messageHistory
			.filter(msg => timestamp - msg.timestamp <= timeWindow)
			.slice(-maxHistorySize);

		// Update flood state
		const floodWindow = this.config.floodTimeWindow! * 1000;
		state.floodState.messages = state.floodState.messages
			.filter(ts => timestamp - ts <= floodWindow);
		state.floodState.messages.push(timestamp);
		state.floodState.count = state.floodState.messages.length;

		state.updatedAt = timestamp;

		// Store updated state
		const key = this.generateTrackingKey();
		const ttl = Math.max(3600, this.config.detectionTimeWindow! * 60 * 2); // At least 1 hour, or 2x detection window
		
		await client.setEx(key, ttl, JSON.stringify(state));
	}

	/**
	 * Update spam detection statistics
	 */
	private async updateSpamDetection(
		client: any,
		state: SpamTrackingState,
		result: SpamDetectionResult
	): Promise<void> {
		state.totalSpamDetected++;
		state.lastSpamDetection = result.timestamp;
	}

	/**
	 * Calculate message similarity using simple algorithm
	 */
	private calculateSimilarity(text1: string, text2: string): number {
		// Normalize texts
		const normalize = (text: string) => text.toLowerCase().replace(/\s+/g, ' ').trim();
		const norm1 = normalize(text1);
		const norm2 = normalize(text2);

		if (norm1 === norm2) return 1.0;
		if (norm1.length === 0 || norm2.length === 0) return 0.0;

		// Simple Jaccard similarity with character n-grams
		const getCharNGrams = (text: string, n: number = 2): Set<string> => {
			const ngrams = new Set<string>();
			for (let i = 0; i <= text.length - n; i++) {
				ngrams.add(text.substring(i, i + n));
			}
			return ngrams;
		};

		const ngrams1 = getCharNGrams(norm1);
		const ngrams2 = getCharNGrams(norm2);

		// Calculate intersection and union
		const intersection = new Set([...ngrams1].filter(x => ngrams2.has(x)));
		const union = new Set([...ngrams1, ...ngrams2]);

		return intersection.size / union.size;
	}

	/**
	 * Generate message hash for duplicate detection
	 */
	private generateMessageHash(message: string): string {
		// Normalize message and create hash
		const normalized = message.toLowerCase().replace(/\s+/g, '').trim();
		return crypto.createHash('sha256').update(normalized).digest('hex').substring(0, 16);
	}

	/**
	 * Generate Redis key for tracking state
	 */
	private generateTrackingKey(): string {
		return `${this.keyPrefix}:track:${this.config.userId}:${this.config.sessionId}`;
	}

	/**
	 * Get spam statistics
	 */
	async getSpamStats(): Promise<{
		totalSpamDetected: number;
		lastSpamDetection: number;
		messageHistorySize: number;
		floodStateSize: number;
	}> {
		return this.redisManager.executeOperation(async (client) => {
			const state = await this.getTrackingState(client);
			return {
				totalSpamDetected: state.totalSpamDetected,
				lastSpamDetection: state.lastSpamDetection,
				messageHistorySize: state.messageHistory.length,
				floodStateSize: state.floodState.messages.length
			};
		});
	}

	/**
	 * Clear spam tracking data
	 */
	async clearSpamData(): Promise<boolean> {
		return this.redisManager.executeOperation(async (client) => {
			const key = this.generateTrackingKey();
			const result = await client.del(key);
			return result > 0;
		});
	}

	/**
	 * Update configuration
	 */
	updateConfig(newConfig: Partial<SpamDetectionConfig>): void {
		this.config = { ...this.config, ...newConfig };
	}

	/**
	 * Get current configuration
	 */
	getConfig(): SpamDetectionConfig {
		return { ...this.config };
	}
}