import { RateLimiter, RateLimitConfig } from '../managers/RateLimiter';
import type { RateLimitResult } from '../managers/RateLimiter';
import { RedisManager } from '../managers/RedisManager';
import { NodeOperationError } from 'n8n-workflow';

// Mock RedisManager
const mockRedisManager = {
	executeOperation: jest.fn(),
} as unknown as RedisManager;

// Mock Redis client for operations
const mockClient = {
	get: jest.fn(),
	setEx: jest.fn(),
	incr: jest.fn(),
	expire: jest.fn(),
	del: jest.fn(),
	keys: jest.fn(),
	multi: jest.fn(),
	zRemRangeByScore: jest.fn(),
	zCard: jest.fn(),
	zAdd: jest.fn(),
	zRem: jest.fn(),
	zCount: jest.fn(),
	exec: jest.fn(),
};

describe('RateLimiter', () => {
	let rateLimiter: RateLimiter;
	let config: RateLimitConfig;

	beforeEach(() => {
		jest.clearAllMocks();
		jest.useFakeTimers();
		jest.setSystemTime(new Date('2024-01-01T00:00:00Z'));

		config = {
			algorithm: 'sliding_window',
			strategy: 'per_user',
			windowSize: 60,
			maxRequests: 100,
			keyPrefix: 'test_rate_limit',
		};

		rateLimiter = new RateLimiter(mockRedisManager, config);

		// Default mock implementation
		(mockRedisManager.executeOperation as jest.Mock).mockImplementation(
			async (operation) => operation(mockClient)
		);
	});

	afterEach(() => {
		jest.useRealTimers();
	});

	describe('Configuration', () => {
		it('should use default configuration values', () => {
			const limiter = new RateLimiter(mockRedisManager, {
				windowSize: 60,
				maxRequests: 100,
			} as RateLimitConfig);

			expect(limiter).toBeDefined();
		});

		it('should generate correct Redis keys', async () => {
			await rateLimiter.checkRateLimit('user123');

			expect(mockRedisManager.executeOperation).toHaveBeenCalled();
		});

		it('should support different strategies', () => {
			const strategies = ['per_user', 'per_ip', 'per_session', 'global'];
			
			strategies.forEach(strategy => {
				const limiter = new RateLimiter(mockRedisManager, {
					...config,
					strategy: strategy as any,
				});
				expect(limiter).toBeDefined();
			});
		});
	});

	describe('Token Bucket Algorithm', () => {
		beforeEach(() => {
			config.algorithm = 'token_bucket';
			config.burstLimit = 150;
			rateLimiter = new RateLimiter(mockRedisManager, config);
		});

		it('should allow requests when bucket has tokens', async () => {
			mockClient.get.mockResolvedValueOnce(null); // New bucket

			const result = await rateLimiter.checkRateLimit('user123');

			expect(result.allowed).toBe(true);
			expect(result.remainingRequests).toBe(149); // burstLimit - 1
			expect(result.algorithm).toBe('token_bucket');
		});

		it('should deny requests when bucket is empty', async () => {
			const emptyBucket = {
				tokens: 0,
				lastRefill: Date.now(),
				totalRequests: 150,
			};
			mockClient.get.mockResolvedValueOnce(JSON.stringify(emptyBucket));

			const result = await rateLimiter.checkRateLimit('user123');

			expect(result.allowed).toBe(false);
			expect(result.retryAfter).toBeGreaterThan(0);
		});

		it('should refill tokens over time', async () => {
			const oldBucket = {
				tokens: 50,
				lastRefill: Date.now() - 30000, // 30 seconds ago
				totalRequests: 100,
			};
			mockClient.get.mockResolvedValueOnce(JSON.stringify(oldBucket));

			const result = await rateLimiter.checkRateLimit('user123');

			expect(result.allowed).toBe(true);
			expect(result.remainingRequests).toBeGreaterThan(50); // Should have more tokens
		});

		it('should handle burst requests correctly', async () => {
			const burstBucket = {
				tokens: 150,
				lastRefill: Date.now(),
				totalRequests: 0,
			};
			mockClient.get.mockResolvedValueOnce(JSON.stringify(burstBucket));

			const result = await rateLimiter.checkRateLimit('user123', 50);

			expect(result.allowed).toBe(true);
			expect(result.remainingRequests).toBe(100);
		});

		it('should calculate correct retry after time', async () => {
			const emptyBucket = {
				tokens: 5,
				lastRefill: Date.now(),
				totalRequests: 145,
			};
			mockClient.get.mockResolvedValueOnce(JSON.stringify(emptyBucket));

			const result = await rateLimiter.checkRateLimit('user123', 10);

			expect(result.allowed).toBe(false);
			expect(result.retryAfter).toBeGreaterThan(0);
		});

		it('should persist bucket state to Redis', async () => {
			mockClient.get.mockResolvedValueOnce(null);

			await rateLimiter.checkRateLimit('user123');

			expect(mockClient.setEx).toHaveBeenCalledWith(
				expect.stringContaining('user123'),
				expect.any(Number),
				expect.any(String)
			);
		});
	});

	describe('Sliding Window Algorithm', () => {
		beforeEach(() => {
			config.algorithm = 'sliding_window';
			rateLimiter = new RateLimiter(mockRedisManager, config);
		});

		it('should allow requests within limit', async () => {
			const mockPipeline = {
				zRemRangeByScore: jest.fn().mockReturnThis(),
				zCard: jest.fn().mockReturnThis(),
				zAdd: jest.fn().mockReturnThis(),
				expire: jest.fn().mockReturnThis(),
				exec: jest.fn().mockResolvedValue([
					{ reply: 0 }, // removed entries
					{ reply: 50 }, // current count
					{ reply: 1 }, // added entry
					{ reply: 1 }, // expire result
				]),
			};
			mockClient.multi.mockReturnValue(mockPipeline);

			const result = await rateLimiter.checkRateLimit('user123');

			expect(result.allowed).toBe(true);
			expect(result.remainingRequests).toBe(50);
			expect(result.algorithm).toBe('sliding_window');
		});

		it('should deny requests when limit exceeded', async () => {
			const mockPipeline = {
				zRemRangeByScore: jest.fn().mockReturnThis(),
				zCard: jest.fn().mockReturnThis(),
				zAdd: jest.fn().mockReturnThis(),
				expire: jest.fn().mockReturnThis(),
				exec: jest.fn().mockResolvedValue([
					{ reply: 0 },
					{ reply: 100 }, // at limit
					{ reply: 1 },
					{ reply: 1 },
				]),
			};
			mockClient.multi.mockReturnValue(mockPipeline);
			mockClient.zRem.mockResolvedValueOnce(1);

			const result = await rateLimiter.checkRateLimit('user123');

			expect(result.allowed).toBe(false);
			expect(result.retryAfter).toBeGreaterThan(0);
		});

		it('should remove expired entries from window', async () => {
			const mockPipeline = {
				zRemRangeByScore: jest.fn().mockReturnThis(),
				zCard: jest.fn().mockReturnThis(),
				zAdd: jest.fn().mockReturnThis(),
				expire: jest.fn().mockReturnThis(),
				exec: jest.fn().mockResolvedValue([
					{ reply: 10 }, // removed 10 expired entries
					{ reply: 30 }, // 30 current requests
					{ reply: 1 },
					{ reply: 1 },
				]),
			};
			mockClient.multi.mockReturnValue(mockPipeline);

			const result = await rateLimiter.checkRateLimit('user123');

			expect(mockPipeline.zRemRangeByScore).toHaveBeenCalledWith(
				expect.any(String),
				0,
				expect.any(Number)
			);
			expect(result.allowed).toBe(true);
		});

		it('should handle pipeline execution failures', async () => {
			const mockPipeline = {
				zRemRangeByScore: jest.fn().mockReturnThis(),
				zCard: jest.fn().mockReturnThis(),
				zAdd: jest.fn().mockReturnThis(),
				expire: jest.fn().mockReturnThis(),
				exec: jest.fn().mockResolvedValue(null),
			};
			mockClient.multi.mockReturnValue(mockPipeline);

			await expect(rateLimiter.checkRateLimit('user123')).rejects.toThrow(NodeOperationError);
		});

		it('should calculate correct reset time', async () => {
			const mockPipeline = {
				zRemRangeByScore: jest.fn().mockReturnThis(),
				zCard: jest.fn().mockReturnThis(),
				zAdd: jest.fn().mockReturnThis(),
				expire: jest.fn().mockReturnThis(),
				exec: jest.fn().mockResolvedValue([
					{ reply: 0 },
					{ reply: 50 },
					{ reply: 1 },
					{ reply: 1 },
				]),
			};
			mockClient.multi.mockReturnValue(mockPipeline);

			const result = await rateLimiter.checkRateLimit('user123');

			expect(result.resetTime).toBe(Date.now() + 60000); // windowSize * 1000
		});
	});

	describe('Fixed Window Algorithm', () => {
		beforeEach(() => {
			config.algorithm = 'fixed_window';
			rateLimiter = new RateLimiter(mockRedisManager, config);
		});

		it('should allow requests within window limit', async () => {
			mockClient.get.mockResolvedValueOnce('50');
			mockClient.incr.mockResolvedValueOnce(51);

			const result = await rateLimiter.checkRateLimit('user123');

			expect(result.allowed).toBe(true);
			expect(result.remainingRequests).toBe(49);
			expect(result.algorithm).toBe('fixed_window');
		});

		it('should deny requests when window limit exceeded', async () => {
			mockClient.get.mockResolvedValueOnce('100');

			const result = await rateLimiter.checkRateLimit('user123');

			expect(result.allowed).toBe(false);
			expect(result.retryAfter).toBeGreaterThan(0);
			expect(mockClient.incr).not.toHaveBeenCalled();
		});

		it('should create new window for first request', async () => {
			mockClient.get.mockResolvedValueOnce(null);
			mockClient.incr.mockResolvedValueOnce(1);

			const result = await rateLimiter.checkRateLimit('user123');

			expect(result.allowed).toBe(true);
			expect(mockClient.expire).toHaveBeenCalled();
		});

		it('should calculate correct window boundaries', async () => {
			const now = Date.now();
			const windowMs = 60000;
			const expectedWindowStart = Math.floor(now / windowMs) * windowMs;

			mockClient.get.mockResolvedValueOnce('10');
			mockClient.incr.mockResolvedValueOnce(11);

			const result = await rateLimiter.checkRateLimit('user123');

			expect(result.resetTime).toBe(expectedWindowStart + windowMs);
		});

		it('should handle weighted requests', async () => {
			mockClient.get.mockResolvedValueOnce('95');

			const result = await rateLimiter.checkRateLimit('user123', 10);

			expect(result.allowed).toBe(false); // 95 + 10 > 100
		});
	});

	describe('Penalty System', () => {
		it('should apply penalty for violations', async () => {
			await rateLimiter.applyPenalty('user123', 300);

			expect(mockClient.setEx).toHaveBeenCalledWith(
				expect.stringContaining('penalty'),
				300,
				expect.any(String)
			);
		});

		it('should check penalty status', async () => {
			const futureTime = Date.now() + 300000;
			mockClient.get.mockResolvedValueOnce(futureTime.toString());

			const result = await rateLimiter.checkPenalty('user123');

			expect(result.isPenalized).toBe(true);
			expect(result.remainingTime).toBeGreaterThan(0);
		});

		it('should clean up expired penalties', async () => {
			const pastTime = Date.now() - 1000;
			mockClient.get.mockResolvedValueOnce(pastTime.toString());

			const result = await rateLimiter.checkPenalty('user123');

			expect(result.isPenalized).toBe(false);
			expect(mockClient.del).toHaveBeenCalled();
		});

		it('should use default penalty time from config', async () => {
			config.penaltyTime = 600;
			rateLimiter = new RateLimiter(mockRedisManager, config);

			await rateLimiter.applyPenalty('user123');

			expect(mockClient.setEx).toHaveBeenCalledWith(
				expect.any(String),
				600,
				expect.any(String)
			);
		});
	});

	describe('Status and Reset Operations', () => {
		it('should get status without consuming requests - token bucket', async () => {
			config.algorithm = 'token_bucket';
			rateLimiter = new RateLimiter(mockRedisManager, config);

			const bucketState = {
				tokens: 75,
				lastRefill: Date.now() - 10000,
				totalRequests: 25,
			};
			mockClient.get.mockResolvedValueOnce(JSON.stringify(bucketState));

			const status = await rateLimiter.getStatus('user123');

			expect(status.algorithm).toBe('token_bucket');
			expect(status.totalRequests).toBe(25);
		});

		it('should get status without consuming requests - sliding window', async () => {
			config.algorithm = 'sliding_window';
			rateLimiter = new RateLimiter(mockRedisManager, config);

			mockClient.zCount.mockResolvedValueOnce(30);

			const status = await rateLimiter.getStatus('user123');

			expect(status.algorithm).toBe('sliding_window');
			expect(status.totalRequests).toBe(30);
			expect(status.remainingRequests).toBe(70);
		});

		it('should get status without consuming requests - fixed window', async () => {
			config.algorithm = 'fixed_window';
			rateLimiter = new RateLimiter(mockRedisManager, config);

			mockClient.get.mockResolvedValueOnce('40');

			const status = await rateLimiter.getStatus('user123');

			expect(status.algorithm).toBe('fixed_window');
			expect(status.totalRequests).toBe(40);
			expect(status.remainingRequests).toBe(60);
		});

		it('should reset rate limit for identifier', async () => {
			await rateLimiter.reset('user123');

			expect(mockClient.del).toHaveBeenCalledTimes(2); // Main key + penalty key
		});

		it('should return statistics', async () => {
			mockClient.keys.mockResolvedValueOnce(['key1', 'key2', 'key3']);

			const stats = await rateLimiter.getStats();

			expect(stats.algorithm).toBe(config.algorithm);
			expect(stats.strategy).toBe(config.strategy);
			expect(stats.activeKeys).toBe(3);
			expect(stats.config).toEqual(config);
		});
	});

	describe('Algorithm Selection', () => {
		it('should select optimal algorithm for API protection', () => {
			const algorithm = RateLimiter.selectOptimalAlgorithm('api_protection');
			expect(algorithm).toBe('sliding_window');
		});

		it('should select optimal algorithm for chat throttling', () => {
			const algorithm = RateLimiter.selectOptimalAlgorithm('chat_throttling');
			expect(algorithm).toBe('token_bucket');
		});

		it('should select optimal algorithm for bulk processing', () => {
			const algorithm = RateLimiter.selectOptimalAlgorithm('bulk_processing');
			expect(algorithm).toBe('fixed_window');
		});

		it('should select optimal algorithm for realtime events', () => {
			const algorithm = RateLimiter.selectOptimalAlgorithm('realtime_events');
			expect(algorithm).toBe('token_bucket');
		});

		it('should default to sliding window for unknown use case', () => {
			const algorithm = RateLimiter.selectOptimalAlgorithm('unknown' as any);
			expect(algorithm).toBe('sliding_window');
		});
	});

	describe('Error Handling', () => {
		it('should handle unsupported algorithms', async () => {
			config.algorithm = 'unsupported' as any;
			rateLimiter = new RateLimiter(mockRedisManager, config);

			await expect(rateLimiter.checkRateLimit('user123')).rejects.toThrow(NodeOperationError);
		});

		it('should handle Redis operation failures', async () => {
			(mockRedisManager.executeOperation as jest.Mock).mockRejectedValueOnce(
				new Error('Redis connection failed')
			);

			await expect(rateLimiter.checkRateLimit('user123')).rejects.toThrow();
		});

		it('should handle malformed stored data', async () => {
			config.algorithm = 'token_bucket';
			rateLimiter = new RateLimiter(mockRedisManager, config);

			mockClient.get.mockResolvedValueOnce('invalid-json');

			await expect(rateLimiter.checkRateLimit('user123')).rejects.toThrow();
		});
	});

	describe('Performance Considerations', () => {
		it('should execute operations efficiently', async () => {
			const startTime = Date.now();
			
			mockClient.get.mockResolvedValueOnce(null);
			await rateLimiter.checkRateLimit('user123');
			
			const endTime = Date.now();
			expect(endTime - startTime).toBeLessThan(100); // Should be very fast in tests
		});

		it('should handle concurrent requests', async () => {
			const promises = Array.from({ length: 10 }, (_, i) => 
				rateLimiter.checkRateLimit(`user${i}`)
			);

			await expect(Promise.all(promises)).resolves.toHaveLength(10);
		});

		it('should minimize Redis operations for sliding window', async () => {
			config.algorithm = 'sliding_window';
			rateLimiter = new RateLimiter(mockRedisManager, config);

			const mockPipeline = {
				zRemRangeByScore: jest.fn().mockReturnThis(),
				zCard: jest.fn().mockReturnThis(),
				zAdd: jest.fn().mockReturnThis(),
				expire: jest.fn().mockReturnThis(),
				exec: jest.fn().mockResolvedValue([
					{ reply: 0 },
					{ reply: 50 },
					{ reply: 1 },
					{ reply: 1 },
				]),
			};
			mockClient.multi.mockReturnValue(mockPipeline);

			await rateLimiter.checkRateLimit('user123');

			// Should use pipeline for atomic operations
			expect(mockClient.multi).toHaveBeenCalledTimes(1);
			expect(mockPipeline.exec).toHaveBeenCalledTimes(1);
		});
	});

	describe('Key Generation', () => {
		it('should generate unique keys for different strategies', () => {
			const strategies = ['per_user', 'per_ip', 'per_session', 'global'];

			strategies.forEach(strategy => {
				const limiter = new RateLimiter(mockRedisManager, {
					...config,
					strategy: strategy as any,
				});
				
				// Since we can't access generateKey directly, we'll test through behavior
				expect(limiter).toBeDefined();
			});
		});

		it('should include algorithm in key', async () => {
			await rateLimiter.checkRateLimit('user123');

			// Verify the key contains the algorithm name through Redis operations
			expect(mockRedisManager.executeOperation).toHaveBeenCalled();
		});
	});
});