import { MessageBuffer, BufferConfig, BufferedMessage, BufferState } from '../managers/MessageBuffer';
import { RedisManager } from '../managers/RedisManager';

// Mock RedisManager
const mockRedisManager = {
	executeOperation: jest.fn(),
} as unknown as RedisManager;

// Mock Redis client
const mockClient = {
	get: jest.fn(),
	setEx: jest.fn(),
	del: jest.fn(),
	keys: jest.fn(),
	multi: jest.fn(),
	xAdd: jest.fn(),
	xTrim: jest.fn(),
	xRange: jest.fn(),
};

describe('MessageBuffer', () => {
	let messageBuffer: MessageBuffer;
	let config: Partial<BufferConfig>;

	beforeEach(() => {
		jest.clearAllMocks();
		jest.useFakeTimers();
		jest.setSystemTime(new Date('2024-01-01T00:00:00Z'));

		config = {
			pattern: 'collect_send',
			maxSize: 10,
			flushInterval: 30,
			enableStreams: true,
			streamMaxLength: 1000,
			priorityLevels: 3,
			keyPrefix: 'test_buffer',
			enableCompression: false,
			retentionTime: 3600,
		};

		messageBuffer = new MessageBuffer(mockRedisManager, config);

		// Default mock implementation
		(mockRedisManager.executeOperation as jest.Mock).mockImplementation(
			async (operation) => operation(mockClient)
		);
	});

	afterEach(() => {
		messageBuffer.cleanup();
		jest.useRealTimers();
	});

	describe('Message Addition', () => {
		it('should add message to buffer successfully', async () => {
			const bufferId = 'test-buffer';
			const message = {
				content: 'Hello, world!',
				priority: 1,
				userId: 'user-123',
				metadata: { source: 'web' },
			};

			// Mock empty buffer state
			mockClient.get.mockResolvedValueOnce(null);
			mockClient.xAdd.mockResolvedValueOnce('123-456');

			const result = await messageBuffer.addMessage(bufferId, message);

			expect(result).toMatchObject({
				bufferId,
				messageId: expect.stringMatching(/^msg_\d+_/),
				shouldFlush: false,
			});

			expect(mockClient.xAdd).toHaveBeenCalledWith(
				'test_buffer:stream:test-buffer',
				'*',
				expect.objectContaining({
					content: message.content,
					priority: '1',
					userId: message.userId,
				})
			);

			expect(mockClient.setEx).toHaveBeenCalledWith(
				'test_buffer:test-buffer',
				3600,
				expect.any(String)
			);
		});

		it('should trigger flush when buffer reaches max size', async () => {
			const bufferId = 'test-buffer';
			const existingState: BufferState = {
				bufferId,
				pattern: 'collect_send',
				messages: Array.from({ length: 9 }, (_, i) => ({
					id: `msg-${i}`,
					content: `Message ${i}`,
					timestamp: Date.now() - i * 1000,
				})),
				totalMessages: 9,
				lastFlush: Date.now() - 60000,
				nextFlush: Date.now() + 30000,
				size: 500,
				maxSize: 10,
			};

			mockClient.get.mockResolvedValueOnce(JSON.stringify(existingState));

			const result = await messageBuffer.addMessage(bufferId, {
				content: 'Final message',
			});

			expect(result.shouldFlush).toBe(true);
		});

		it('should trigger flush for high priority messages', async () => {
			config.pattern = 'priority';
			config.priorityLevels = 3;
			messageBuffer = new MessageBuffer(mockRedisManager, config);

			const bufferId = 'priority-buffer';
			const existingState: BufferState = {
				bufferId,
				pattern: 'priority',
				messages: [
					{
						id: 'msg-1',
						content: 'Low priority',
						timestamp: Date.now(),
						priority: 0,
					},
				],
				totalMessages: 1,
				lastFlush: Date.now() - 60000,
				nextFlush: Date.now() + 30000,
				size: 100,
				maxSize: 10,
			};

			mockClient.get.mockResolvedValueOnce(JSON.stringify(existingState));

			const result = await messageBuffer.addMessage(bufferId, {
				content: 'High priority message',
				priority: 2, // High priority (threshold = priorityLevels - 1 = 2)
			});

			expect(result.shouldFlush).toBe(true);
		});

		it('should handle stream operations when enabled', async () => {
			const bufferId = 'stream-buffer';
			const message = {
				content: 'Stream message',
				metadata: { type: 'test' },
			};

			mockClient.get.mockResolvedValueOnce(null);

			await messageBuffer.addMessage(bufferId, message);

			expect(mockClient.xAdd).toHaveBeenCalledWith(
				'test_buffer:stream:stream-buffer',
				'*',
				expect.objectContaining({
					content: message.content,
					metadata: JSON.stringify(message.metadata),
				})
			);

			expect(mockClient.xTrim).toHaveBeenCalledWith(
				'test_buffer:stream:stream-buffer',
				'MAXLEN',
				'~',
				1000
			);
		});

		it('should not use streams when disabled', async () => {
			config.enableStreams = false;
			messageBuffer = new MessageBuffer(mockRedisManager, config);

			const bufferId = 'no-stream-buffer';
			mockClient.get.mockResolvedValueOnce(null);

			await messageBuffer.addMessage(bufferId, {
				content: 'No stream message',
			});

			expect(mockClient.xAdd).not.toHaveBeenCalled();
			expect(mockClient.xTrim).not.toHaveBeenCalled();
		});
	});

	describe('Buffer Flushing', () => {
		const sampleMessages: BufferedMessage[] = [
			{
				id: 'msg-1',
				content: 'Message 1',
				timestamp: Date.now() - 3000,
				priority: 0,
			},
			{
				id: 'msg-2',
				content: 'Message 2',
				timestamp: Date.now() - 2000,
				priority: 1,
			},
			{
				id: 'msg-3',
				content: 'Message 3',
				timestamp: Date.now() - 1000,
				priority: 2,
			},
		];

		describe('Collect and Send Pattern', () => {
			it('should flush all messages', async () => {
				const bufferId = 'collect-buffer';
				const bufferState: BufferState = {
					bufferId,
					pattern: 'collect_send',
					messages: [...sampleMessages],
					totalMessages: 3,
					lastFlush: Date.now() - 60000,
					nextFlush: Date.now() + 30000,
					size: 300,
					maxSize: 10,
				};

				mockClient.get.mockResolvedValueOnce(JSON.stringify(bufferState));

				const result = await messageBuffer.flush(bufferId, 'manual');

				expect(result.flushedMessages).toHaveLength(3);
				expect(result.remainingMessages).toHaveLength(0);
				expect(result.trigger).toBe('manual');
				expect(result.processingTime).toBeGreaterThanOrEqual(0);
			});
		});

		describe('Throttle Pattern', () => {
			it('should flush messages up to max size', async () => {
				config.pattern = 'throttle';
				messageBuffer = new MessageBuffer(mockRedisManager, config);

				const bufferId = 'throttle-buffer';
				const manyMessages = Array.from({ length: 15 }, (_, i) => ({
					id: `msg-${i}`,
					content: `Message ${i}`,
					timestamp: Date.now() - i * 1000,
				}));

				const bufferState: BufferState = {
					bufferId,
					pattern: 'throttle',
					messages: manyMessages,
					totalMessages: 15,
					lastFlush: Date.now() - 60000,
					nextFlush: Date.now() + 30000,
					size: 1500,
					maxSize: 10,
				};

				mockClient.get.mockResolvedValueOnce(JSON.stringify(bufferState));

				const result = await messageBuffer.flush(bufferId, 'size');

				expect(result.flushedMessages).toHaveLength(10);
				expect(result.remainingMessages).toHaveLength(5);
			});
		});

		describe('Batch Pattern', () => {
			it('should flush messages in batches', async () => {
				config.pattern = 'batch';
				messageBuffer = new MessageBuffer(mockRedisManager, config);

				const bufferId = 'batch-buffer';
				const bufferState: BufferState = {
					bufferId,
					pattern: 'batch',
					messages: [...sampleMessages],
					totalMessages: 3,
					lastFlush: Date.now() - 60000,
					nextFlush: Date.now() + 30000,
					size: 300,
					maxSize: 10,
				};

				mockClient.get.mockResolvedValueOnce(JSON.stringify(bufferState));

				const result = await messageBuffer.flush(bufferId, 'time');

				expect(result.flushedMessages.length).toBeLessThanOrEqual(5); // maxSize / 2
				expect(result.flushedMessages.length + result.remainingMessages.length).toBe(3);
			});
		});

		describe('Priority Pattern', () => {
			it('should flush high priority messages first', async () => {
				config.pattern = 'priority';
				config.priorityLevels = 3;
				messageBuffer = new MessageBuffer(mockRedisManager, config);

				const bufferId = 'priority-buffer';
				const bufferState: BufferState = {
					bufferId,
					pattern: 'priority',
					messages: [...sampleMessages],
					totalMessages: 3,
					lastFlush: Date.now() - 60000,
					nextFlush: Date.now() + 30000,
					size: 300,
					maxSize: 10,
				};

				mockClient.get.mockResolvedValueOnce(JSON.stringify(bufferState));

				const result = await messageBuffer.flush(bufferId, 'priority');

				// Should flush only high priority messages (priority >= 2)
				expect(result.flushedMessages).toHaveLength(1);
				expect(result.flushedMessages[0].priority).toBe(2);
				expect(result.remainingMessages).toHaveLength(2);
			});
		});

		it('should handle empty buffer flush', async () => {
			const bufferId = 'empty-buffer';
			mockClient.get.mockResolvedValueOnce(null);

			const result = await messageBuffer.flush(bufferId);

			expect(result.flushedMessages).toHaveLength(0);
			expect(result.remainingMessages).toHaveLength(0);
			expect(result.processingTime).toBe(0);
		});

		it('should log flush events to stream when enabled', async () => {
			const bufferId = 'logged-buffer';
			const bufferState: BufferState = {
				bufferId,
				pattern: 'collect_send',
				messages: [sampleMessages[0]],
				totalMessages: 1,
				lastFlush: Date.now() - 60000,
				nextFlush: Date.now() + 30000,
				size: 100,
				maxSize: 10,
			};

			mockClient.get.mockResolvedValueOnce(JSON.stringify(bufferState));

			await messageBuffer.flush(bufferId, 'manual');

			expect(mockClient.xAdd).toHaveBeenCalledWith(
				'test_buffer:flushes',
				'*',
				expect.objectContaining({
					bufferId,
					trigger: 'manual',
					messageCount: '1',
				})
			);
		});
	});

	describe('Buffer Management', () => {
		it('should get buffer state', async () => {
			const bufferId = 'get-buffer';
			const bufferState: BufferState = {
				bufferId,
				pattern: 'collect_send',
				messages: [{
					id: 'msg-1',
					content: 'Test message',
					timestamp: Date.now() - 3000,
					priority: 0,
				}],
				totalMessages: 1,
				lastFlush: Date.now() - 60000,
				nextFlush: Date.now() + 30000,
				size: 100,
				maxSize: 10,
			};

			mockClient.get.mockResolvedValueOnce(JSON.stringify(bufferState));

			const result = await messageBuffer.getBuffer(bufferId);

			expect(result).toEqual(bufferState);
		});

		it('should return null for non-existent buffer', async () => {
			const bufferId = 'non-existent';
			mockClient.get.mockResolvedValueOnce(null);

			const result = await messageBuffer.getBuffer(bufferId);

			expect(result).toBeNull();
		});

		it('should clear buffer completely', async () => {
			const bufferId = 'clear-buffer';
			const mockPipeline = {
				del: jest.fn().mockReturnThis(),
				exec: jest.fn().mockResolvedValue([{ reply: 1 }, { reply: 1 }]),
			};
			mockClient.multi.mockReturnValue(mockPipeline);

			const result = await messageBuffer.clearBuffer(bufferId);

			expect(result).toBe(true);
			expect(mockPipeline.del).toHaveBeenCalledWith('test_buffer:clear-buffer');
			expect(mockPipeline.del).toHaveBeenCalledWith('test_buffer:stream:clear-buffer');
		});

		it('should handle buffer clearing without streams', async () => {
			config.enableStreams = false;
			messageBuffer = new MessageBuffer(mockRedisManager, config);

			const bufferId = 'clear-no-stream';
			const mockPipeline = {
				del: jest.fn().mockReturnThis(),
				exec: jest.fn().mockResolvedValue([{ reply: 1 }]),
			};
			mockClient.multi.mockReturnValue(mockPipeline);

			await messageBuffer.clearBuffer(bufferId);

			expect(mockPipeline.del).toHaveBeenCalledTimes(1);
			expect(mockPipeline.del).toHaveBeenCalledWith('test_buffer:clear-no-stream');
		});
	});

	describe('Timer Management', () => {
		it('should schedule automatic flush based on time interval', async () => {
			const bufferId = 'timer-buffer';
			mockClient.get.mockResolvedValueOnce(null);

			await messageBuffer.addMessage(bufferId, {
				content: 'Timer test message',
			});

			// Advance time to trigger flush
			jest.advanceTimersByTime(30000);

			// Verify timer was scheduled
			expect(setTimeout).toHaveBeenCalledWith(
				expect.any(Function),
				expect.any(Number)
			);
		});

		it('should cancel buffer operations', () => {
			const bufferId = 'cancel-buffer';

			messageBuffer.cancelBuffer(bufferId);

			// Verify cancellation state is set
			expect((messageBuffer as any).cancellationTokens.get(bufferId)).toBe(true);
		});

		it('should resume buffer operations', () => {
			const bufferId = 'resume-buffer';

			messageBuffer.cancelBuffer(bufferId);
			messageBuffer.resumeBuffer(bufferId);

			// Verify cancellation state is cleared
			expect((messageBuffer as any).cancellationTokens.has(bufferId)).toBe(false);
		});

		it('should cleanup all timers on shutdown', () => {
			const bufferId1 = 'cleanup-1';
			const bufferId2 = 'cleanup-2';

			// Simulate active timers
			(messageBuffer as any).flushTimers.set(bufferId1, setTimeout(() => {}, 1000));
			(messageBuffer as any).flushTimers.set(bufferId2, setTimeout(() => {}, 2000));

			messageBuffer.cleanup();

			expect((messageBuffer as any).flushTimers.size).toBe(0);
			expect(clearTimeout).toHaveBeenCalledTimes(2);
		});
	});

	describe('Statistics and Monitoring', () => {
		it('should calculate buffer statistics', async () => {
			const bufferKeys = [
				'test_buffer:buffer-1',
				'test_buffer:buffer-2',
				'test_buffer:buffer-3',
			];

			const buffer1State: BufferState = {
				bufferId: 'buffer-1',
				pattern: 'collect_send',
				messages: [
					{
						id: 'msg-1',
						content: 'Message 1',
						timestamp: Date.now() - 10000,
					},
					{
						id: 'msg-2',
						content: 'Message 2',
						timestamp: Date.now() - 5000,
					},
				],
				totalMessages: 2,
				lastFlush: Date.now() - 60000,
				nextFlush: Date.now() + 30000,
				size: 200,
				maxSize: 10,
			};

			const buffer2State: BufferState = {
				bufferId: 'buffer-2',
				pattern: 'throttle',
				messages: [
					{
						id: 'msg-3',
						content: 'Message 3',
						timestamp: Date.now() - 15000,
					},
				],
				totalMessages: 1,
				lastFlush: Date.now() - 30000,
				nextFlush: Date.now() + 60000,
				size: 100,
				maxSize: 10,
			};

			mockClient.keys.mockResolvedValueOnce(bufferKeys);
			mockClient.get
				.mockResolvedValueOnce(JSON.stringify(buffer1State))
				.mockResolvedValueOnce(JSON.stringify(buffer2State))
				.mockResolvedValueOnce('invalid-json'); // Third buffer corrupted

			// Mock flush count from streams
			mockClient.xRange.mockResolvedValueOnce([
				{ id: '123-1', fields: {} },
				{ id: '123-2', fields: {} },
			]);

			const stats = await messageBuffer.getStats();

			expect(stats).toMatchObject({
				totalBuffers: 2, // Only valid buffers counted
				totalMessages: 3,
				averageBufferSize: 1.5,
				oldestMessage: expect.any(Number),
				newestMessage: expect.any(Number),
				flushesLast24h: 2,
			});
		});

		it('should handle statistics calculation with no buffers', async () => {
			mockClient.keys.mockResolvedValueOnce([]);

			const stats = await messageBuffer.getStats();

			expect(stats).toMatchObject({
				totalBuffers: 0,
				totalMessages: 0,
				averageBufferSize: 0,
				oldestMessage: 0,
				newestMessage: 0,
				flushesLast24h: 0,
			});
		});
	});

	describe('Configuration Management', () => {
		it('should get current configuration', () => {
			const currentConfig = messageBuffer.getConfig();

			expect(currentConfig).toEqual(expect.objectContaining({
				pattern: 'collect_send',
				maxSize: 10,
				flushInterval: 30,
				enableStreams: true,
			}));
		});

		it('should update configuration', () => {
			const newConfig = {
				maxSize: 20,
				flushInterval: 60,
				pattern: 'throttle' as const,
			};

			messageBuffer.updateConfig(newConfig);

			const updatedConfig = messageBuffer.getConfig();
			expect(updatedConfig.maxSize).toBe(20);
			expect(updatedConfig.flushInterval).toBe(60);
			expect(updatedConfig.pattern).toBe('throttle');
		});
	});

	describe('Error Handling', () => {
		it('should handle Redis operation failures', async () => {
			(mockRedisManager.executeOperation as jest.Mock).mockRejectedValueOnce(
				new Error('Redis connection failed')
			);

			await expect(messageBuffer.addMessage('test-buffer', {
				content: 'Test message',
			})).rejects.toThrow('Redis connection failed');
		});

		it('should handle corrupted buffer state gracefully', async () => {
			const bufferId = 'corrupted-buffer';
			mockClient.get.mockResolvedValueOnce('invalid-json-data');

			const result = await messageBuffer.getBuffer(bufferId);

			expect(result).toBeNull();
		});

		it('should handle flush failures gracefully', async () => {
			const bufferId = 'flush-error-buffer';
			
			// Mock successful initial operations but failure during flush
			mockClient.get.mockResolvedValueOnce(null);
			(mockRedisManager.executeOperation as jest.Mock)
				.mockImplementationOnce(async (operation) => operation(mockClient))
				.mockImplementationOnce(async () => {
					throw new Error('Flush operation failed');
				});

			// Should not throw during add
			await messageBuffer.addMessage(bufferId, {
				content: 'Test message',
			});

			// Flush error should be handled gracefully
			expect(console.error).not.toHaveBeenCalled();
		});
	});

	describe('Performance Considerations', () => {
		it('should handle large numbers of messages efficiently', async () => {
			const bufferId = 'large-buffer';
			const largeMessageCount = 1000;
			
			const existingState: BufferState = {
				bufferId,
				pattern: 'collect_send',
				messages: Array.from({ length: largeMessageCount }, (_, i) => ({
					id: `msg-${i}`,
					content: `Message ${i}`,
					timestamp: Date.now() - i * 100,
				})),
				totalMessages: largeMessageCount,
				lastFlush: Date.now() - 60000,
				nextFlush: Date.now() + 30000,
				size: largeMessageCount * 50,
				maxSize: 10,
			};

			mockClient.get.mockResolvedValueOnce(JSON.stringify(existingState));

			const startTime = Date.now();
			const result = await messageBuffer.flush(bufferId);
			const endTime = Date.now();

			expect(result.flushedMessages).toHaveLength(largeMessageCount);
			expect(endTime - startTime).toBeLessThan(1000); // Should be reasonably fast
		});

		it('should calculate buffer size correctly', () => {
			const messages: BufferedMessage[] = [
				{
					id: 'msg-1',
					content: 'Short',
					timestamp: Date.now(),
				},
				{
					id: 'msg-2',
					content: 'This is a much longer message with more content',
					timestamp: Date.now(),
					metadata: { type: 'long', category: 'test' },
				},
			];

			const size = (messageBuffer as any).calculateBufferSize(messages);
			
			expect(size).toBeGreaterThan(0);
			expect(typeof size).toBe('number');
		});

		it('should generate unique message IDs', () => {
			const id1 = (messageBuffer as any).generateMessageId();
			const id2 = (messageBuffer as any).generateMessageId();

			expect(id1).toMatch(/^msg_\d+_[a-z0-9]+$/);
			expect(id2).toMatch(/^msg_\d+_[a-z0-9]+$/);
			expect(id1).not.toBe(id2);
		});
	});
});