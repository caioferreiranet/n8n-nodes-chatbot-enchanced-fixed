import { MessageRouter, RouterConfig, RoutingRule, MessageRoute } from '../managers/MessageRouter';
import { RedisManager } from '../managers/RedisManager';
import { NodeOperationError } from 'n8n-workflow';

// Mock RedisManager
const mockRedisManager = {
	executeOperation: jest.fn(),
} as unknown as RedisManager;

// Mock Redis client
const mockClient = {
	duplicate: jest.fn(),
	connect: jest.fn(),
	subscribe: jest.fn(),
	unsubscribe: jest.fn(),
	quit: jest.fn(),
	publish: jest.fn(),
	hGetAll: jest.fn(),
	hSet: jest.fn(),
	hDel: jest.fn(),
	hIncrBy: jest.fn(),
	multi: jest.fn(),
};

describe('MessageRouter', () => {
	let messageRouter: MessageRouter;
	let config: Partial<RouterConfig>;

	beforeEach(() => {
		jest.clearAllMocks();
		jest.useFakeTimers();
		jest.setSystemTime(new Date('2024-01-01T00:00:00Z'));

		config = {
			pattern: 'one_to_many',
			channels: ['channel-1', 'channel-2', 'channel-3'],
			enablePatternMatching: true,
			keyPrefix: 'test_router',
			retryAttempts: 3,
			retryDelay: 1000,
		};

		messageRouter = new MessageRouter(mockRedisManager, config);

		// Default mock implementation
		(mockRedisManager.executeOperation as jest.Mock).mockImplementation(
			async (operation: any) => operation(mockClient)
		);
	});

	afterEach(() => {
		messageRouter.stop();
		jest.useRealTimers();
	});

	describe('Message Routing', () => {
		it('should route message to all channels in one-to-many pattern', async () => {
			mockClient.publish.mockResolvedValue(2); // 2 subscribers

			const result = await messageRouter.routeMessage({
				content: 'Hello, world!',
				sourceChannel: 'input',
				metadata: { type: 'broadcast' },
			});

			expect(result.delivered).toEqual(['channel-1', 'channel-2', 'channel-3']);
			expect(result.failed).toHaveLength(0);
			expect(result.messageId).toMatch(/^msg_\d+_/);
			expect(result.processingTime).toBeGreaterThanOrEqual(0);

			expect(mockClient.publish).toHaveBeenCalledTimes(3);
		});

		it('should route message to single channel in many-to-one pattern', async () => {
			config.pattern = 'many_to_one';
			messageRouter = new MessageRouter(mockRedisManager, config);

			mockClient.publish.mockResolvedValue(1);

			const result = await messageRouter.routeMessage({
				content: 'Aggregated message',
				sourceChannel: 'input-1',
			});

			expect(result.delivered).toEqual(['channel-1']);
			expect(result.failed).toHaveLength(0);
			expect(mockClient.publish).toHaveBeenCalledTimes(1);
		});

		it('should use load balancing for load_balance pattern', async () => {
			config.pattern = 'load_balance';
			messageRouter = new MessageRouter(mockRedisManager, config);

			mockClient.publish.mockResolvedValue(1);

			const result = await messageRouter.routeMessage({
				content: 'Load balanced message',
			});

			expect(result.delivered).toHaveLength(1);
			expect(config.channels).toContain(result.delivered[0]);
		});

		it('should handle routing failures with retries', async () => {
			mockClient.publish
				.mockRejectedValueOnce(new Error('Connection failed'))
				.mockRejectedValueOnce(new Error('Connection failed'))
				.mockResolvedValueOnce(1); // Success on third attempt

			const result = await messageRouter.routeMessage({
				content: 'Retry test message',
			});

			// Should succeed for all channels after retries
			expect(result.delivered).toEqual(['channel-1', 'channel-2', 'channel-3']);
			expect(result.failed).toHaveLength(0);

			// Should have made 3 attempts for each channel (2 failures + 1 success)
			expect(mockClient.publish).toHaveBeenCalledTimes(9); // 3 channels × 3 attempts
		});

		it('should mark channels as failed after max retries', async () => {
			mockClient.publish.mockRejectedValue(new Error('Persistent failure'));

			const result = await messageRouter.routeMessage({
				content: 'Failure test message',
			});

			expect(result.delivered).toHaveLength(0);
			expect(result.failed).toEqual(['channel-1', 'channel-2', 'channel-3']);
		});

		it('should handle empty channel configuration', async () => {
			config.channels = [];
			messageRouter = new MessageRouter(mockRedisManager, config);

			const result = await messageRouter.routeMessage({
				content: 'No channels message',
			});

			expect(result.delivered).toHaveLength(0);
			expect(result.failed).toHaveLength(0);
		});
	});

	describe('Topic-Based Routing', () => {
		const sampleRules: RoutingRule[] = [
			{
				name: 'error-rule',
				condition: 'contains:error',
				targetChannel: 'error-channel',
				priority: 10,
				enabled: true,
			},
			{
				name: 'warning-rule',
				condition: 'starts_with:warning',
				targetChannel: 'warning-channel',
				priority: 5,
				enabled: true,
			},
			{
				name: 'info-rule',
				condition: 'regex:info|information',
				targetChannel: 'info-channel',
				priority: 1,
				enabled: true,
			},
		];

		beforeEach(() => {
			config.pattern = 'topic_based';
			messageRouter = new MessageRouter(mockRedisManager, config);

			// Mock routing rules
			mockClient.hGetAll.mockResolvedValue({
				'error-rule': JSON.stringify(sampleRules[0]),
				'warning-rule': JSON.stringify(sampleRules[1]),
				'info-rule': JSON.stringify(sampleRules[2]),
			});
		});

		it('should route messages based on content matching rules', async () => {
			mockClient.publish.mockResolvedValue(1);

			const result = await messageRouter.routeMessage({
				content: 'An error occurred in the system',
			});

			expect(result.delivered).toEqual(['error-channel']);
			expect(mockClient.publish).toHaveBeenCalledWith(
				'test_router:channel:error-channel',
				expect.stringContaining('An error occurred in the system')
			);
		});

		it('should route messages based on starts_with condition', async () => {
			mockClient.publish.mockResolvedValue(1);

			const result = await messageRouter.routeMessage({
				content: 'Warning: Low disk space',
			});

			expect(result.delivered).toEqual(['warning-channel']);
		});

		it('should route messages based on regex condition', async () => {
			mockClient.publish.mockResolvedValue(1);

			const result = await messageRouter.routeMessage({
				content: 'Here is some information for you',
			});

			expect(result.delivered).toEqual(['info-channel']);
		});

		it('should route to multiple channels if multiple rules match', async () => {
			// Add a rule that matches everything
			const broadcastRule: RoutingRule = {
				name: 'broadcast-rule',
				condition: 'contains:system',
				targetChannel: 'broadcast-channel',
				priority: 15,
				enabled: true,
			};

			mockClient.hGetAll.mockResolvedValue({
				'error-rule': JSON.stringify(sampleRules[0]),
				'broadcast-rule': JSON.stringify(broadcastRule),
			});

			mockClient.publish.mockResolvedValue(1);

			const result = await messageRouter.routeMessage({
				content: 'System error detected',
			});

			expect(result.delivered).toEqual(['broadcast-channel', 'error-channel']);
		});

		it('should use default channels when no rules match', async () => {
			mockClient.publish.mockResolvedValue(1);

			const result = await messageRouter.routeMessage({
				content: 'This message matches no rules',
			});

			expect(result.delivered).toEqual(['channel-1', 'channel-2', 'channel-3']);
		});

		it('should skip disabled rules', async () => {
			const disabledRules = {
				'error-rule': JSON.stringify({ ...sampleRules[0], enabled: false }),
				'warning-rule': JSON.stringify(sampleRules[1]),
			};

			mockClient.hGetAll.mockResolvedValue(disabledRules);
			mockClient.publish.mockResolvedValue(1);

			const result = await messageRouter.routeMessage({
				content: 'An error occurred',
			});

			// Should not match disabled error rule, use default channels
			expect(result.delivered).toEqual(['channel-1', 'channel-2', 'channel-3']);
		});

		it('should handle metadata-based routing', async () => {
			const metadataRule: RoutingRule = {
				name: 'metadata-rule',
				condition: 'metadata:priority=high',
				targetChannel: 'high-priority-channel',
				priority: 20,
				enabled: true,
			};

			mockClient.hGetAll.mockResolvedValue({
				'metadata-rule': JSON.stringify(metadataRule),
			});

			mockClient.publish.mockResolvedValue(1);

			const result = await messageRouter.routeMessage({
				content: 'Important message',
				metadata: { priority: 'high' },
			});

			expect(result.delivered).toEqual(['high-priority-channel']);
		});
	});

	describe('Pub/Sub Operations', () => {
		let mockSubscriber: any;

		beforeEach(() => {
			mockSubscriber = {
				connect: jest.fn().mockResolvedValue(undefined),
				subscribe: jest.fn().mockResolvedValue(undefined),
				unsubscribe: jest.fn().mockResolvedValue(undefined),
				quit: jest.fn().mockResolvedValue(undefined),
			};

			mockClient.duplicate.mockReturnValue(mockSubscriber);
		});

		it('should subscribe to channels', async () => {
			const callback = jest.fn();

			await messageRouter.subscribe('test-channel', callback);

			expect(mockClient.duplicate).toHaveBeenCalled();
			expect(mockSubscriber.connect).toHaveBeenCalled();
			expect(mockSubscriber.subscribe).toHaveBeenCalledWith(
				'test_router:channel:test-channel',
				expect.any(Function)
			);
		});

		it('should unsubscribe from channels', async () => {
			const callback = jest.fn();

			await messageRouter.subscribe('test-channel', callback);
			await messageRouter.unsubscribe('test-channel');

			expect(mockSubscriber.unsubscribe).toHaveBeenCalledWith(
				'test_router:channel:test-channel'
			);
			expect(mockSubscriber.quit).toHaveBeenCalled();
		});

		it('should publish messages to channels', async () => {
			mockClient.publish.mockResolvedValue(3);

			const subscriberCount = await messageRouter.publish('test-channel', 'Hello');

			expect(subscriberCount).toBe(3);
			expect(mockClient.publish).toHaveBeenCalledWith(
				'test_router:channel:test-channel',
				'Hello'
			);
		});

		it('should handle subscription callbacks correctly', async () => {
			const callback = jest.fn();
			let subscriptionCallback: any;

			mockSubscriber.subscribe.mockImplementation((channel, cb) => {
				subscriptionCallback = cb;
				return Promise.resolve();
			});

			await messageRouter.subscribe('test-channel', callback);

			// Simulate receiving a message
			subscriptionCallback('test message', 'test_router:channel:test-channel');

			expect(callback).toHaveBeenCalledWith('test message', 'test-channel');
		});
	});

	describe('Router Lifecycle', () => {
		it('should start router for many-to-one pattern', async () => {
			config.pattern = 'many_to_one';
			config.channels = ['input-1', 'input-2'];
			messageRouter = new MessageRouter(mockRedisManager, config);

			const mockSubscriber = {
				connect: jest.fn().mockResolvedValue(undefined),
				subscribe: jest.fn().mockResolvedValue(undefined),
			};
			mockClient.duplicate.mockReturnValue(mockSubscriber);

			await messageRouter.start();

			expect(messageRouter.isActive()).toBe(true);
			expect(mockClient.duplicate).toHaveBeenCalledTimes(2); // For each input channel
		});

		it('should not start if already running', async () => {
			await messageRouter.start();
			mockClient.duplicate.mockClear();

			await messageRouter.start(); // Second start call

			expect(mockClient.duplicate).not.toHaveBeenCalled();
		});

		it('should stop router and clean up subscriptions', async () => {
			const mockSubscriber = {
				connect: jest.fn().mockResolvedValue(undefined),
				subscribe: jest.fn().mockResolvedValue(undefined),
				unsubscribe: jest.fn().mockResolvedValue(undefined),
				quit: jest.fn().mockResolvedValue(undefined),
			};
			mockClient.duplicate.mockReturnValue(mockSubscriber);

			await messageRouter.subscribe('test-channel', jest.fn());
			await messageRouter.stop();

			expect(messageRouter.isActive()).toBe(false);
			expect(mockSubscriber.unsubscribe).toHaveBeenCalled();
			expect(mockSubscriber.quit).toHaveBeenCalled();
		});
	});

	describe('Routing Rules Management', () => {
		const sampleRule: RoutingRule = {
			name: 'test-rule',
			condition: 'contains:test',
			targetChannel: 'test-channel',
			priority: 5,
			enabled: true,
		};

		it('should add routing rules', async () => {
			await messageRouter.addRoutingRule(sampleRule);

			expect(mockClient.hSet).toHaveBeenCalledWith(
				'test_router:rules',
				'test-rule',
				JSON.stringify(sampleRule)
			);
		});

		it('should remove routing rules', async () => {
			await messageRouter.removeRoutingRule('test-rule');

			expect(mockClient.hDel).toHaveBeenCalledWith(
				'test_router:rules',
				'test-rule'
			);
		});

		it('should get all routing rules sorted by priority', async () => {
			const rules = {
				'low-priority': JSON.stringify({ ...sampleRule, name: 'low-priority', priority: 1 }),
				'high-priority': JSON.stringify({ ...sampleRule, name: 'high-priority', priority: 10 }),
				'medium-priority': JSON.stringify({ ...sampleRule, name: 'medium-priority', priority: 5 }),
			};

			mockClient.hGetAll.mockResolvedValue(rules);

			const result = await messageRouter.getRoutingRules();

			expect(result).toHaveLength(3);
			expect(result[0].name).toBe('high-priority'); // Highest priority first
			expect(result[1].name).toBe('medium-priority');
			expect(result[2].name).toBe('low-priority');
		});

		it('should handle corrupted routing rules gracefully', async () => {
			const rules = {
				'valid-rule': JSON.stringify(sampleRule),
				'invalid-rule': 'invalid-json-data',
			};

			mockClient.hGetAll.mockResolvedValue(rules);

			const result = await messageRouter.getRoutingRules();

			expect(result).toHaveLength(1);
			expect(result[0].name).toBe('test-rule');
		});
	});

	describe('Statistics and Analytics', () => {
		it('should collect and return routing statistics', async () => {
			const statsData = {
				'channel:channel-1': '100',
				'channel:channel-2': '150',
				'channel:channel-3': '75',
				'failures': '10',
				'processing_time': '5000',
			};

			mockClient.hGetAll.mockResolvedValue(statsData);

			const stats = await messageRouter.getStats();

			expect(stats).toEqual({
				totalMessages: 325,
				totalChannels: 3,
				messagesPerChannel: {
					'channel-1': 100,
					'channel-2': 150,
					'channel-3': 75,
				},
				failureRate: 10 / 325,
				averageProcessingTime: 5000 / 325,
			});
		});

		it('should handle empty statistics', async () => {
			mockClient.hGetAll.mockResolvedValue({});

			const stats = await messageRouter.getStats();

			expect(stats).toEqual({
				totalMessages: 0,
				totalChannels: 3,
				messagesPerChannel: {},
				failureRate: 0,
				averageProcessingTime: 0,
			});
		});

		it('should log routing events for analytics', async () => {
			const mockPipeline = {
				hIncrBy: jest.fn().mockReturnThis(),
				exec: jest.fn().mockResolvedValue([]),
			};
			mockClient.multi.mockReturnValue(mockPipeline);
			mockClient.publish.mockResolvedValue(1);

			await messageRouter.routeMessage({
				content: 'Analytics test message',
			});

			expect(mockClient.multi).toHaveBeenCalled();
			expect(mockPipeline.hIncrBy).toHaveBeenCalledWith(
				'test_router:stats',
				'channel:channel-1',
				1
			);
		});
	});

	describe('Pattern Matching', () => {
		const testCases = [
			{
				condition: 'contains:error',
				content: 'An error occurred',
				metadata: {},
				expected: true,
			},
			{
				condition: 'starts_with:warning',
				content: 'Warning: Low memory',
				metadata: {},
				expected: true,
			},
			{
				condition: 'ends_with:success',
				content: 'Operation completed success',
				metadata: {},
				expected: true,
			},
			{
				condition: 'regex:^[A-Z]+$',
				content: 'UPPERCASE',
				metadata: {},
				expected: true,
			},
			{
				condition: 'metadata:priority=high',
				content: 'Any content',
				metadata: { priority: 'high' },
				expected: true,
			},
			{
				condition: 'exact match',
				content: 'exact match',
				metadata: {},
				expected: true,
			},
			{
				condition: 'contains:missing',
				content: 'This does not contain the word',
				metadata: {},
				expected: false,
			},
		];

		testCases.forEach(({ condition, content, metadata, expected }) => {
			it(`should ${expected ? 'match' : 'not match'} condition: ${condition}`, () => {
				const rule: RoutingRule = {
					name: 'test-rule',
					condition,
					targetChannel: 'test-channel',
					priority: 1,
					enabled: true,
				};

				const result = (messageRouter as any).matchesRule(content, rule, metadata);
				expect(result).toBe(expected);
			});
		});

		it('should handle invalid regex patterns gracefully', () => {
			const rule: RoutingRule = {
				name: 'invalid-regex',
				condition: 'regex:[invalid',
				targetChannel: 'test-channel',
				priority: 1,
				enabled: true,
			};

			const result = (messageRouter as any).matchesRule('test content', rule, {});
			expect(result).toBe(false);
		});
	});

	describe('Configuration Management', () => {
		it('should get current configuration', () => {
			const currentConfig = messageRouter.getConfig();

			expect(currentConfig).toEqual(expect.objectContaining({
				pattern: 'one_to_many',
				channels: ['channel-1', 'channel-2', 'channel-3'],
				enablePatternMatching: true,
				retryAttempts: 3,
			}));
		});

		it('should update configuration', () => {
			const newConfig = {
				retryAttempts: 5,
				retryDelay: 2000,
				channels: ['new-channel-1', 'new-channel-2'],
			};

			messageRouter.updateConfig(newConfig);

			const updatedConfig = messageRouter.getConfig();
			expect(updatedConfig.retryAttempts).toBe(5);
			expect(updatedConfig.retryDelay).toBe(2000);
			expect(updatedConfig.channels).toEqual(['new-channel-1', 'new-channel-2']);
		});
	});

	describe('Error Handling', () => {
		it('should handle Redis operation failures', async () => {
			(mockRedisManager.executeOperation as jest.Mock).mockRejectedValueOnce(
				new Error('Redis connection failed')
			);

			await expect(messageRouter.routeMessage({
				content: 'Test message',
			})).rejects.toThrow(NodeOperationError);
		});

		it('should handle subscription failures gracefully', async () => {
			mockClient.duplicate.mockImplementation(() => {
				throw new Error('Failed to create subscriber');
			});

			await expect(messageRouter.subscribe('test-channel', jest.fn()))
				.rejects.toThrow();
		});

		it('should handle message parsing failures in incoming messages', async () => {
			const invalidMessage = 'invalid-json-message';
			
			// Should not throw error, just log warning
			await (messageRouter as any).handleIncomingMessage(invalidMessage, 'source-channel');

			// Test passes if no error is thrown
		});

		it('should handle rule matching failures gracefully', () => {
			const rule: RoutingRule = {
				name: 'problematic-rule',
				condition: 'metadata:complex.nested.key=value',
				targetChannel: 'test-channel',
				priority: 1,
				enabled: true,
			};

			// Should not throw error, return false
			const result = (messageRouter as any).matchesRule('test', rule, null);
			expect(result).toBe(false);
		});
	});

	describe('Load Balancing', () => {
		it('should distribute messages across channels using round-robin', () => {
			config.pattern = 'load_balance';
			config.channels = ['lb-1', 'lb-2', 'lb-3'];
			messageRouter = new MessageRouter(mockRedisManager, config);

			const selectedChannels = new Set();
			
			// Test multiple selections to see distribution
			for (let i = 0; i < 10; i++) {
				jest.setSystemTime(new Date(Date.now() + i * 1000));
				const channel = (messageRouter as any).selectChannelByLoad();
				selectedChannels.add(channel);
			}

			// Should select different channels
			expect(selectedChannels.size).toBeGreaterThan(1);
		});

		it('should handle empty channels list in load balancing', () => {
			config.pattern = 'load_balance';
			config.channels = [];
			messageRouter = new MessageRouter(mockRedisManager, config);

			const channel = (messageRouter as any).selectChannelByLoad();
			expect(channel).toBe('default');
		});
	});

	describe('Performance Considerations', () => {
		it('should handle large numbers of channels efficiently', async () => {
			const manyChannels = Array.from({ length: 100 }, (_, i) => `channel-${i}`);
			config.channels = manyChannels;
			messageRouter = new MessageRouter(mockRedisManager, config);

			mockClient.publish.mockResolvedValue(1);

			const startTime = Date.now();
			await messageRouter.routeMessage({
				content: 'Performance test message',
			});
			const endTime = Date.now();

			expect(endTime - startTime).toBeLessThan(5000); // Should complete reasonably quickly
			expect(mockClient.publish).toHaveBeenCalledTimes(100);
		});

		it('should generate unique message IDs', () => {
			const id1 = (messageRouter as any).generateMessageId();
			const id2 = (messageRouter as any).generateMessageId();

			expect(id1).toMatch(/^msg_\d+_[a-z0-9]+$/);
			expect(id2).toMatch(/^msg_\d+_[a-z0-9]+$/);
			expect(id1).not.toBe(id2);
		});

		it('should generate correct channel keys', () => {
			const channelKey = (messageRouter as any).generateChannelKey('test-channel');
			expect(channelKey).toBe('test_router:channel:test-channel');

			const extractedChannel = (messageRouter as any).extractChannelFromKey(channelKey);
			expect(extractedChannel).toBe('test-channel');
		});
	});
});