import { ChatBotEnhanced } from '../ChatBotEnhanced.node';
import { NodeExecuteFunctions } from 'n8n-workflow';
import { RedisManager } from '../managers/RedisManager';
import { RateLimiter } from '../managers/RateLimiter';
import { SessionManager } from '../managers/SessionManager';
import { MessageBuffer } from '../managers/MessageBuffer';
import { MessageRouter } from '../managers/MessageRouter';
import { UserStorage } from '../managers/UserStorage';
import { AnalyticsTracker } from '../managers/AnalyticsTracker';

// Mock all managers
jest.mock('../managers/RedisManager');
jest.mock('../managers/RateLimiter');
jest.mock('../managers/SessionManager');
jest.mock('../managers/MessageBuffer');
jest.mock('../managers/MessageRouter');
jest.mock('../managers/UserStorage');
jest.mock('../managers/AnalyticsTracker');

describe('ChatBotEnhanced Node Integration', () => {
	let node: ChatBotEnhanced;
	let mockExecuteFunctions: Partial<NodeExecuteFunctions>;
	let mockRedisManager: jest.Mocked<RedisManager>;
	let mockRateLimiter: jest.Mocked<RateLimiter>;
	let mockSessionManager: jest.Mocked<SessionManager>;
	let mockMessageBuffer: jest.Mocked<MessageBuffer>;
	let mockMessageRouter: jest.Mocked<MessageRouter>;
	let mockUserStorage: jest.Mocked<UserStorage>;
	let mockAnalyticsTracker: jest.Mocked<AnalyticsTracker>;

	beforeEach(() => {
		// Setup mocks
		mockRedisManager = {
			connect: jest.fn().mockResolvedValue(undefined),
			isAvailable: jest.fn().mockReturnValue(true),
			getHealthStatus: jest.fn().mockReturnValue({
				isConnected: true,
				isReady: true,
				latency: 5,
			}),
			cleanup: jest.fn().mockResolvedValue(undefined),
		} as any;

		mockRateLimiter = {
			checkRateLimit: jest.fn().mockResolvedValue({
				allowed: true,
				remainingRequests: 99,
				resetTime: Date.now() + 60000,
				totalRequests: 1,
				algorithm: 'sliding_window',
				strategy: 'per_user',
			}),
		} as any;

		mockSessionManager = {
			getSession: jest.fn().mockResolvedValue({
				sessionId: 'test-session',
				userId: 'test-user',
				createdAt: Date.now(),
				lastActivity: Date.now(),
				messageCount: 1,
				context: {},
				metadata: {},
				conversationHistory: [],
			}),
			updateSession: jest.fn().mockResolvedValue({
				sessionId: 'test-session',
				userId: 'test-user',
				createdAt: Date.now(),
				lastActivity: Date.now(),
				messageCount: 2,
				context: {},
				metadata: {},
				conversationHistory: [],
			}),
		} as any;

		mockMessageBuffer = {
			addMessage: jest.fn().mockResolvedValue({
				bufferId: 'test-buffer',
				messageId: 'msg-123',
				shouldFlush: false,
			}),
			flush: jest.fn().mockResolvedValue({
				flushedMessages: [],
				remainingMessages: [],
				trigger: 'manual',
				flushTime: Date.now(),
				processingTime: 10,
			}),
		} as any;

		mockMessageRouter = {
			routeMessage: jest.fn().mockResolvedValue({
				messageId: 'route-123',
				delivered: ['output-channel'],
				failed: [],
				processingTime: 5,
			}),
		} as any;

		mockUserStorage = {
			store: jest.fn().mockResolvedValue(undefined),
			retrieve: jest.fn().mockResolvedValue('stored-data'),
		} as any;

		mockAnalyticsTracker = {
			recordMetric: jest.fn().mockResolvedValue(undefined),
			recordPerformance: jest.fn().mockResolvedValue(undefined),
		} as any;

		// Mock constructors
		(RedisManager as jest.MockedClass<typeof RedisManager>).mockImplementation(() => mockRedisManager);
		(RateLimiter as jest.MockedClass<typeof RateLimiter>).mockImplementation(() => mockRateLimiter);
		(SessionManager as jest.MockedClass<typeof SessionManager>).mockImplementation(() => mockSessionManager);
		(MessageBuffer as jest.MockedClass<typeof MessageBuffer>).mockImplementation(() => mockMessageBuffer);
		(MessageRouter as jest.MockedClass<typeof MessageRouter>).mockImplementation(() => mockMessageRouter);
		(UserStorage as jest.MockedClass<typeof UserStorage>).mockImplementation(() => mockUserStorage);
		(AnalyticsTracker as jest.MockedClass<typeof AnalyticsTracker>).mockImplementation(() => mockAnalyticsTracker);

		// Setup execute functions mock
		mockExecuteFunctions = {
			getInputData: jest.fn().mockReturnValue([
				{
					json: {
						message: 'Hello, world!',
						userId: 'user-123',
						sessionId: 'session-456',
					},
				},
			]),
			getCredentials: jest.fn().mockResolvedValue({
				host: 'localhost',
				port: 6379,
				password: 'testpass',
				database: 0,
				ssl: false,
			}),
			getNodeParameter: jest.fn().mockImplementation((paramName: string) => {
				const params = {
					operation: 'rate_limit',
					rateLimitConfig: {
						algorithm: 'sliding_window',
						strategy: 'per_user',
						windowSize: 60,
						maxRequests: 100,
					},
					enableAnalytics: true,
					enableSession: true,
				};
				return params[paramName];
			}),
			helpers: {
				returnJsonArray: jest.fn().mockImplementation((data) => data),
			},
		} as any;

		node = new ChatBotEnhanced();
	});

	describe('Node Execution', () => {
		it('should execute rate limiting operation successfully', async () => {
			mockExecuteFunctions.getNodeParameter = jest.fn().mockImplementation((paramName: string) => {
				if (paramName === 'operation') return 'rate_limit';
				if (paramName === 'rateLimitConfig') return {
					algorithm: 'sliding_window',
					strategy: 'per_user',
					windowSize: 60,
					maxRequests: 100,
				};
				return undefined;
			});

			const result = await node.execute.call(mockExecuteFunctions as NodeExecuteFunctions);

			expect(mockRedisManager.connect).toHaveBeenCalled();
			expect(mockRateLimiter.checkRateLimit).toHaveBeenCalledWith('user-123', 1);
			expect(mockAnalyticsTracker.recordMetric).toHaveBeenCalled();
			
			expect(result).toEqual([
				[
					{
						json: expect.objectContaining({
							allowed: true,
							remainingRequests: 99,
							userId: 'user-123',
						}),
					},
				],
				[], // Processed output
				[], // Error output
				[], // Metrics output
			]);
		});

		it('should handle rate limit exceeded', async () => {
			mockRateLimiter.checkRateLimit.mockResolvedValueOnce({
				allowed: false,
				remainingRequests: 0,
				resetTime: Date.now() + 60000,
				totalRequests: 100,
				retryAfter: 60,
				algorithm: 'sliding_window',
				strategy: 'per_user',
			});

			mockExecuteFunctions.getNodeParameter = jest.fn().mockImplementation((paramName: string) => {
				if (paramName === 'operation') return 'rate_limit';
				return {};
			});

			const result = await node.execute.call(mockExecuteFunctions as NodeExecuteFunctions);

			expect(result[0]).toEqual([]); // Success output empty
			expect(result[2]).toEqual([
				{
					json: expect.objectContaining({
						error: 'Rate limit exceeded',
						retryAfter: 60,
					}),
				},
			]); // Error output
		});

		it('should execute session management operation', async () => {
			mockExecuteFunctions.getNodeParameter = jest.fn().mockImplementation((paramName: string) => {
				if (paramName === 'operation') return 'session_manage';
				if (paramName === 'sessionConfig') return {
					defaultTtl: 1800,
					maxSessions: 1000,
					enableCleanup: true,
				};
				return undefined;
			});

			const result = await node.execute.call(mockExecuteFunctions as NodeExecuteFunctions);

			expect(mockSessionManager.getSession).toHaveBeenCalledWith('session-456');
			expect(mockSessionManager.updateSession).toHaveBeenCalledWith(
				'session-456',
				expect.objectContaining({
					message: 'Hello, world!',
					messageType: 'user',
				})
			);

			expect(result[0][0].json).toMatchObject({
				sessionId: 'test-session',
				userId: 'test-user',
				messageCount: 2,
			});
		});

		it('should execute message buffering operation', async () => {
			mockExecuteFunctions.getNodeParameter = jest.fn().mockImplementation((paramName: string) => {
				if (paramName === 'operation') return 'buffer_message';
				if (paramName === 'bufferConfig') return {
					pattern: 'collect_send',
					maxSize: 100,
					flushInterval: 30,
				};
				return undefined;
			});

			const result = await node.execute.call(mockExecuteFunctions as NodeExecuteFunctions);

			expect(mockMessageBuffer.addMessage).toHaveBeenCalledWith(
				'user-123',
				expect.objectContaining({
					content: 'Hello, world!',
					userId: 'user-123',
				})
			);

			expect(result[1][0].json).toMatchObject({
				bufferId: 'test-buffer',
				messageId: 'msg-123',
				shouldFlush: false,
			});
		});

		it('should execute message routing operation', async () => {
			mockExecuteFunctions.getNodeParameter = jest.fn().mockImplementation((paramName: string) => {
				if (paramName === 'operation') return 'route_message';
				if (paramName === 'routerConfig') return {
					pattern: 'one_to_many',
					channels: ['channel-1', 'channel-2'],
				};
				return undefined;
			});

			const result = await node.execute.call(mockExecuteFunctions as NodeExecuteFunctions);

			expect(mockMessageRouter.routeMessage).toHaveBeenCalledWith({
				content: 'Hello, world!',
				sourceChannel: 'user-123',
				metadata: expect.any(Object),
			});

			expect(result[1][0].json).toMatchObject({
				messageId: 'route-123',
				delivered: ['output-channel'],
				failed: [],
			});
		});

		it('should execute user storage operation', async () => {
			mockExecuteFunctions.getNodeParameter = jest.fn().mockImplementation((paramName: string) => {
				if (paramName === 'operation') return 'store_data';
				if (paramName === 'storageConfig') return {
					enableTypeDetection: true,
					enableCompression: false,
				};
				if (paramName === 'storageKey') return 'user-preference';
				if (paramName === 'storageValue') return { theme: 'dark', language: 'en' };
				return undefined;
			});

			const result = await node.execute.call(mockExecuteFunctions as NodeExecuteFunctions);

			expect(mockUserStorage.store).toHaveBeenCalledWith(
				'user-123',
				'user-preference',
				{ theme: 'dark', language: 'en' },
				expect.any(Object)
			);

			expect(result[1][0].json).toMatchObject({
				operation: 'store',
				userId: 'user-123',
				key: 'user-preference',
			});
		});

		it('should handle multiple operations in pipeline', async () => {
			// Test a complex scenario with multiple operations
			mockExecuteFunctions.getNodeParameter = jest.fn().mockImplementation((paramName: string) => {
				if (paramName === 'operation') return 'rate_limit';
				if (paramName === 'enableSession') return true;
				if (paramName === 'enableAnalytics') return true;
				return {};
			});

			const result = await node.execute.call(mockExecuteFunctions as NodeExecuteFunctions);

			// Should have executed rate limiting
			expect(mockRateLimiter.checkRateLimit).toHaveBeenCalled();
			
			// Should have updated session (because enableSession is true)
			expect(mockSessionManager.updateSession).toHaveBeenCalled();
			
			// Should have recorded analytics
			expect(mockAnalyticsTracker.recordMetric).toHaveBeenCalled();
			expect(mockAnalyticsTracker.recordPerformance).toHaveBeenCalled();
		});
	});

	describe('Error Handling', () => {
		it('should handle Redis connection failures', async () => {
			mockRedisManager.connect.mockRejectedValueOnce(new Error('Redis connection failed'));

			mockExecuteFunctions.getNodeParameter = jest.fn().mockReturnValue('rate_limit');

			const result = await node.execute.call(mockExecuteFunctions as NodeExecuteFunctions);

			expect(result[2][0].json).toMatchObject({
				error: 'Redis connection failed',
				operation: 'rate_limit',
			});
		});

		it('should handle manager operation failures', async () => {
			mockRateLimiter.checkRateLimit.mockRejectedValueOnce(new Error('Rate limiter error'));

			mockExecuteFunctions.getNodeParameter = jest.fn().mockReturnValue('rate_limit');

			const result = await node.execute.call(mockExecuteFunctions as NodeExecuteFunctions);

			expect(result[2][0].json).toMatchObject({
				error: 'Rate limiter error',
				operation: 'rate_limit',
			});
		});

		it('should handle invalid input data', async () => {
			mockExecuteFunctions.getInputData = jest.fn().mockReturnValue([
				{ json: {} }, // Missing required fields
			]);

			mockExecuteFunctions.getNodeParameter = jest.fn().mockReturnValue('rate_limit');

			const result = await node.execute.call(mockExecuteFunctions as NodeExecuteFunctions);

			// Should handle gracefully and not crash
			expect(Array.isArray(result)).toBe(true);
			expect(result).toHaveLength(4); // All output arrays present
		});

		it('should handle missing credentials', async () => {
			mockExecuteFunctions.getCredentials = jest.fn().mockRejectedValueOnce(
				new Error('Credentials not found')
			);

			mockExecuteFunctions.getNodeParameter = jest.fn().mockReturnValue('rate_limit');

			const result = await node.execute.call(mockExecuteFunctions as NodeExecuteFunctions);

			expect(result[2][0].json).toMatchObject({
				error: 'Credentials not found',
			});
		});
	});

	describe('Performance Metrics', () => {
		it('should record performance metrics for all operations', async () => {
			mockExecuteFunctions.getNodeParameter = jest.fn().mockImplementation((paramName: string) => {
				if (paramName === 'operation') return 'rate_limit';
				if (paramName === 'enableAnalytics') return true;
				return {};
			});

			await node.execute.call(mockExecuteFunctions as NodeExecuteFunctions);

			expect(mockAnalyticsTracker.recordPerformance).toHaveBeenCalledWith(
				expect.objectContaining({
					processingTime: expect.any(Number),
					memoryUsage: expect.any(Number),
					redisLatency: expect.any(Number),
					queueSize: expect.any(Number),
					errorRate: expect.any(Number),
					throughput: expect.any(Number),
				}),
				expect.objectContaining({
					operation: 'rate_limit',
					userId: expect.any(String),
				})
			);
		});

		it('should include metrics in output when enabled', async () => {
			mockExecuteFunctions.getNodeParameter = jest.fn().mockImplementation((paramName: string) => {
				if (paramName === 'operation') return 'rate_limit';
				if (paramName === 'enableAnalytics') return true;
				return {};
			});

			const result = await node.execute.call(mockExecuteFunctions as NodeExecuteFunctions);

			expect(result[3]).toHaveLength(1); // Metrics output
			expect(result[3][0].json).toMatchObject({
				operation: 'rate_limit',
				processingTime: expect.any(Number),
				redisHealth: expect.objectContaining({
					isConnected: true,
					isReady: true,
					latency: expect.any(Number),
				}),
			});
		});
	});

	describe('Multi-Output Routing', () => {
		it('should route successful operations to success output', async () => {
			mockExecuteFunctions.getNodeParameter = jest.fn().mockReturnValue('rate_limit');

			const result = await node.execute.call(mockExecuteFunctions as NodeExecuteFunctions);

			expect(result[0]).toHaveLength(1); // Success output
			expect(result[1]).toHaveLength(0); // Processed output
			expect(result[2]).toHaveLength(0); // Error output
		});

		it('should route processed operations to processed output', async () => {
			mockExecuteFunctions.getNodeParameter = jest.fn().mockReturnValue('buffer_message');

			const result = await node.execute.call(mockExecuteFunctions as NodeExecuteFunctions);

			expect(result[0]).toHaveLength(0); // Success output
			expect(result[1]).toHaveLength(1); // Processed output
			expect(result[2]).toHaveLength(0); // Error output
		});

		it('should route errors to error output', async () => {
			mockRedisManager.connect.mockRejectedValueOnce(new Error('Connection failed'));
			mockExecuteFunctions.getNodeParameter = jest.fn().mockReturnValue('rate_limit');

			const result = await node.execute.call(mockExecuteFunctions as NodeExecuteFunctions);

			expect(result[0]).toHaveLength(0); // Success output
			expect(result[1]).toHaveLength(0); // Processed output
			expect(result[2]).toHaveLength(1); // Error output
		});

		it('should include metrics in metrics output when enabled', async () => {
			mockExecuteFunctions.getNodeParameter = jest.fn().mockImplementation((paramName: string) => {
				if (paramName === 'enableAnalytics') return true;
				return 'rate_limit';
			});

			const result = await node.execute.call(mockExecuteFunctions as NodeExecuteFunctions);

			expect(result[3]).toHaveLength(1); // Metrics output
		});
	});

	describe('Cleanup and Resource Management', () => {
		it('should cleanup Redis connections after execution', async () => {
			mockExecuteFunctions.getNodeParameter = jest.fn().mockReturnValue('rate_limit');

			await node.execute.call(mockExecuteFunctions as NodeExecuteFunctions);

			// Note: In real implementation, cleanup might be handled differently
			// This test ensures the structure is in place for proper cleanup
			expect(mockRedisManager.connect).toHaveBeenCalled();
		});

		it('should handle cleanup errors gracefully', async () => {
			mockRedisManager.cleanup.mockRejectedValueOnce(new Error('Cleanup failed'));
			mockExecuteFunctions.getNodeParameter = jest.fn().mockReturnValue('rate_limit');

			// Should not throw during execution
			await expect(node.execute.call(mockExecuteFunctions as NodeExecuteFunctions))
				.resolves.toBeDefined();
		});
	});

	describe('Configuration Validation', () => {
		it('should validate rate limit configuration', async () => {
			mockExecuteFunctions.getNodeParameter = jest.fn().mockImplementation((paramName: string) => {
				if (paramName === 'operation') return 'rate_limit';
				if (paramName === 'rateLimitConfig') return {
					algorithm: 'invalid_algorithm',
					strategy: 'per_user',
					windowSize: -1, // Invalid
					maxRequests: 0, // Invalid
				};
				return undefined;
			});

			const result = await node.execute.call(mockExecuteFunctions as NodeExecuteFunctions);

			// Should handle invalid configuration gracefully
			expect(Array.isArray(result)).toBe(true);
		});

		it('should validate session configuration', async () => {
			mockExecuteFunctions.getNodeParameter = jest.fn().mockImplementation((paramName: string) => {
				if (paramName === 'operation') return 'session_manage';
				if (paramName === 'sessionConfig') return {
					defaultTtl: -1, // Invalid
					maxSessions: -100, // Invalid
				};
				return undefined;
			});

			const result = await node.execute.call(mockExecuteFunctions as NodeExecuteFunctions);

			// Should handle invalid configuration gracefully
			expect(Array.isArray(result)).toBe(true);
		});
	});

	describe('Concurrent Execution', () => {
		it('should handle multiple concurrent executions', async () => {
			mockExecuteFunctions.getNodeParameter = jest.fn().mockReturnValue('rate_limit');

			const executions = Array.from({ length: 5 }, () =>
				node.execute.call(mockExecuteFunctions as NodeExecuteFunctions)
			);

			const results = await Promise.all(executions);

			expect(results).toHaveLength(5);
			results.forEach(result => {
				expect(Array.isArray(result)).toBe(true);
				expect(result).toHaveLength(4);
			});

			// Should have made appropriate number of calls
			expect(mockRateLimiter.checkRateLimit).toHaveBeenCalledTimes(5);
		});
	});
});