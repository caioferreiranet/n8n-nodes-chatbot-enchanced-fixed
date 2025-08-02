import { RedisManager } from '../managers/RedisManager';
import { RateLimiter } from '../managers/RateLimiter';
import { SessionManager } from '../managers/SessionManager';
import { MessageBuffer } from '../managers/MessageBuffer';
import { MessageRouter } from '../managers/MessageRouter';
import { UserStorage } from '../managers/UserStorage';
import { AnalyticsTracker } from '../managers/AnalyticsTracker';

// Mock Redis client for performance testing
const createMockRedisClient = () => ({
	connect: jest.fn().mockResolvedValue(undefined),
	disconnect: jest.fn().mockResolvedValue(undefined),
	ping: jest.fn().mockResolvedValue('PONG'),
	get: jest.fn().mockResolvedValue('{"test": "data"}'),
	set: jest.fn().mockResolvedValue('OK'),
	setEx: jest.fn().mockResolvedValue('OK'),
	hSet: jest.fn().mockResolvedValue(1),
	hGetAll: jest.fn().mockResolvedValue({}),
	zAdd: jest.fn().mockResolvedValue(1),
	zRangeWithScores: jest.fn().mockResolvedValue([]),
	multi: jest.fn().mockReturnValue({
		exec: jest.fn().mockResolvedValue([]),
		hSet: jest.fn().mockReturnThis(),
		expire: jest.fn().mockReturnThis(),
		del: jest.fn().mockReturnThis(),
		zAdd: jest.fn().mockReturnThis(),
		zRem: jest.fn().mockReturnThis(),
		zRemRangeByScore: jest.fn().mockReturnThis(),
		zCard: jest.fn().mockReturnThis(),
	}),
	on: jest.fn(),
});

// Mock RedisManager for performance tests
const createMockRedisManager = () => {
	const mockClient = createMockRedisClient();
	return {
		executeOperation: jest.fn().mockImplementation(async (operation) => operation(mockClient)),
		isAvailable: jest.fn().mockReturnValue(true),
		connect: jest.fn().mockResolvedValue(undefined),
		cleanup: jest.fn().mockResolvedValue(undefined),
		getHealthStatus: jest.fn().mockReturnValue({
			isConnected: true,
			isReady: true,
			latency: 1,
			lastHealthCheck: Date.now(),
			connectionUptime: 60000,
			errorCount: 0,
		}),
	};
};

describe('Performance Tests', () => {
	let mockRedisManager: any;

	beforeEach(() => {
		jest.clearAllMocks();
		mockRedisManager = createMockRedisManager();
	});

	describe('Response Time Requirements', () => {
		describe('RateLimiter Performance', () => {
			it('should complete rate limit check within 100ms', async () => {
				const rateLimiter = new RateLimiter(mockRedisManager, {
					algorithm: 'sliding_window',
					strategy: 'per_user',
					windowSize: 60,
					maxRequests: 100,
				});

				const startTime = performance.now();
				await rateLimiter.checkRateLimit('user-123');
				const endTime = performance.now();

				expect(endTime - startTime).toBeLessThan(100);
			});

			it('should handle 1000 concurrent rate limit checks efficiently', async () => {
				const rateLimiter = new RateLimiter(mockRedisManager, {
					algorithm: 'token_bucket',
					strategy: 'per_user',
					windowSize: 60,
					maxRequests: 100,
				});

				const startTime = performance.now();
				const promises = Array.from({ length: 1000 }, (_, i) =>
					rateLimiter.checkRateLimit(`user-${i}`)
				);

				await Promise.all(promises);
				const endTime = performance.now();

				expect(endTime - startTime).toBeLessThan(5000); // 5 seconds for 1000 operations
				expect((endTime - startTime) / 1000).toBeLessThan(5); // Average < 5ms per operation
			});

			it('should perform efficiently with different algorithms', async () => {
				const algorithms = ['token_bucket', 'sliding_window', 'fixed_window'] as const;
				const results: Record<string, number> = {};

				for (const algorithm of algorithms) {
					const rateLimiter = new RateLimiter(mockRedisManager, {
						algorithm,
						strategy: 'per_user',
						windowSize: 60,
						maxRequests: 100,
					});

					const startTime = performance.now();
					await Promise.all(
						Array.from({ length: 100 }, () => rateLimiter.checkRateLimit('user-test'))
					);
					const endTime = performance.now();

					results[algorithm] = endTime - startTime;
					expect(endTime - startTime).toBeLessThan(1000); // < 1 second for 100 operations
				}

				// All algorithms should complete within reasonable time
				Object.values(results).forEach(time => {
					expect(time).toBeLessThan(1000);
				});
			});
		});

		describe('SessionManager Performance', () => {
			it('should complete session operations within 100ms', async () => {
				const sessionManager = new SessionManager(mockRedisManager, {
					defaultTtl: 1800,
					enableCleanup: false,
				});

				const startTime = performance.now();
				await sessionManager.createSession('session-123', { userId: 'user-123' });
				await sessionManager.getSession('session-123');
				await sessionManager.updateSession('session-123', { message: 'test' });
				const endTime = performance.now();

				expect(endTime - startTime).toBeLessThan(100);
			});

			it('should handle large conversation histories efficiently', async () => {
				const sessionManager = new SessionManager(mockRedisManager, {
					maxContextSize: 1000,
					enableCleanup: false,
				});

				// Mock a session with large conversation history
				mockRedisManager.executeOperation.mockImplementation(async (operation) => {
					const mockClient = createMockRedisClient();
					const largeHistory = Array.from({ length: 500 }, (_, i) => ({
						message: `Message ${i}`,
						timestamp: Date.now() - i * 1000,
						type: 'user' as const,
					}));

					mockClient.get.mockResolvedValue(JSON.stringify({
						sessionId: 'large-session',
						conversationHistory: largeHistory,
						messageCount: 500,
						context: {},
						metadata: {},
						createdAt: Date.now() - 60000,
						lastActivity: Date.now(),
					}));

					return operation(mockClient);
				});

				const startTime = performance.now();
				await sessionManager.updateSession('large-session', {
					message: 'New message',
					messageType: 'user',
				});
				const endTime = performance.now();

				expect(endTime - startTime).toBeLessThan(100);
			});
		});

		describe('MessageBuffer Performance', () => {
			it('should add messages to buffer within 50ms', async () => {
				const messageBuffer = new MessageBuffer(mockRedisManager, {
					pattern: 'collect_send',
					maxSize: 100,
					enableStreams: true,
				});

				const startTime = performance.now();
				await messageBuffer.addMessage('buffer-123', {
					content: 'Test message',
					userId: 'user-123',
				});
				const endTime = performance.now();

				expect(endTime - startTime).toBeLessThan(50);
			});

			it('should flush large batches efficiently', async () => {
				const messageBuffer = new MessageBuffer(mockRedisManager, {
					pattern: 'collect_send',
					maxSize: 1000,
					enableStreams: true,
				});

				// Pre-populate buffer (simulate internal state)
				const messages = Array.from({ length: 500 }, (_, i) => ({
					id: `msg-${i}`,
					content: `Message ${i}`,
					timestamp: Date.now() - i * 100,
				}));

				mockRedisManager.executeOperation.mockImplementation(async (operation) => {
					const mockClient = createMockRedisClient();
					mockClient.get.mockResolvedValue(JSON.stringify({
						bufferId: 'test-buffer',
						messages,
						totalMessages: 500,
						pattern: 'collect_send',
						lastFlush: Date.now() - 60000,
						nextFlush: Date.now() + 30000,
						size: messages.length * 50,
						maxSize: 1000,
					}));
					return operation(mockClient);
				});

				const startTime = performance.now();
				await messageBuffer.flush('test-buffer');
				const endTime = performance.now();

				expect(endTime - startTime).toBeLessThan(200); // Allow more time for large batches
			});
		});

		describe('MessageRouter Performance', () => {
			it('should route messages within 100ms', async () => {
				const messageRouter = new MessageRouter(mockRedisManager, {
					pattern: 'one_to_many',
					channels: ['channel-1', 'channel-2', 'channel-3'],
				});

				// Mock successful publishing
				mockRedisManager.executeOperation.mockImplementation(async (operation) => {
					const mockClient = createMockRedisClient();
					mockClient.publish = jest.fn().mockResolvedValue(2); // 2 subscribers
					return operation(mockClient);
				});

				const startTime = performance.now();
				await messageRouter.routeMessage({
					content: 'Test message',
					sourceChannel: 'input',
				});
				const endTime = performance.now();

				expect(endTime - startTime).toBeLessThan(100);
			});

			it('should handle complex routing rules efficiently', async () => {
				const messageRouter = new MessageRouter(mockRedisManager, {
					pattern: 'topic_based',
					channels: ['output'],
				});

				// Mock many routing rules
				const rules = Array.from({ length: 50 }, (_, i) => ({
					name: `rule-${i}`,
					condition: `contains:keyword${i}`,
					targetChannel: `channel-${i}`,
					priority: i,
					enabled: true,
				}));

				mockRedisManager.executeOperation.mockImplementation(async (operation) => {
					const mockClient = createMockRedisClient();
					const rulesData: Record<string, string> = {};
					rules.forEach(rule => {
						rulesData[rule.name] = JSON.stringify(rule);
					});
					mockClient.hGetAll.mockResolvedValue(rulesData);
					mockClient.publish = jest.fn().mockResolvedValue(1);
					return operation(mockClient);
				});

				const startTime = performance.now();
				await messageRouter.routeMessage({
					content: 'Test message with keyword25',
				});
				const endTime = performance.now();

				expect(endTime - startTime).toBeLessThan(100);
			});
		});

		describe('UserStorage Performance', () => {
			it('should store and retrieve data within 100ms', async () => {
				const userStorage = new UserStorage(mockRedisManager, {
					enableTypeDetection: true,
					enableCompression: false,
				});

				const testData = {
					profile: { name: 'John', age: 30 },
					preferences: { theme: 'dark', language: 'en' },
					history: Array.from({ length: 100 }, (_, i) => `item-${i}`),
				};

				const startTime = performance.now();
				await userStorage.store('user-123', 'complex-data', testData);
				await userStorage.retrieve('user-123', 'complex-data');
				const endTime = performance.now();

				expect(endTime - startTime).toBeLessThan(100);
			});

			it('should handle large datasets efficiently', async () => {
				const userStorage = new UserStorage(mockRedisManager, {
					enableIndexing: true,
					maxValueSize: 10 * 1024 * 1024, // 10MB
				});

				// Create a large but valid dataset
				const largeData = {
					records: Array.from({ length: 1000 }, (_, i) => ({
						id: i,
						data: `Record ${i}`.repeat(10), // Make each record reasonably sized
					})),
				};

				const startTime = performance.now();
				await userStorage.store('user-123', 'large-dataset', largeData);
				const endTime = performance.now();

				expect(endTime - startTime).toBeLessThan(500); // Allow more time for large data
			});
		});

		describe('AnalyticsTracker Performance', () => {
			it('should record metrics within 50ms', async () => {
				const analyticsTracker = new AnalyticsTracker(mockRedisManager, {
					enableRealTimeMetrics: false, // Direct storage for performance test
					enableHistograms: true,
				});

				const startTime = performance.now();
				await analyticsTracker.recordMetric('test.metric', 100, 'gauge', {
					service: 'test',
					version: '1.0',
				});
				const endTime = performance.now();

				expect(endTime - startTime).toBeLessThan(50);
			});

			it('should handle high-frequency metrics efficiently', async () => {
				const analyticsTracker = new AnalyticsTracker(mockRedisManager, {
					enableRealTimeMetrics: true,
					batchSize: 100,
					flushInterval: 1,
				});

				const startTime = performance.now();
				const promises = Array.from({ length: 1000 }, (_, i) =>
					analyticsTracker.recordMetric(`metric.${i % 10}`, i, 'counter')
				);

				await Promise.all(promises);
				const endTime = performance.now();

				expect(endTime - startTime).toBeLessThan(2000); // 2 seconds for 1000 metrics
				expect((endTime - startTime) / 1000).toBeLessThan(2); // Average < 2ms per metric
			});

			it('should query large metric datasets efficiently', async () => {
				const analyticsTracker = new AnalyticsTracker(mockRedisManager);

				// Mock large metrics dataset
				const largeMetricsData: Record<string, string> = {};
				for (let i = 0; i < 10000; i++) {
					largeMetricsData[`metric-${i}`] = JSON.stringify({
						name: `metric-${i % 100}`,
						type: 'counter',
						value: i,
						timestamp: Date.now() - i * 1000,
					});
				}

				mockRedisManager.executeOperation.mockImplementation(async (operation) => {
					const mockClient = createMockRedisClient();
					mockClient.keys.mockResolvedValue(['analytics:metrics:2024010100']);
					mockClient.hGetAll.mockResolvedValue(largeMetricsData);
					return operation(mockClient);
				});

				const startTime = performance.now();
				await analyticsTracker.queryMetrics({
					name: 'metric-50',
					aggregation: 'avg',
					interval: 3600,
				});
				const endTime = performance.now();

				expect(endTime - startTime).toBeLessThan(1000); // 1 second for large query
			});
		});
	});

	describe('Memory Usage', () => {
		it('should not cause memory leaks during intensive operations', async () => {
			const initialMemory = process.memoryUsage().heapUsed;

			// Perform intensive operations
			const operations = Array.from({ length: 100 }, async () => {
				const rateLimiter = new RateLimiter(mockRedisManager);
				const sessionManager = new SessionManager(mockRedisManager);
				const messageBuffer = new MessageBuffer(mockRedisManager);

				await rateLimiter.checkRateLimit('test-user');
				await sessionManager.createSession('test-session');
				await messageBuffer.addMessage('test-buffer', { content: 'test' });
			});

			await Promise.all(operations);

			// Force garbage collection if available
			if (global.gc) {
				global.gc();
			}

			const finalMemory = process.memoryUsage().heapUsed;
			const memoryIncrease = finalMemory - initialMemory;

			// Memory increase should be reasonable (less than 50MB)
			expect(memoryIncrease).toBeLessThan(50 * 1024 * 1024);
		});

		it('should efficiently handle large data structures', async () => {
			const userStorage = new UserStorage(mockRedisManager);

			// Create progressively larger datasets
			const datasets = [1, 10, 100, 1000].map(size => ({
				size,
				data: Array.from({ length: size }, (_, i) => ({ id: i, value: `data-${i}` })),
			}));

			const results: Array<{ size: number; time: number; memory: number }> = [];

			for (const dataset of datasets) {
				const startMemory = process.memoryUsage().heapUsed;
				const startTime = performance.now();

				await userStorage.store('test-user', `dataset-${dataset.size}`, dataset.data);

				const endTime = performance.now();
				const endMemory = process.memoryUsage().heapUsed;

				results.push({
					size: dataset.size,
					time: endTime - startTime,
					memory: endMemory - startMemory,
				});
			}

			// Performance should scale reasonably with data size
			results.forEach((result, index) => {
				if (index > 0) {
					const prevResult = results[index - 1];
					const sizeRatio = result.size / prevResult.size;
					const timeRatio = result.time / prevResult.time;

					// Time should not increase exponentially
					expect(timeRatio).toBeLessThan(sizeRatio * 2);
				}
			});
		});
	});

	describe('Concurrent Operations', () => {
		it('should handle concurrent operations without performance degradation', async () => {
			const rateLimiter = new RateLimiter(mockRedisManager);
			const sessionManager = new SessionManager(mockRedisManager);
			const messageBuffer = new MessageBuffer(mockRedisManager);

			const concurrentOperations = async (operationId: number) => {
				const startTime = performance.now();

				await Promise.all([
					rateLimiter.checkRateLimit(`user-${operationId}`),
					sessionManager.createSession(`session-${operationId}`),
					messageBuffer.addMessage(`buffer-${operationId}`, {
						content: `Message ${operationId}`,
					}),
				]);

				return performance.now() - startTime;
			};

			// Run operations concurrently
			const startTime = performance.now();
			const times = await Promise.all(
				Array.from({ length: 50 }, (_, i) => concurrentOperations(i))
			);
			const totalTime = performance.now() - startTime;

			// Individual operations should still be fast
			times.forEach(time => {
				expect(time).toBeLessThan(200);
			});

			// Total time should be efficient (not much more than sequential)
			expect(totalTime).toBeLessThan(5000);
		});

		it('should maintain performance under concurrent load', async () => {
			const analyticsTracker = new AnalyticsTracker(mockRedisManager, {
				enableRealTimeMetrics: true,
				batchSize: 50,
			});

			const recordMetrics = async (batchId: number) => {
				const promises = Array.from({ length: 20 }, (_, i) =>
					analyticsTracker.recordMetric(
						`concurrent.metric.${batchId}.${i}`,
						Math.random() * 100,
						'gauge'
					)
				);

				const startTime = performance.now();
				await Promise.all(promises);
				return performance.now() - startTime;
			};

			// Run multiple batches concurrently
			const batchTimes = await Promise.all(
				Array.from({ length: 10 }, (_, i) => recordMetrics(i))
			);

			// Each batch should complete quickly
			batchTimes.forEach(time => {
				expect(time).toBeLessThan(500);
			});

			// Stop the analytics tracker
			await analyticsTracker.stopBatchProcessor();
		});
	});

	describe('Stress Testing', () => {
		it('should handle sustained high load', async () => {
			const managers = {
				rateLimiter: new RateLimiter(mockRedisManager),
				sessionManager: new SessionManager(mockRedisManager),
				messageBuffer: new MessageBuffer(mockRedisManager),
				messageRouter: new MessageRouter(mockRedisManager),
				userStorage: new UserStorage(mockRedisManager),
				analyticsTracker: new AnalyticsTracker(mockRedisManager, { enableRealTimeMetrics: false }),
			};

			// Configure message router for testing
			mockRedisManager.executeOperation.mockImplementation(async (operation) => {
				const mockClient = createMockRedisClient();
				mockClient.publish = jest.fn().mockResolvedValue(1);
				return operation(mockClient);
			});

			const performOperations = async (userId: string) => {
				await Promise.all([
					managers.rateLimiter.checkRateLimit(userId),
					managers.sessionManager.createSession(`session-${userId}`),
					managers.messageBuffer.addMessage(`buffer-${userId}`, { content: 'test' }),
					managers.messageRouter.routeMessage({ content: 'test', sourceChannel: userId }),
					managers.userStorage.store(userId, 'test-key', { data: 'test' }),
					managers.analyticsTracker.recordMetric('stress.test', 1),
				]);
			};

			const startTime = performance.now();
			
			// Simulate sustained load
			const batches = Array.from({ length: 10 }, (_, batchIndex) =>
				Promise.all(
					Array.from({ length: 20 }, (_, userIndex) =>
						performOperations(`user-${batchIndex}-${userIndex}`)
					)
				)
			);

			await Promise.all(batches);
			
			const endTime = performance.now();
			const totalTime = endTime - startTime;

			// Should handle 200 complete operations (10 batches × 20 users) in reasonable time
			expect(totalTime).toBeLessThan(10000); // 10 seconds max
			expect(totalTime / 200).toBeLessThan(50); // Average < 50ms per complete operation set

			// Cleanup
			await managers.analyticsTracker.stopBatchProcessor();
		});
	});

	describe('Resource Cleanup Performance', () => {
		it('should cleanup resources efficiently', async () => {
			const analyticsTracker = new AnalyticsTracker(mockRedisManager, {
				enableRealTimeMetrics: true,
				retentionDays: 1,
			});

			// Mock cleanup scenario
			const oldMetrics: Record<string, string> = {};
			for (let i = 0; i < 1000; i++) {
				oldMetrics[`old-metric-${i}`] = JSON.stringify({
					name: 'old.metric',
					type: 'counter',
					value: 1,
					timestamp: Date.now() - (2 * 24 * 60 * 60 * 1000), // 2 days old
				});
			}

			mockRedisManager.executeOperation.mockImplementation(async (operation) => {
				const mockClient = createMockRedisClient();
				mockClient.keys.mockResolvedValue(['analytics:metrics:old']);
				mockClient.hGetAll.mockResolvedValue(oldMetrics);
				mockClient.hLen.mockResolvedValue(0); // All metrics removed
				return operation(mockClient);
			});

			const startTime = performance.now();
			const deletedCount = await analyticsTracker.cleanup();
			const endTime = performance.now();

			expect(deletedCount).toBe(1000);
			expect(endTime - startTime).toBeLessThan(1000); // Cleanup should be fast

			await analyticsTracker.stopBatchProcessor();
		});
	});
});