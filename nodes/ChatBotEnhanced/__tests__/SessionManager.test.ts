import { SessionManager, SessionConfig, SessionData, SessionCreateOptions, SessionUpdateOptions } from '../managers/SessionManager';
import { RedisManager } from '../managers/RedisManager';
import { NodeOperationError } from 'n8n-workflow';

// Mock RedisManager
const mockRedisManager = {
	executeOperation: jest.fn(),
} as unknown as RedisManager;

// Mock Redis client
const mockClient = {
	get: jest.fn(),
	setEx: jest.fn(),
	del: jest.fn(),
	exists: jest.fn(),
	ttl: jest.fn(),
	expire: jest.fn(),
	keys: jest.fn(),
	multi: jest.fn(),
	zAdd: jest.fn(),
	zRem: jest.fn(),
	zRange: jest.fn(),
	zRangeWithScores: jest.fn(),
	zCard: jest.fn(),
	zRemRangeByRank: jest.fn(),
};

describe('SessionManager', () => {
	let sessionManager: SessionManager;
	let config: Partial<SessionConfig>;

	beforeEach(() => {
		jest.clearAllMocks();
		jest.useFakeTimers();
		jest.setSystemTime(new Date('2024-01-01T00:00:00Z'));

		config = {
			defaultTtl: 1800,
			maxSessions: 100,
			enableCleanup: false, // Disable for testing
			cleanupInterval: 300,
			contextStorage: true,
			maxContextSize: 50,
			compression: false,
			keyPrefix: 'test_session',
		};

		sessionManager = new SessionManager(mockRedisManager, config);

		// Default mock implementation
		(mockRedisManager.executeOperation as jest.Mock).mockImplementation(
			async (operation) => operation(mockClient)
		);
	});

	afterEach(() => {
		sessionManager.stopCleanup();
		jest.useRealTimers();
	});

	describe('Session Creation', () => {
		it('should create a new session with default values', async () => {
			const sessionId = 'session-123';
			const options: SessionCreateOptions = {
				userId: 'user-456',
				channelId: 'channel-789',
			};

			const mockPipeline = {
				del: jest.fn().mockReturnThis(),
				zRem: jest.fn().mockReturnThis(),
				exec: jest.fn().mockResolvedValue([]),
			};
			mockClient.multi.mockReturnValue(mockPipeline);

			const result = await sessionManager.createSession(sessionId, options);

			expect(result).toMatchObject({
				sessionId,
				userId: options.userId,
				channelId: options.channelId,
				createdAt: expect.any(Number),
				lastActivity: expect.any(Number),
				messageCount: 0,
				context: {},
				metadata: {},
				conversationHistory: [],
			});

			expect(mockClient.setEx).toHaveBeenCalledWith(
				'test_session:session-123',
				1800,
				expect.any(String)
			);
		});

		it('should create session with initial context', async () => {
			const sessionId = 'session-123';
			const initialContext = { userName: 'John', preference: 'dark-mode' };
			const options: SessionCreateOptions = {
				initialContext,
			};

			const result = await sessionManager.createSession(sessionId, options);

			expect(result.context).toEqual(initialContext);
		});

		it('should create session with custom TTL', async () => {
			const sessionId = 'session-123';
			const customTtl = 3600;
			const options: SessionCreateOptions = {
				customTtl,
			};

			await sessionManager.createSession(sessionId, options);

			expect(mockClient.setEx).toHaveBeenCalledWith(
				expect.any(String),
				customTtl,
				expect.any(String)
			);
		});

		it('should enforce session limit when creating new sessions', async () => {
			config.maxSessions = 2;
			sessionManager = new SessionManager(mockRedisManager, config);

			// Mock session count at limit
			mockClient.zCard.mockResolvedValueOnce(2);
			mockClient.zRange.mockResolvedValueOnce(['old-session-1']);

			await sessionManager.createSession('new-session');

			expect(mockClient.del).toHaveBeenCalledWith('test_session:old-session-1');
			expect(mockClient.zRemRangeByRank).toHaveBeenCalled();
		});

		it('should disable conversation history when contextStorage is false', async () => {
			config.contextStorage = false;
			sessionManager = new SessionManager(mockRedisManager, config);

			const result = await sessionManager.createSession('session-123');

			expect(result.conversationHistory).toBeUndefined();
		});
	});

	describe('Session Retrieval', () => {
		it('should retrieve existing session', async () => {
			const sessionData: SessionData = {
				sessionId: 'session-123',
				userId: 'user-456',
				createdAt: Date.now(),
				lastActivity: Date.now(),
				messageCount: 5,
				context: { userName: 'John' },
				metadata: { source: 'web' },
				conversationHistory: [],
			};

			mockClient.get.mockResolvedValueOnce(JSON.stringify(sessionData));

			const result = await sessionManager.getSession('session-123');

			expect(result).toEqual(sessionData);
			expect(mockClient.get).toHaveBeenCalledWith('test_session:session-123');
		});

		it('should return null for non-existent session', async () => {
			mockClient.get.mockResolvedValueOnce(null);

			const result = await sessionManager.getSession('non-existent');

			expect(result).toBeNull();
		});

		it('should handle corrupted session data', async () => {
			mockClient.get.mockResolvedValueOnce('invalid-json');

			const result = await sessionManager.getSession('corrupted-session');

			expect(result).toBeNull();
			expect(mockClient.del).toHaveBeenCalledWith('test_session:corrupted-session');
		});

		it('should check session existence', async () => {
			mockClient.exists.mockResolvedValueOnce(1);

			const exists = await sessionManager.sessionExists('session-123');

			expect(exists).toBe(true);
			expect(mockClient.exists).toHaveBeenCalledWith('test_session:session-123');
		});

		it('should get session TTL', async () => {
			mockClient.ttl.mockResolvedValueOnce(1200);

			const ttl = await sessionManager.getSessionTTL('session-123');

			expect(ttl).toBe(1200);
		});
	});

	describe('Session Updates', () => {
		const existingSession: SessionData = {
			sessionId: 'session-123',
			userId: 'user-456',
			createdAt: Date.now() - 60000,
			lastActivity: Date.now() - 30000,
			messageCount: 3,
			context: { userName: 'John' },
			metadata: { source: 'web' },
			conversationHistory: [],
		};

		beforeEach(() => {
			mockClient.get.mockResolvedValueOnce(JSON.stringify(existingSession));
			mockClient.ttl.mockResolvedValueOnce(1500);
		});

		it('should update session with new message', async () => {
			const options: SessionUpdateOptions = {
				message: 'Hello, how are you?',
				messageType: 'user',
			};

			const result = await sessionManager.updateSession('session-123', options);

			expect(result).toBeDefined();
			expect(result!.messageCount).toBe(4);
			expect(result!.lastActivity).toBeGreaterThan(existingSession.lastActivity);
			expect(result!.conversationHistory).toHaveLength(1);
			expect(result!.conversationHistory![0]).toMatchObject({
				message: options.message,
				type: options.messageType,
				timestamp: expect.any(Number),
			});
		});

		it('should update session context', async () => {
			const options: SessionUpdateOptions = {
				context: { preference: 'dark-mode', newField: 'value' },
			};

			const result = await sessionManager.updateSession('session-123', options);

			expect(result!.context).toEqual({
				userName: 'John',
				preference: 'dark-mode',
				newField: 'value',
			});
		});

		it('should limit conversation history size', async () => {
			config.maxContextSize = 2;
			sessionManager = new SessionManager(mockRedisManager, config);

			const sessionWithHistory = {
				...existingSession,
				conversationHistory: [
					{ message: 'Old message 1', timestamp: 1, type: 'user' as const },
					{ message: 'Old message 2', timestamp: 2, type: 'user' as const },
				],
			};

			mockClient.get.mockReset().mockResolvedValueOnce(JSON.stringify(sessionWithHistory));

			const result = await sessionManager.updateSession('session-123', {
				message: 'New message',
				messageType: 'user',
			});

			expect(result!.conversationHistory).toHaveLength(2);
			expect(result!.conversationHistory![0].message).toBe('Old message 2');
			expect(result!.conversationHistory![1].message).toBe('New message');
		});

		it('should limit context size', async () => {
			config.maxContextSize = 2;
			sessionManager = new SessionManager(mockRedisManager, config);

			const sessionWithLargeContext = {
				...existingSession,
				context: {
					field1: 'value1',
					field2: 'value2',
					field3: 'value3',
				},
			};

			mockClient.get.mockReset().mockResolvedValueOnce(JSON.stringify(sessionWithLargeContext));

			const result = await sessionManager.updateSession('session-123', {
				context: { newField: 'newValue' },
			});

			expect(Object.keys(result!.context)).toHaveLength(2);
		});

		it('should extend session TTL by default', async () => {
			await sessionManager.updateSession('session-123', {
				message: 'Test message',
			});

			expect(mockClient.setEx).toHaveBeenCalledWith(
				expect.any(String),
				1800, // Should use max of current TTL and default TTL
				expect.any(String)
			);
		});

		it('should use custom TTL when specified', async () => {
			const customTtl = 7200;
			await sessionManager.updateSession('session-123', {
				customTtl,
			});

			expect(mockClient.setEx).toHaveBeenCalledWith(
				expect.any(String),
				customTtl,
				expect.any(String)
			);
		});

		it('should return null for non-existent session', async () => {
			mockClient.get.mockReset().mockResolvedValueOnce(null);

			const result = await sessionManager.updateSession('non-existent', {
				message: 'Test',
			});

			expect(result).toBeNull();
		});
	});

	describe('Session Deletion', () => {
		it('should delete session and remove from index', async () => {
			const mockPipeline = {
				del: jest.fn().mockReturnThis(),
				zRem: jest.fn().mockReturnThis(),
				exec: jest.fn().mockResolvedValue([{ reply: 1 }, { reply: 1 }]),
			};
			mockClient.multi.mockReturnValue(mockPipeline);

			const result = await sessionManager.deleteSession('session-123');

			expect(result).toBe(true);
			expect(mockPipeline.del).toHaveBeenCalledWith('test_session:session-123');
			expect(mockPipeline.zRem).toHaveBeenCalledWith('test_session:index', 'session-123');
		});

		it('should return false if session does not exist', async () => {
			const mockPipeline = {
				del: jest.fn().mockReturnThis(),
				zRem: jest.fn().mockReturnThis(),
				exec: jest.fn().mockResolvedValue([{ reply: 0 }, { reply: 0 }]),
			};
			mockClient.multi.mockReturnValue(mockPipeline);

			const result = await sessionManager.deleteSession('non-existent');

			expect(result).toBe(false);
		});
	});

	describe('Session TTL Management', () => {
		it('should extend session TTL', async () => {
			mockClient.ttl.mockResolvedValueOnce(1200);

			const result = await sessionManager.extendSession('session-123', 600);

			expect(result).toBe(true);
			expect(mockClient.expire).toHaveBeenCalledWith('test_session:session-123', 1800);
		});

		it('should return false for non-existent session', async () => {
			mockClient.ttl.mockResolvedValueOnce(-1);

			const result = await sessionManager.extendSession('non-existent', 600);

			expect(result).toBe(false);
		});

		it('should return false for session without expiry', async () => {
			mockClient.ttl.mockResolvedValueOnce(-1);

			const result = await sessionManager.extendSession('session-123', 600);

			expect(result).toBe(false);
		});
	});

	describe('User Sessions', () => {
		it('should get all sessions for a user', async () => {
			const sessions = [
				{
					sessionId: 'session-1',
					userId: 'user-123',
					lastActivity: Date.now() - 1000,
					createdAt: Date.now() - 3600000,
					messageCount: 5,
					context: {},
					metadata: {},
				},
				{
					sessionId: 'session-2',
					userId: 'user-123',
					lastActivity: Date.now() - 2000,
					createdAt: Date.now() - 7200000,
					messageCount: 3,
					context: {},
					metadata: {},
				},
				{
					sessionId: 'session-3',
					userId: 'user-456',
					lastActivity: Date.now() - 500,
					createdAt: Date.now() - 1800000,
					messageCount: 8,
					context: {},
					metadata: {},
				},
			];

			mockClient.keys.mockResolvedValueOnce([
				'test_session:session-1',
				'test_session:session-2',
				'test_session:session-3',
			]);

			mockClient.get
				.mockResolvedValueOnce(JSON.stringify(sessions[0]))
				.mockResolvedValueOnce(JSON.stringify(sessions[1]))
				.mockResolvedValueOnce(JSON.stringify(sessions[2]));

			const result = await sessionManager.getUserSessions('user-123');

			expect(result).toHaveLength(2);
			expect(result[0].sessionId).toBe('session-1'); // Most recent activity first
			expect(result[1].sessionId).toBe('session-2');
		});

		it('should handle corrupted session data in user sessions', async () => {
			mockClient.keys.mockResolvedValueOnce(['test_session:session-1']);
			mockClient.get.mockResolvedValueOnce('invalid-json');

			const result = await sessionManager.getUserSessions('user-123');

			expect(result).toHaveLength(0);
		});
	});

	describe('Session Statistics', () => {
		it('should calculate session statistics', async () => {
			const mockSessions = [
				{ value: 'session-1', score: Date.now() - 3600000 },
				{ value: 'session-2', score: Date.now() - 1800000 },
				{ value: 'session-3', score: Date.now() - 900000 },
			];

			mockClient.zRangeWithScores.mockResolvedValueOnce(mockSessions);

			// Mock TTL checks
			mockClient.ttl
				.mockResolvedValueOnce(1200) // session-1 active
				.mockResolvedValueOnce(-1)   // session-2 expired
				.mockResolvedValueOnce(800); // session-3 active

			// Mock session data
			const sessionData1 = {
				sessionId: 'session-1',
				createdAt: Date.now() - 3600000,
				messageCount: 10,
				userId: 'user-1',
				lastActivity: Date.now() - 300000,
				context: {},
				metadata: {},
			};

			const sessionData3 = {
				sessionId: 'session-3',
				createdAt: Date.now() - 900000,
				messageCount: 5,
				userId: 'user-3',
				lastActivity: Date.now() - 100000,
				context: {},
				metadata: {},
			};

			mockClient.get
				.mockResolvedValueOnce(JSON.stringify(sessionData1))
				.mockResolvedValueOnce(JSON.stringify(sessionData3));

			const stats = await sessionManager.getStats();

			expect(stats).toMatchObject({
				totalSessions: 3,
				activeSessions: 2,
				expiredSessions: 1,
				averageMessageCount: 7.5, // (10 + 5) / 2
				oldestSession: expect.any(Number),
				newestSession: expect.any(Number),
			});
		});
	});

	describe('Session Cleanup', () => {
		it('should clean up expired sessions', async () => {
			mockClient.zRange.mockResolvedValueOnce(['session-1', 'session-2', 'session-3']);
			mockClient.exists
				.mockResolvedValueOnce(1) // session-1 exists
				.mockResolvedValueOnce(0) // session-2 expired
				.mockResolvedValueOnce(0); // session-3 expired

			const cleanedCount = await sessionManager.cleanup();

			expect(cleanedCount).toBe(2);
			expect(mockClient.zRem).toHaveBeenCalledWith(
				'test_session:index',
				'session-2',
				'session-3'
			);
		});

		it('should clear all sessions', async () => {
			mockClient.keys.mockResolvedValueOnce([
				'test_session:session-1',
				'test_session:session-2',
			]);

			const clearedCount = await sessionManager.clearAllSessions();

			expect(clearedCount).toBe(2);
			expect(mockClient.del).toHaveBeenCalledWith(
				'test_session:session-1',
				'test_session:session-2'
			);
			expect(mockClient.del).toHaveBeenCalledWith('test_session:index');
		});

		it('should start automatic cleanup scheduler', () => {
			config.enableCleanup = true;
			config.cleanupInterval = 60;
			sessionManager = new SessionManager(mockRedisManager, config);

			expect(setInterval).toHaveBeenCalledWith(
				expect.any(Function),
				60000
			);
		});

		it('should stop cleanup scheduler', () => {
			config.enableCleanup = true;
			sessionManager = new SessionManager(mockRedisManager, config);

			sessionManager.stopCleanup();

			expect(clearInterval).toHaveBeenCalled();
		});
	});

	describe('Configuration Management', () => {
		it('should get current configuration', () => {
			const currentConfig = sessionManager.getConfig();

			expect(currentConfig).toEqual(expect.objectContaining({
				defaultTtl: 1800,
				maxSessions: 100,
				enableCleanup: false,
			}));
		});

		it('should update configuration', () => {
			const newConfig = {
				defaultTtl: 3600,
				maxContextSize: 200,
			};

			sessionManager.updateConfig(newConfig);

			const updatedConfig = sessionManager.getConfig();
			expect(updatedConfig.defaultTtl).toBe(3600);
			expect(updatedConfig.maxContextSize).toBe(200);
		});

		it('should restart cleanup when interval changes', () => {
			config.enableCleanup = true;
			sessionManager = new SessionManager(mockRedisManager, config);

			sessionManager.updateConfig({ cleanupInterval: 120 });

			expect(setInterval).toHaveBeenCalledTimes(2); // Initial + restart
		});

		it('should stop cleanup when disabled', () => {
			config.enableCleanup = true;
			sessionManager = new SessionManager(mockRedisManager, config);

			sessionManager.updateConfig({ enableCleanup: false });

			expect(clearInterval).toHaveBeenCalled();
		});
	});

	describe('Serialization', () => {
		it('should serialize and deserialize session data correctly', async () => {
			const sessionData: SessionData = {
				sessionId: 'test-session',
				userId: 'test-user',
				createdAt: Date.now(),
				lastActivity: Date.now(),
				messageCount: 5,
				context: { key: 'value', nested: { data: 123 } },
				metadata: { source: 'test' },
				conversationHistory: [
					{
						message: 'Hello',
						timestamp: Date.now(),
						type: 'user',
						metadata: { confidence: 0.95 },
					},
				],
			};

			await sessionManager.createSession('test-session');

			// Verify serialization happened
			expect(mockClient.setEx).toHaveBeenCalledWith(
				expect.any(String),
				expect.any(Number),
				expect.stringContaining('"sessionId":"test-session"')
			);
		});

		it('should handle serialization errors', async () => {
			// Create a circular reference that will cause JSON.stringify to fail
			const circularData = { sessionId: 'test' } as any;
			circularData.circular = circularData;

			// Mock the private method by modifying the instance
			const originalSerialize = (sessionManager as any).serializeSession;
			(sessionManager as any).serializeSession = () => {
				throw new Error('Circular reference');
			};

			await expect(sessionManager.createSession('test', {
				initialContext: circularData,
			})).rejects.toThrow(NodeOperationError);

			// Restore original method
			(sessionManager as any).serializeSession = originalSerialize;
		});
	});

	describe('Error Handling', () => {
		it('should handle Redis connection failures', async () => {
			(mockRedisManager.executeOperation as jest.Mock).mockRejectedValueOnce(
				new Error('Redis connection failed')
			);

			await expect(sessionManager.createSession('test-session')).rejects.toThrow();
		});

		it('should handle invalid session data gracefully', async () => {
			mockClient.get.mockResolvedValueOnce('invalid-json-data');

			const result = await sessionManager.getSession('invalid-session');

			expect(result).toBeNull();
			expect(mockClient.del).toHaveBeenCalledWith('test_session:invalid-session');
		});

		it('should handle cleanup failures gracefully', async () => {
			config.enableCleanup = true;
			sessionManager = new SessionManager(mockRedisManager, config);

			// Mock cleanup failure
			(mockRedisManager.executeOperation as jest.Mock).mockRejectedValueOnce(
				new Error('Cleanup failed')
			);

			// Should not throw error, just log warning
			jest.advanceTimersByTime(300000);
			await Promise.resolve();

			// Test passes if no error is thrown
		});
	});

	describe('Performance Considerations', () => {
		it('should handle large numbers of sessions efficiently', async () => {
			const sessionIds = Array.from({ length: 1000 }, (_, i) => `session-${i}`);
			mockClient.keys.mockResolvedValueOnce(sessionIds.map(id => `test_session:${id}`));

			// Mock all sessions as user sessions
			mockClient.get.mockImplementation(() => 
				Promise.resolve(JSON.stringify({
					sessionId: 'test',
					userId: 'user-123',
					createdAt: Date.now(),
					lastActivity: Date.now(),
					messageCount: 1,
					context: {},
					metadata: {},
				}))
			);

			const startTime = Date.now();
			await sessionManager.getUserSessions('user-123');
			const endTime = Date.now();

			// Should complete reasonably quickly (in real implementation)
			expect(endTime - startTime).toBeLessThan(5000);
		});
	});
});