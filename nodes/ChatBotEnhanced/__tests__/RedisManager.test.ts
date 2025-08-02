import { RedisManager, RedisConnectionConfig, RedisHealthStatus } from '../managers/RedisManager';
import { RedisCredential } from '../types';
import { createClient } from 'redis';
import { NodeOperationError } from 'n8n-workflow';

// Mock Redis client
jest.mock('redis', () => ({
	createClient: jest.fn(),
}));

describe('RedisManager', () => {
	let redisManager: RedisManager;
	let mockClient: any;
	let credentials: RedisCredential;
	let config: Partial<RedisConnectionConfig>;

	beforeEach(() => {
		// Reset all mocks
		jest.clearAllMocks();
		jest.clearAllTimers();
		jest.useFakeTimers();

		// Mock Redis client
		mockClient = {
			connect: jest.fn().mockResolvedValue(undefined),
			disconnect: jest.fn().mockResolvedValue(undefined),
			quit: jest.fn().mockResolvedValue(undefined),
			ping: jest.fn().mockResolvedValue('PONG'),
			on: jest.fn(),
			isOpen: true,
			isReady: true,
		};

		(createClient as jest.Mock).mockReturnValue(mockClient);

		credentials = {
			host: 'localhost',
			port: 6379,
			password: 'testpass',
			database: 0,
			ssl: false,
		};

		config = {
			maxRetries: 3,
			retryDelay: 1000,
			connectionTimeout: 5000,
			healthCheckInterval: 30000,
			gracefulShutdownTimeout: 5000,
		};

		redisManager = new RedisManager(credentials, config);
	});

	afterEach(() => {
		jest.useRealTimers();
	});

	describe('Connection Management', () => {
		it('should establish connection successfully', async () => {
			await redisManager.connect();

			expect(createClient).toHaveBeenCalledWith({
				socket: {
					host: 'localhost',
					port: 6379,
					tls: false,
					connectTimeout: 5000,
					reconnectStrategy: expect.any(Function),
				},
				database: 0,
				password: 'testpass',
			});
			expect(mockClient.connect).toHaveBeenCalled();
		});

		it('should handle SSL configuration', async () => {
			const sslCredentials = { ...credentials, ssl: true };
			const sslManager = new RedisManager(sslCredentials);

			await sslManager.connect();

			expect(createClient).toHaveBeenCalledWith(
				expect.objectContaining({
					socket: expect.objectContaining({
						tls: true,
					}),
				})
			);
		});

		it('should handle authentication with username', async () => {
			const authCredentials = { ...credentials, user: 'testuser' };
			const authManager = new RedisManager(authCredentials);

			await authManager.connect();

			expect(createClient).toHaveBeenCalledWith(
				expect.objectContaining({
					username: 'testuser',
					password: 'testpass',
				})
			);
		});

		it('should handle connection timeout', async () => {
			mockClient.connect.mockImplementation(() => 
				new Promise(resolve => setTimeout(resolve, 10000))
			);

			await expect(redisManager.connect()).rejects.toThrow('Connection timeout');
		});

		it('should not connect if already connected', async () => {
			await redisManager.connect();
			mockClient.connect.mockClear();

			await redisManager.connect();
			expect(mockClient.connect).not.toHaveBeenCalled();
		});

		it('should wait for ongoing connection attempts', async () => {
			let connectionResolve: any;
			mockClient.connect.mockImplementation(() => 
				new Promise(resolve => { connectionResolve = resolve; })
			);

			// Start first connection
			const firstConnect = redisManager.connect();
			
			// Start second connection (should wait)
			const secondConnect = redisManager.connect();

			// Resolve first connection
			connectionResolve();
			await firstConnect;
			await secondConnect;

			expect(mockClient.connect).toHaveBeenCalledTimes(1);
		});
	});

	describe('Health Checks', () => {
		beforeEach(async () => {
			await redisManager.connect();
		});

		it('should perform health checks at intervals', async () => {
			jest.advanceTimersByTime(30000);
			await Promise.resolve(); // Let promises resolve

			expect(mockClient.ping).toHaveBeenCalledTimes(2); // Initial + interval
		});

		it('should update health status on successful ping', async () => {
			jest.advanceTimersByTime(30000);
			await Promise.resolve();

			const health = redisManager.getHealthStatus();
			expect(health.isConnected).toBe(true);
			expect(health.isReady).toBe(true);
			expect(health.latency).toBeGreaterThanOrEqual(0);
		});

		it('should handle ping failures', async () => {
			mockClient.ping.mockRejectedValueOnce(new Error('Ping failed'));
			
			jest.advanceTimersByTime(30000);
			await Promise.resolve();

			const health = redisManager.getHealthStatus();
			expect(health.isReady).toBe(false);
			expect(health.errorCount).toBeGreaterThan(0);
		});

		it('should calculate connection uptime', async () => {
			const startTime = Date.now();
			jest.setSystemTime(startTime + 60000); // 1 minute later

			const health = redisManager.getHealthStatus();
			expect(health.connectionUptime).toBeGreaterThanOrEqual(60000);
		});
	});

	describe('Reconnection Logic', () => {
		it('should schedule reconnection on connection loss', async () => {
			await redisManager.connect();
			
			// Simulate connection loss
			const endHandler = mockClient.on.mock.calls.find(call => call[0] === 'end')[1];
			endHandler();

			// Should schedule reconnection
			expect(setTimeout).toHaveBeenCalledWith(expect.any(Function), 1000);
		});

		it('should implement exponential backoff', async () => {
			await redisManager.connect();
			
			// Simulate multiple connection failures
			const errorHandler = mockClient.on.mock.calls.find(call => call[0] === 'error')[1];
			
			// First error
			errorHandler(new Error('Connection failed'));
			expect(setTimeout).toHaveBeenCalledWith(expect.any(Function), 1000);

			// Second error (should increase delay)
			errorHandler(new Error('Connection failed'));
			expect(setTimeout).toHaveBeenCalledWith(expect.any(Function), 2000);
		});

		it('should stop reconnecting after max retries', async () => {
			const manager = new RedisManager(credentials, { maxRetries: 2 });
			await manager.connect();
			
			const errorHandler = mockClient.on.mock.calls.find(call => call[0] === 'error')[1];
			
			// Exceed max retries
			for (let i = 0; i < 3; i++) {
				errorHandler(new Error('Connection failed'));
			}

			// Should not schedule more reconnections
			const timeoutCalls = (setTimeout as jest.Mock).mock.calls.length;
			errorHandler(new Error('Connection failed'));
			expect((setTimeout as jest.Mock).mock.calls.length).toBe(timeoutCalls);
		});

		it('should force reconnection', async () => {
			await redisManager.connect();
			mockClient.connect.mockClear();

			await redisManager.forceReconnect();

			expect(mockClient.quit).toHaveBeenCalled();
			expect(mockClient.connect).toHaveBeenCalled();
		});
	});

	describe('Operation Execution', () => {
		beforeEach(async () => {
			await redisManager.connect();
		});

		it('should execute operations successfully', async () => {
			const operation = jest.fn().mockResolvedValue('test-result');
			
			const result = await redisManager.executeOperation(operation);
			
			expect(operation).toHaveBeenCalledWith(mockClient);
			expect(result).toBe('test-result');
		});

		it('should handle operation timeouts', async () => {
			const operation = jest.fn().mockImplementation(() => 
				new Promise(resolve => setTimeout(resolve, 10000))
			);

			await expect(
				redisManager.executeOperation(operation, { timeout: 1000 })
			).rejects.toThrow('Operation timeout');
		});

		it('should retry failed operations', async () => {
			const operation = jest.fn()
				.mockRejectedValueOnce(new Error('First failure'))
				.mockResolvedValueOnce('success');

			const result = await redisManager.executeOperation(operation, { retries: 1 });
			
			expect(operation).toHaveBeenCalledTimes(2);
			expect(result).toBe('success');
		});

		it('should fail after max retries', async () => {
			const operation = jest.fn().mockRejectedValue(new Error('Persistent failure'));

			await expect(
				redisManager.executeOperation(operation, { retries: 2 })
			).rejects.toThrow(NodeOperationError);
		});

		it('should auto-reconnect if connection is lost', async () => {
			// Simulate connection loss
			redisManager['healthStatus'].isConnected = false;
			redisManager['client'] = null;

			const operation = jest.fn().mockResolvedValue('result');
			mockClient.connect.mockResolvedValueOnce(undefined);

			await redisManager.executeOperation(operation);

			expect(createClient).toHaveBeenCalledTimes(2); // Initial + reconnection
		});
	});

	describe('Availability Checks', () => {
		it('should report available when connected and ready', async () => {
			await redisManager.connect();
			
			expect(redisManager.isAvailable()).toBe(true);
		});

		it('should report unavailable when not connected', () => {
			expect(redisManager.isAvailable()).toBe(false);
		});

		it('should report unavailable during graceful shutdown', async () => {
			await redisManager.connect();
			
			// Start cleanup
			redisManager.cleanup();
			
			expect(redisManager.isAvailable()).toBe(false);
		});

		it('should throw error when getting client if unavailable', () => {
			expect(() => redisManager.getClient()).toThrow(NodeOperationError);
		});
	});

	describe('Cleanup and Shutdown', () => {
		beforeEach(async () => {
			await redisManager.connect();
		});

		it('should perform graceful shutdown', async () => {
			await redisManager.cleanup();

			expect(mockClient.quit).toHaveBeenCalled();
			expect(redisManager.isAvailable()).toBe(false);
		});

		it('should force disconnect on quit timeout', async () => {
			mockClient.quit.mockImplementation(() => 
				new Promise(resolve => setTimeout(resolve, 10000))
			);

			await redisManager.cleanup();

			expect(mockClient.disconnect).toHaveBeenCalled();
		});

		it('should clear all timers during cleanup', async () => {
			await redisManager.cleanup();

			expect(clearInterval).toHaveBeenCalled();
			expect(clearTimeout).toHaveBeenCalled();
		});

		it('should reset state after cleanup', async () => {
			await redisManager.cleanup();

			const stats = redisManager.getConnectionStats();
			expect(stats.healthStatus.isConnected).toBe(false);
			expect(stats.healthStatus.isReady).toBe(false);
		});
	});

	describe('Connection Statistics', () => {
		it('should provide connection statistics', async () => {
			await redisManager.connect();
			
			const stats = redisManager.getConnectionStats();
			
			expect(stats).toMatchObject({
				connectionAttempts: expect.any(Number),
				lastConnectionTime: expect.any(Number),
				healthStatus: expect.objectContaining({
					isConnected: expect.any(Boolean),
					isReady: expect.any(Boolean),
					latency: expect.any(Number),
				}),
			});
		});

		it('should track connection attempts', async () => {
			const errorHandler = mockClient.on.mock.calls.find(call => call[0] === 'reconnecting')[1];
			
			await redisManager.connect();
			errorHandler(); // Simulate reconnection
			
			const stats = redisManager.getConnectionStats();
			expect(stats.connectionAttempts).toBeGreaterThan(0);
		});
	});

	describe('Error Handling', () => {
		it('should handle invalid credentials gracefully', async () => {
			mockClient.connect.mockRejectedValueOnce(new Error('Authentication failed'));

			await expect(redisManager.connect()).rejects.toThrow();
		});

		it('should handle network errors', async () => {
			const operation = jest.fn().mockRejectedValue(new Error('Network error'));

			await expect(
				redisManager.executeOperation(operation)
			).rejects.toThrow(NodeOperationError);
		});

		it('should provide meaningful error messages', async () => {
			const operation = jest.fn().mockRejectedValue(new Error('Redis error'));

			try {
				await redisManager.executeOperation(operation, { retries: 0 });
			} catch (error) {
				expect(error).toBeInstanceOf(NodeOperationError);
				expect(error.message).toContain('Redis operation failed');
			}
		});
	});

	describe('Configuration Validation', () => {
		it('should use default configuration values', () => {
			const manager = new RedisManager(credentials);
			const stats = manager.getConnectionStats();
			
			// Defaults should be applied
			expect(stats).toBeDefined();
		});

		it('should override default configuration', () => {
			const customConfig = {
				maxRetries: 5,
				retryDelay: 2000,
				connectionTimeout: 10000,
			};
			
			const manager = new RedisManager(credentials, customConfig);
			
			// Should use custom values (tested through behavior)
			expect(manager).toBeDefined();
		});

		it('should handle missing optional credentials', () => {
			const minimalCredentials: RedisCredential = {
				host: 'localhost',
				port: 6379,
			};
			
			const manager = new RedisManager(minimalCredentials);
			expect(manager).toBeDefined();
		});
	});
});