/**
 * Pattern matching and event processing utilities for Redis Trigger
 */

// Redis Event Type Constants
export const REDIS_EVENT_TYPES = {
	SET: 'set',
	DEL: 'del', 
	EXPIRED: 'expired',
	EVICTED: 'evicted',
} as const;

export type RedisEventType = typeof REDIS_EVENT_TYPES[keyof typeof REDIS_EVENT_TYPES];

// Event Type Validation
export const VALID_EVENT_TYPES = Object.values(REDIS_EVENT_TYPES);

export interface EventTypeConfig {
	type: RedisEventType;
	description: string;
	category: 'data' | 'lifecycle' | 'system';
	frequency: 'high' | 'medium' | 'low';
}

export interface PatternValidationResult {
	isValid: boolean;
	error?: string;
	examples?: string[];
}

export interface PatternMatchResult {
	matches: boolean;
	capturedGroups?: string[];
}

/**
 * PatternMatcher utility class for glob pattern to regex conversion and matching
 */
export class PatternMatcher {
	private pattern: string;
	private regex: RegExp;
	private isCompiled: boolean = false;

	constructor(pattern: string) {
		this.pattern = pattern;
		this.regex = this.compilePattern(pattern);
		this.isCompiled = true;
	}

	/**
	 * Convert glob pattern to regex pattern
	 */
	private compilePattern(pattern: string): RegExp {
		// Escape regex special characters except * and ?
		let regexPattern = pattern
			.replace(/[.+^${}()|[\]\\]/g, '\\$&')  // Escape regex chars
			.replace(/\*/g, '([^:]*)')              // * matches any chars except :
			.replace(/\?/g, '([^:])')               // ? matches single char except :
			.replace(/\\\*\\\*/g, '(.*)');          // ** matches any chars including :

		return new RegExp(`^${regexPattern}$`);
	}

	/**
	 * Test if a key matches the pattern
	 */
	match(key: string): PatternMatchResult {
		if (!this.isCompiled) {
			return { matches: false };
		}

		const match = this.regex.exec(key);
		
		if (match) {
			return {
				matches: true,
				capturedGroups: match.slice(1), // Remove full match, keep captured groups
			};
		}

		return { matches: false };
	}

	/**
	 * Get the original pattern
	 */
	getPattern(): string {
		return this.pattern;
	}

	/**
	 * Get the compiled regex
	 */
	getRegex(): RegExp {
		return this.regex;
	}

	/**
	 * Validate a glob pattern
	 */
	static validatePattern(pattern: string): PatternValidationResult {
		if (!pattern || pattern.trim().length === 0) {
			return {
				isValid: false,
				error: 'Pattern cannot be empty',
			};
		}

		// Check for invalid characters
		const invalidChars = /[<>"|]/;
		if (invalidChars.test(pattern)) {
			return {
				isValid: false,
				error: 'Pattern contains invalid characters: < > " |',
			};
		}

		// Check for excessive wildcards
		const consecutiveStars = /\*{3,}/;
		if (consecutiveStars.test(pattern)) {
			return {
				isValid: false,
				error: 'Too many consecutive wildcards (*). Use ** for deep matching.',
			};
		}

		// Try to compile the pattern to check for regex errors
		try {
			new PatternMatcher(pattern);
		} catch (error) {
			return {
				isValid: false,
				error: `Invalid pattern: ${error instanceof Error ? error.message : 'Unknown error'}`,
			};
		}

		// Generate examples for valid patterns
		const examples = PatternMatcher.generateExamples(pattern);

		return {
			isValid: true,
			examples,
		};
	}

	/**
	 * Generate example keys that would match the pattern
	 */
	static generateExamples(pattern: string): string[] {
		const examples: string[] = [];

		// Simple pattern examples based on common patterns
		if (pattern === '*') {
			examples.push('user', 'session', 'cache');
		} else if (pattern === 'chatbot:*') {
			examples.push('chatbot:user123', 'chatbot:session456', 'chatbot:message789');
		} else if (pattern === 'user:*:data') {
			examples.push('user:john:data', 'user:alice:data', 'user:123:data');
		} else if (pattern === '*:messages') {
			examples.push('user:messages', 'session:messages', 'chat:messages');
		} else if (pattern.includes('**')) {
			examples.push(
				pattern.replace('**', 'deep/nested/path'), 
				pattern.replace('**', 'another/path')
			);
		} else {
			// Generate example by replacing wildcards
			let example = pattern;
			example = example.replace(/\*/g, 'example');
			example = example.replace(/\?/g, 'x');
			examples.push(example);
			
			// Add a variation
			let variation = pattern;
			variation = variation.replace(/\*/g, '123');
			variation = variation.replace(/\?/g, 'a');
			if (variation !== example) {
				examples.push(variation);
			}
		}

		return examples.slice(0, 3); // Limit to 3 examples
	}

	/**
	 * Test multiple keys against the pattern
	 */
	matchMultiple(keys: string[]): Array<{ key: string; result: PatternMatchResult }> {
		return keys.map(key => ({
			key,
			result: this.match(key),
		}));
	}

	/**
	 * Create a pattern matcher from multiple patterns (OR logic)
	 */
	static createMultiMatcher(patterns: string[]): MultiPatternMatcher {
		return new MultiPatternMatcher(patterns);
	}
}

/**
 * MultiPatternMatcher for matching against multiple patterns
 */
export class MultiPatternMatcher {
	private matchers: PatternMatcher[];

	constructor(patterns: string[]) {
		this.matchers = patterns.map(pattern => new PatternMatcher(pattern));
	}

	/**
	 * Test if a key matches any of the patterns
	 */
	match(key: string): PatternMatchResult & { matchedPattern?: string } {
		for (const matcher of this.matchers) {
			const result = matcher.match(key);
			if (result.matches) {
				return {
					...result,
					matchedPattern: matcher.getPattern(),
				};
			}
		}

		return { matches: false };
	}

	/**
	 * Get all patterns
	 */
	getPatterns(): string[] {
		return this.matchers.map(matcher => matcher.getPattern());
	}
}

/**
 * EventProcessor utility for processing Redis events
 */
export interface ProcessedEvent {
	eventType: string;
	key: string;
	value?: string;
	database: number;
	timestamp: number;
	metadata?: {
		pattern?: string;
		matchedGroups?: string[];
		processingTime?: number;
	};
}

export interface EventProcessorMetrics {
	totalProcessed: number;
	totalFiltered: number;
	totalErrors: number;
	averageProcessingTime: number;
	peakProcessingTime: number;
	queueOverflows: number;
	startTime: number;
	lastProcessedTime?: number;
	eventTypeCounts: Record<string, number>;
}

export interface ErrorRecoveryConfig {
	maxRetries: number;
	retryDelayMs: number;
	exponentialBackoff: boolean;
	circuitBreakerThreshold: number;
}

export class EventProcessor {
	private patternMatcher: PatternMatcher | MultiPatternMatcher;
	private eventQueue: ProcessedEvent[] = [];
	private maxQueueSize: number = 1000;
	private performanceMetrics: EventProcessorMetrics;
	private processingTimes: number[] = [];

	constructor(
		patterns: string | string[], 
		maxQueueSize: number = 1000,
		errorRecoveryConfig?: Partial<ErrorRecoveryConfig>
	) {
		this.maxQueueSize = maxQueueSize;
		
		if (Array.isArray(patterns)) {
			this.patternMatcher = PatternMatcher.createMultiMatcher(patterns);
		} else {
			this.patternMatcher = new PatternMatcher(patterns);
		}

		// Initialize performance metrics
		this.performanceMetrics = {
			totalProcessed: 0,
			totalFiltered: 0,
			totalErrors: 0,
			averageProcessingTime: 0,
			peakProcessingTime: 0,
			queueOverflows: 0,
			startTime: Date.now(),
			eventTypeCounts: {},
		};

		// Error recovery configuration passed but not stored (future enhancement)
	}

	/**
	 * Process a Redis event with metrics and error handling
	 */
	processEvent(eventData: {
		eventType: string;
		key: string;
		value?: string;
		database: number;
		timestamp: number;
	}): ProcessedEvent | null {
		const startTime = Date.now();
		
		try {
			// Check if event matches patterns
			const matchResult = this.patternMatcher.match(eventData.key);
			
			if (!matchResult.matches) {
				this.performanceMetrics.totalFiltered++;
				return null; // Event doesn't match, filter out
			}

			// Create processed event
			const processingTime = Date.now() - startTime;
			const processedEvent: ProcessedEvent = {
				...eventData,
				metadata: {
					matchedGroups: matchResult.capturedGroups,
					processingTime,
				},
			};

			// Add matched pattern info for multi-matcher
			if ('matchedPattern' in matchResult && typeof matchResult.matchedPattern === 'string') {
				processedEvent.metadata!.pattern = matchResult.matchedPattern;
			}

			// Update performance metrics
			this.updateMetrics(processedEvent, processingTime);

			// Add to queue
			this.addToQueue(processedEvent);

			return processedEvent;

		} catch (error) {
			this.performanceMetrics.totalErrors++;
			
			
			// Return null to filter out failed events
			return null;
		}
	}

	/**
	 * Update performance metrics
	 */
	private updateMetrics(event: ProcessedEvent, processingTime: number): void {
		this.performanceMetrics.totalProcessed++;
		this.performanceMetrics.lastProcessedTime = Date.now();
		
		// Track event type counts
		const eventType = event.eventType;
		this.performanceMetrics.eventTypeCounts[eventType] = 
			(this.performanceMetrics.eventTypeCounts[eventType] || 0) + 1;
		
		// Update processing times
		this.processingTimes.push(processingTime);
		
		// Keep only last 100 processing times for average calculation
		if (this.processingTimes.length > 100) {
			this.processingTimes.shift();
		}
		
		// Update peak processing time
		if (processingTime > this.performanceMetrics.peakProcessingTime) {
			this.performanceMetrics.peakProcessingTime = processingTime;
		}
		
		// Recalculate average processing time
		const sum = this.processingTimes.reduce((a, b) => a + b, 0);
		this.performanceMetrics.averageProcessingTime = sum / this.processingTimes.length;
	}

	/**
	 * Add event to processing queue with overflow tracking
	 */
	private addToQueue(event: ProcessedEvent): void {
		this.eventQueue.push(event);
		
		// Maintain queue size limit and track overflows
		if (this.eventQueue.length > this.maxQueueSize) {
			this.eventQueue.shift(); // Remove oldest event
			this.performanceMetrics.queueOverflows++;
		}
	}

	/**
	 * Get recent events from queue
	 */
	getRecentEvents(count: number = 10): ProcessedEvent[] {
		return this.eventQueue.slice(-count);
	}

	/**
	 * Clear the event queue
	 */
	clearQueue(): void {
		this.eventQueue = [];
	}

	/**
	 * Get queue statistics
	 */
	getQueueStats(): {
		currentSize: number;
		maxSize: number;
		oldestEventTimestamp?: number;
		newestEventTimestamp?: number;
	} {
		return {
			currentSize: this.eventQueue.length,
			maxSize: this.maxQueueSize,
			oldestEventTimestamp: this.eventQueue[0]?.timestamp,
			newestEventTimestamp: this.eventQueue[this.eventQueue.length - 1]?.timestamp,
		};
	}

	/**
	 * Get performance metrics
	 */
	getMetrics(): EventProcessorMetrics {
		return { ...this.performanceMetrics };
	}

	/**
	 * Reset performance metrics
	 */
	resetMetrics(): void {
		this.performanceMetrics = {
			totalProcessed: 0,
			totalFiltered: 0,
			totalErrors: 0,
			averageProcessingTime: 0,
			peakProcessingTime: 0,
			queueOverflows: 0,
			startTime: Date.now(),
			eventTypeCounts: {},
		};
		this.processingTimes = [];
	}

	/**
	 * Get comprehensive status report
	 */
	getStatusReport() {
		const uptime = Date.now() - this.performanceMetrics.startTime;
		const totalEvents = this.performanceMetrics.totalProcessed + this.performanceMetrics.totalFiltered;
		
		return {
			metrics: this.getMetrics(),
			queueStats: this.getQueueStats(),
			uptime,
			eventsPerSecond: totalEvents > 0 ? (totalEvents / (uptime / 1000)) : 0,
			errorRate: totalEvents > 0 ? (this.performanceMetrics.totalErrors / totalEvents) * 100 : 0,
		};
	}
}

/**
 * Utility functions for pattern testing and validation
 */
export class PatternUtils {
	/**
	 * Test a pattern against sample keys
	 */
	static testPattern(pattern: string, testKeys: string[]): {
		pattern: string;
		isValid: boolean;
		error?: string;
		matches: Array<{
			key: string;
			matches: boolean;
			capturedGroups?: string[];
		}>;
	} {
		const validation = PatternMatcher.validatePattern(pattern);
		
		if (!validation.isValid) {
			return {
				pattern,
				isValid: false,
				error: validation.error,
				matches: [],
			};
		}

		const matcher = new PatternMatcher(pattern);
		const matches = testKeys.map(key => {
			const result = matcher.match(key);
			return {
				key,
				matches: result.matches,
				capturedGroups: result.capturedGroups,
			};
		});

		return {
			pattern,
			isValid: true,
			matches,
		};
	}

	/**
	 * Get common Redis key patterns with descriptions
	 */
	static getCommonPatterns(): Array<{
		pattern: string;
		description: string;
		examples: string[];
	}> {
		return [
			{
				pattern: 'chatbot:*',
				description: 'All chatbot-related keys',
				examples: ['chatbot:user123', 'chatbot:session456', 'chatbot:config'],
			},
			{
				pattern: 'session:*:data',
				description: 'Session data for any user',
				examples: ['session:user1:data', 'session:guest:data'],
			},
			{
				pattern: 'user:*',
				description: 'All user-related keys',
				examples: ['user:john', 'user:alice', 'user:123'],
			},
			{
				pattern: '*:messages',
				description: 'Message keys for any entity',
				examples: ['user:messages', 'chat:messages', 'room:messages'],
			},
			{
				pattern: 'cache:*:*',
				description: 'Two-level cache keys',
				examples: ['cache:user:profile', 'cache:session:data'],
			},
			{
				pattern: 'temp:*',
				description: 'Temporary keys',
				examples: ['temp:upload123', 'temp:processing456'],
			},
		];
	}
}

/**
 * EventType utility for managing Redis event types
 */
export class EventTypeUtils {
	/**
	 * Get event type configurations with metadata
	 */
	static getEventTypeConfigs(): EventTypeConfig[] {
		return [
			{
				type: REDIS_EVENT_TYPES.SET,
				description: 'Key created or value updated',
				category: 'data',
				frequency: 'high',
			},
			{
				type: REDIS_EVENT_TYPES.DEL,
				description: 'Key explicitly deleted',
				category: 'data', 
				frequency: 'medium',
			},
			{
				type: REDIS_EVENT_TYPES.EXPIRED,
				description: 'Key expired due to TTL',
				category: 'lifecycle',
				frequency: 'medium',
			},
			{
				type: REDIS_EVENT_TYPES.EVICTED,
				description: 'Key evicted due to memory pressure',
				category: 'system',
				frequency: 'low',
			},
		];
	}

	/**
	 * Validate event types array
	 */
	static validateEventTypes(eventTypes: string[]): {
		isValid: boolean;
		error?: string;
		validTypes: RedisEventType[];
		invalidTypes: string[];
	} {
		if (!Array.isArray(eventTypes) || eventTypes.length === 0) {
			return {
				isValid: false,
				error: 'At least one event type must be selected',
				validTypes: [],
				invalidTypes: [],
			};
		}

		const validTypes: RedisEventType[] = [];
		const invalidTypes: string[] = [];

		for (const eventType of eventTypes) {
			if (VALID_EVENT_TYPES.includes(eventType as RedisEventType)) {
				validTypes.push(eventType as RedisEventType);
			} else {
				invalidTypes.push(eventType);
			}
		}

		if (invalidTypes.length > 0) {
			return {
				isValid: false,
				error: `Invalid event types: ${invalidTypes.join(', ')}. Valid types: ${VALID_EVENT_TYPES.join(', ')}`,
				validTypes,
				invalidTypes,
			};
		}

		return {
			isValid: true,
			validTypes,
			invalidTypes: [],
		};
	}

	/**
	 * Get recommended event type combinations
	 */
	static getRecommendedCombinations(): Array<{
		name: string;
		types: RedisEventType[];
		description: string;
		useCase: string;
	}> {
		return [
			{
				name: 'Data Changes Only',
				types: [REDIS_EVENT_TYPES.SET, REDIS_EVENT_TYPES.DEL],
				description: 'Monitor when data is created, updated, or deleted',
				useCase: 'Cache invalidation, data synchronization',
			},
			{
				name: 'All Key Operations',
				types: [REDIS_EVENT_TYPES.SET, REDIS_EVENT_TYPES.DEL, REDIS_EVENT_TYPES.EXPIRED, REDIS_EVENT_TYPES.EVICTED],
				description: 'Monitor all possible key state changes',
				useCase: 'Comprehensive monitoring, debugging',
			},
			{
				name: 'Lifecycle Events',
				types: [REDIS_EVENT_TYPES.EXPIRED, REDIS_EVENT_TYPES.EVICTED],
				description: 'Monitor when keys are removed automatically',
				useCase: 'Session cleanup, memory management',
			},
			{
				name: 'Write Operations',
				types: [REDIS_EVENT_TYPES.SET],
				description: 'Monitor only when keys are created or updated',
				useCase: 'Real-time data processing, notifications',
			},
		];
	}

	/**
	 * Map user-friendly event type to Redis notification event
	 */
	static mapToRedisNotification(eventType: RedisEventType): string {
		const eventMap: Record<RedisEventType, string> = {
			[REDIS_EVENT_TYPES.SET]: 'set',
			[REDIS_EVENT_TYPES.DEL]: 'del',
			[REDIS_EVENT_TYPES.EXPIRED]: 'expired',
			[REDIS_EVENT_TYPES.EVICTED]: 'evicted',
		};

		return eventMap[eventType] || eventType;
	}

	/**
	 * Get frequency-based filtering recommendations
	 */
	static getFrequencyRecommendations(): {
		high: RedisEventType[];
		medium: RedisEventType[];
		low: RedisEventType[];
	} {
		const configs = this.getEventTypeConfigs();
		
		return {
			high: configs.filter(c => c.frequency === 'high').map(c => c.type),
			medium: configs.filter(c => c.frequency === 'medium').map(c => c.type),
			low: configs.filter(c => c.frequency === 'low').map(c => c.type),
		};
	}
}