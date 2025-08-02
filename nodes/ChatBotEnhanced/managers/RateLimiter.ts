import { RedisClientType } from 'redis';
import { NodeOperationError } from 'n8n-workflow';
import { RedisManager } from './RedisManager';

export type RateLimitAlgorithm = 'token_bucket' | 'sliding_window' | 'fixed_window';
export type RateLimitStrategy = 'per_user' | 'per_ip' | 'per_session' | 'global';

export interface RateLimitConfig {
	algorithm: RateLimitAlgorithm;
	strategy: RateLimitStrategy;
	windowSize: number; // in seconds
	maxRequests: number;
	burstLimit?: number; // for token bucket
	penaltyTime?: number; // in seconds
	keyPrefix?: string;
}

export interface RateLimitResult {
	allowed: boolean;
	remainingRequests: number;
	resetTime: number;
	totalRequests: number;
	retryAfter?: number; // seconds to wait before next request
	algorithm: RateLimitAlgorithm;
	strategy: RateLimitStrategy;
}

export interface TokenBucketState {
	tokens: number;
	lastRefill: number;
	totalRequests: number;
}

export interface SlidingWindowState {
	requests: number[];
	totalRequests: number;
}

export interface FixedWindowState {
	requests: number;
	windowStart: number;
	totalRequests: number;
}

export class RateLimiter {
	private redisManager: RedisManager;
	private config: RateLimitConfig;
	private keyPrefix: string;

	constructor(redisManager: RedisManager, config: RateLimitConfig) {
		this.redisManager = redisManager;
		this.config = {
			algorithm: 'sliding_window',
			strategy: 'per_user',
			keyPrefix: 'rate_limit',
			...config,
		};
		this.keyPrefix = this.config.keyPrefix || 'rate_limit';
	}

	/**
	 * Check if a request should be allowed based on rate limiting rules
	 */
	async checkRateLimit(
		identifier: string,
		requestWeight: number = 1
	): Promise<RateLimitResult> {
		const key = this.generateKey(identifier);
		
		return this.redisManager.executeOperation(async (client) => {
			switch (this.config.algorithm) {
				case 'token_bucket':
					return this.checkTokenBucket(client, key, requestWeight);
				case 'sliding_window':
					return this.checkSlidingWindow(client, key, requestWeight);
				case 'fixed_window':
					return this.checkFixedWindow(client, key, requestWeight);
				default:
					throw new NodeOperationError(
						null as any,
						`Unsupported rate limiting algorithm: ${this.config.algorithm}`
					);
			}
		});
	}

	/**
	 * Token Bucket Algorithm Implementation
	 * Allows bursts up to bucket capacity, then refills at constant rate
	 */
	private async checkTokenBucket(
		client: RedisClientType,
		key: string,
		requestWeight: number
	): Promise<RateLimitResult> {
		const now = Date.now();
		const windowMs = this.config.windowSize * 1000;
		const maxTokens = this.config.burstLimit || this.config.maxRequests;
		const refillRate = this.config.maxRequests / (this.config.windowSize * 1000); // tokens per ms

		// Get current bucket state
		const stateData = await client.get(key);
		let state: TokenBucketState;

		if (stateData) {
			state = JSON.parse(stateData);
			
			// Calculate tokens to add based on time elapsed
			const timePassed = now - state.lastRefill;
			const tokensToAdd = Math.floor(timePassed * refillRate);
			
			state.tokens = Math.min(maxTokens, state.tokens + tokensToAdd);
			state.lastRefill = now;
		} else {
			// Initialize new bucket
			state = {
				tokens: maxTokens,
				lastRefill: now,
				totalRequests: 0,
			};
		}

		// Check if request can be satisfied
		const allowed = state.tokens >= requestWeight;
		let retryAfter: number | undefined;

		if (allowed) {
			state.tokens -= requestWeight;
			state.totalRequests += requestWeight;
		} else {
			// Calculate retry after time
			const tokensNeeded = requestWeight - state.tokens;
			retryAfter = Math.ceil(tokensNeeded / refillRate / 1000);
		}

		// Store updated state with TTL
		const ttl = Math.ceil(windowMs / 1000) * 2; // TTL longer than window
		await client.setEx(key, ttl, JSON.stringify(state));

		// Calculate reset time (when bucket will be full again)
		const tokensToFill = maxTokens - state.tokens;
		const resetTime = now + Math.ceil(tokensToFill / refillRate);

		return {
			allowed,
			remainingRequests: Math.floor(state.tokens),
			resetTime,
			totalRequests: state.totalRequests,
			retryAfter,
			algorithm: 'token_bucket',
			strategy: this.config.strategy,
		};
	}

	/**
	 * Sliding Window Algorithm Implementation
	 * Maintains precise request count over rolling time window
	 */
	private async checkSlidingWindow(
		client: RedisClientType,
		key: string,
		requestWeight: number
	): Promise<RateLimitResult> {
		const now = Date.now();
		const windowMs = this.config.windowSize * 1000;
		const windowStart = now - windowMs;

		// Use Redis pipeline for atomic operations
		const pipeline = client.multi();

		// Remove expired entries
		pipeline.zRemRangeByScore(key, 0, windowStart);
		
		// Count current requests in window
		pipeline.zCard(key);
		
		// Add current request timestamp
		pipeline.zAdd(key, { score: now, value: `${now}-${Math.random()}` });
		
		// Set TTL for the key
		pipeline.expire(key, Math.ceil(windowMs / 1000) * 2);

		const results = await pipeline.exec();
		
		if (!results || results.length < 2) {
			throw new NodeOperationError(
				null as any,
				'Failed to execute sliding window rate limit check'
			);
		}

		const currentRequests = (results[1] as any).reply as number;
		const allowed = currentRequests < this.config.maxRequests;

		// If not allowed, remove the request we just added
		if (!allowed) {
			await client.zRem(key, `${now}-${Math.random()}`);
		}

		// Calculate reset time (when oldest request expires)
		const resetTime = now + windowMs;
		const retryAfter = allowed ? undefined : Math.ceil(windowMs / 1000);

		return {
			allowed,
			remainingRequests: Math.max(0, this.config.maxRequests - currentRequests),
			resetTime,
			totalRequests: currentRequests + (allowed ? 1 : 0),
			retryAfter,
			algorithm: 'sliding_window',
			strategy: this.config.strategy,
		};
	}

	/**
	 * Fixed Window Algorithm Implementation
	 * Simple counter that resets at fixed intervals
	 */
	private async checkFixedWindow(
		client: RedisClientType,
		key: string,
		requestWeight: number
	): Promise<RateLimitResult> {
		const now = Date.now();
		const windowMs = this.config.windowSize * 1000;
		const windowStart = Math.floor(now / windowMs) * windowMs;
		const windowKey = `${key}:${windowStart}`;

		// Get current window count
		const currentCount = await client.get(windowKey);
		const requests = currentCount ? parseInt(currentCount) : 0;

		const allowed = requests + requestWeight <= this.config.maxRequests;
		let newCount = requests;

		if (allowed) {
			// Increment counter
			newCount = await client.incr(windowKey);
			
			// Set TTL for window (only if it's a new key)
			if (newCount === 1) {
				await client.expire(windowKey, Math.ceil(windowMs / 1000));
			}
		}

		const resetTime = windowStart + windowMs;
		const retryAfter = allowed ? undefined : Math.ceil((resetTime - now) / 1000);

		return {
			allowed,
			remainingRequests: Math.max(0, this.config.maxRequests - newCount),
			resetTime,
			totalRequests: newCount,
			retryAfter,
			algorithm: 'fixed_window',
			strategy: this.config.strategy,
		};
	}

	/**
	 * Apply penalty for rate limit violations
	 */
	async applyPenalty(identifier: string, penaltyTime?: number): Promise<void> {
		if (!penaltyTime && !this.config.penaltyTime) {
			return;
		}

		const penaltyDuration = penaltyTime || this.config.penaltyTime!;
		const penaltyKey = `${this.generateKey(identifier)}:penalty`;

		await this.redisManager.executeOperation(async (client) => {
			await client.setEx(
				penaltyKey,
				penaltyDuration,
				(Date.now() + penaltyDuration * 1000).toString()
			);
		});
	}

	/**
	 * Check if identifier is currently under penalty
	 */
	async checkPenalty(identifier: string): Promise<{
		isPenalized: boolean;
		remainingTime?: number;
	}> {
		const penaltyKey = `${this.generateKey(identifier)}:penalty`;

		return this.redisManager.executeOperation(async (client) => {
			const penaltyEnd = await client.get(penaltyKey);
			
			if (!penaltyEnd) {
				return { isPenalized: false };
			}

			const endTime = parseInt(penaltyEnd);
			const now = Date.now();

			if (now >= endTime) {
				// Penalty expired, clean up
				await client.del(penaltyKey);
				return { isPenalized: false };
			}

			return {
				isPenalized: true,
				remainingTime: Math.ceil((endTime - now) / 1000),
			};
		});
	}

	/**
	 * Get current rate limit status without consuming requests
	 */
	async getStatus(identifier: string): Promise<RateLimitResult> {
		const key = this.generateKey(identifier);
		
		return this.redisManager.executeOperation(async (client) => {
			switch (this.config.algorithm) {
				case 'token_bucket':
					return this.getTokenBucketStatus(client, key);
				case 'sliding_window':
					return this.getSlidingWindowStatus(client, key);
				case 'fixed_window':
					return this.getFixedWindowStatus(client, key);
				default:
					throw new NodeOperationError(
						null as any,
						`Unsupported rate limiting algorithm: ${this.config.algorithm}`
					);
			}
		});
	}

	/**
	 * Reset rate limit for specific identifier
	 */
	async reset(identifier: string): Promise<void> {
		const key = this.generateKey(identifier);
		const penaltyKey = `${key}:penalty`;

		await this.redisManager.executeOperation(async (client) => {
			await client.del(key);
			await client.del(penaltyKey);
		});
	}

	/**
	 * Get rate limiting statistics
	 */
	async getStats(): Promise<{
		algorithm: RateLimitAlgorithm;
		strategy: RateLimitStrategy;
		config: RateLimitConfig;
		activeKeys: number;
	}> {
		const pattern = `${this.keyPrefix}:*`;
		
		return this.redisManager.executeOperation(async (client) => {
			const keys = await client.keys(pattern);
			
			return {
				algorithm: this.config.algorithm,
				strategy: this.config.strategy,
				config: this.config,
				activeKeys: keys.length,
			};
		});
	}

	/**
	 * Generate Redis key based on strategy
	 */
	private generateKey(identifier: string): string {
		return `${this.keyPrefix}:${this.config.strategy}:${this.config.algorithm}:${identifier}`;
	}

	/**
	 * Get token bucket status without consuming tokens
	 */
	private async getTokenBucketStatus(
		client: RedisClientType,
		key: string
	): Promise<RateLimitResult> {
		const stateData = await client.get(key);
		const now = Date.now();
		const maxTokens = this.config.burstLimit || this.config.maxRequests;

		if (!stateData) {
			return {
				allowed: true,
				remainingRequests: maxTokens,
				resetTime: now,
				totalRequests: 0,
				algorithm: 'token_bucket',
				strategy: this.config.strategy,
			};
		}

		const state: TokenBucketState = JSON.parse(stateData);
		const refillRate = this.config.maxRequests / (this.config.windowSize * 1000);
		const timePassed = now - state.lastRefill;
		const tokensToAdd = Math.floor(timePassed * refillRate);
		const currentTokens = Math.min(maxTokens, state.tokens + tokensToAdd);

		const tokensToFill = maxTokens - currentTokens;
		const resetTime = now + Math.ceil(tokensToFill / refillRate);

		return {
			allowed: currentTokens > 0,
			remainingRequests: Math.floor(currentTokens),
			resetTime,
			totalRequests: state.totalRequests,
			algorithm: 'token_bucket',
			strategy: this.config.strategy,
		};
	}

	/**
	 * Get sliding window status without adding requests
	 */
	private async getSlidingWindowStatus(
		client: RedisClientType,
		key: string
	): Promise<RateLimitResult> {
		const now = Date.now();
		const windowMs = this.config.windowSize * 1000;
		const windowStart = now - windowMs;

		// Count current requests in window
		const currentRequests = await client.zCount(key, windowStart, now);

		return {
			allowed: currentRequests < this.config.maxRequests,
			remainingRequests: Math.max(0, this.config.maxRequests - currentRequests),
			resetTime: now + windowMs,
			totalRequests: currentRequests,
			algorithm: 'sliding_window',
			strategy: this.config.strategy,
		};
	}

	/**
	 * Get fixed window status without incrementing counter
	 */
	private async getFixedWindowStatus(
		client: RedisClientType,
		key: string
	): Promise<RateLimitResult> {
		const now = Date.now();
		const windowMs = this.config.windowSize * 1000;
		const windowStart = Math.floor(now / windowMs) * windowMs;
		const windowKey = `${key}:${windowStart}`;

		const currentCount = await client.get(windowKey);
		const requests = currentCount ? parseInt(currentCount) : 0;

		const resetTime = windowStart + windowMs;

		return {
			allowed: requests < this.config.maxRequests,
			remainingRequests: Math.max(0, this.config.maxRequests - requests),
			resetTime,
			totalRequests: requests,
			algorithm: 'fixed_window',
			strategy: this.config.strategy,
		};
	}

	/**
	 * Auto-select optimal algorithm based on use case
	 */
	static selectOptimalAlgorithm(
		useCase: 'api_protection' | 'chat_throttling' | 'bulk_processing' | 'realtime_events'
	): RateLimitAlgorithm {
		switch (useCase) {
			case 'api_protection':
				return 'sliding_window'; // Most precise
			case 'chat_throttling':
				return 'token_bucket'; // Allows natural conversation bursts
			case 'bulk_processing':
				return 'fixed_window'; // Most efficient for high volume
			case 'realtime_events':
				return 'token_bucket'; // Good for event bursts
			default:
				return 'sliding_window';
		}
	}
}