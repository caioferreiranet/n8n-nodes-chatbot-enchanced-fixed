import { UserStorage, StorageConfig, StorageType, StorageQuery } from '../managers/UserStorage';
import { RedisManager } from '../managers/RedisManager';
import { NodeOperationError } from 'n8n-workflow';

// Mock RedisManager
const mockRedisManager = {
	executeOperation: jest.fn(),
} as unknown as RedisManager;

// Mock Redis client
const mockClient = {
	get: jest.fn(),
	set: jest.fn(),
	setEx: jest.fn(),
	del: jest.fn(),
	exists: jest.fn(),
	ttl: jest.fn(),
	expire: jest.fn(),
	keys: jest.fn(),
	multi: jest.fn(),
	hSet: jest.fn(),
	hGetAll: jest.fn(),
	hDel: jest.fn(),
	lPush: jest.fn(),
	lRange: jest.fn(),
	sAdd: jest.fn(),
	sMembers: jest.fn(),
	zAdd: jest.fn(),
	zRangeWithScores: jest.fn(),
};

describe('UserStorage', () => {
	let userStorage: UserStorage;
	let config: Partial<StorageConfig>;

	beforeEach(() => {
		jest.clearAllMocks();
		jest.useFakeTimers();
		jest.setSystemTime(new Date('2024-01-01T00:00:00Z'));

		config = {
			defaultTtl: 86400,
			enableTypeDetection: true,
			enableCompression: false,
			keyPrefix: 'test_storage',
			maxValueSize: 1024 * 1024,
			enableIndexing: true,
		};

		userStorage = new UserStorage(mockRedisManager, config);

		// Default mock implementation
		(mockRedisManager.executeOperation as jest.Mock).mockImplementation(
			async (operation) => operation(mockClient)
		);
	});

	afterEach(() => {
		jest.useRealTimers();
	});

	describe('Storage Operations', () => {
		const userId = 'user-123';
		const key = 'test-key';

		it('should store simple values', async () => {
			const value = 'Hello, World!';

			await userStorage.store(userId, key, value);

			expect(mockClient.setEx).toHaveBeenCalledWith(
				'test_storage:user-123:test-key',
				86400,
				expect.stringContaining('"data":"Hello, World!"')
			);
		});

		it('should store hash values', async () => {
			const value = { name: 'John', age: 30, active: true };
			const mockPipeline = {
				hSet: jest.fn().mockReturnThis(),
				hDel: jest.fn().mockReturnThis(),
				del: jest.fn().mockReturnThis(),
				expire: jest.fn().mockReturnThis(),
				exec: jest.fn().mockResolvedValue([]),
			};
			mockClient.multi.mockReturnValue(mockPipeline);

			await userStorage.store(userId, key, value);

			expect(mockClient.hSet).toHaveBeenCalledWith(
				'test_storage:user-123:test-key:hash',
				expect.objectContaining({
					name: 'John',
					age: '30',
					active: 'true',
				})
			);
		});

		it('should store array values as lists', async () => {
			const value = ['item1', 'item2', 'item3'];

			await userStorage.store(userId, key, value);

			expect(mockClient.del).toHaveBeenCalledWith('test_storage:user-123:test-key:list');
			expect(mockClient.lPush).toHaveBeenCalledWith(
				'test_storage:user-123:test-key:list',
				'"item1"',
				'"item2"',
				'"item3"'
			);
		});

		it('should store Set values', async () => {
			const value = new Set(['a', 'b', 'c']);

			await userStorage.store(userId, key, value);

			expect(mockClient.del).toHaveBeenCalledWith('test_storage:user-123:test-key:set');
			expect(mockClient.sAdd).toHaveBeenCalledWith(
				'test_storage:user-123:test-key:set',
				'"a"',
				'"b"',
				'"c"'
			);
		});

		it('should store sorted set values', async () => {
			const value = [
				{ value: 'item1', score: 1.0 },
				{ value: 'item2', score: 2.0 },
			];

			await userStorage.store(userId, key, value, { type: 'sorted_set' });

			expect(mockClient.del).toHaveBeenCalledWith('test_storage:user-123:test-key:zset');
			expect(mockClient.zAdd).toHaveBeenCalledWith(
				'test_storage:user-123:test-key:zset',
				{ score: 1.0, value: '"item1"' }
			);
			expect(mockClient.zAdd).toHaveBeenCalledWith(
				'test_storage:user-123:test-key:zset',
				{ score: 2.0, value: '"item2"' }
			);
		});

		it('should respect custom TTL', async () => {
			const value = 'test value';
			const customTtl = 3600;

			await userStorage.store(userId, key, value, { ttl: customTtl });

			expect(mockClient.setEx).toHaveBeenCalledWith(
				expect.any(String),
				customTtl,
				expect.any(String)
			);
		});

		it('should enforce maximum value size', async () => {
			config.maxValueSize = 100;
			userStorage = new UserStorage(mockRedisManager, config);

			const largeValue = 'x'.repeat(200);

			await expect(userStorage.store(userId, key, largeValue)).rejects.toThrow(NodeOperationError);
		});

		it('should update index when enabled', async () => {
			const value = 'indexed value';

			await userStorage.store(userId, key, value);

			expect(mockClient.hSet).toHaveBeenCalledWith(
				'test_storage:index:user-123',
				'test-key',
				expect.stringContaining('"type":"simple"')
			);
		});

		it('should not update index when disabled', async () => {
			config.enableIndexing = false;
			userStorage = new UserStorage(mockRedisManager, config);

			const value = 'non-indexed value';

			await userStorage.store(userId, key, value);

			// Should not call hSet for index
			expect(mockClient.hSet).toHaveBeenCalledTimes(0);
		});
	});

	describe('Retrieval Operations', () => {
		const userId = 'user-123';
		const key = 'test-key';

		it('should retrieve simple values', async () => {
			const storedValue = {
				data: 'Hello, World!',
				type: 'simple',
				createdAt: Date.now(),
				updatedAt: Date.now(),
				ttl: 86400,
			};

			mockClient.get.mockResolvedValueOnce(JSON.stringify(storedValue));

			const result = await userStorage.retrieve(userId, key);

			expect(result).toBe('Hello, World!');
		});

		it('should retrieve hash values', async () => {
			const hashData = {
				name: 'John',
				age: '30',
				active: 'true',
				_storage_meta: JSON.stringify({
					type: 'hash',
					createdAt: Date.now(),
					updatedAt: Date.now(),
				}),
			};

			mockClient.get.mockResolvedValueOnce(null);
			mockClient.exists.mockResolvedValueOnce(1); // hash exists
			mockClient.hGetAll.mockResolvedValueOnce(hashData);

			const result = await userStorage.retrieve(userId, key);

			expect(result).toEqual({
				name: 'John',
				age: 30,
				active: true,
			});
		});

		it('should retrieve list values', async () => {
			const listData = ['"item1"', '"item2"', '"item3"'];

			mockClient.get.mockResolvedValueOnce(null);
			mockClient.exists
				.mockResolvedValueOnce(0) // simple key doesn't exist
				.mockResolvedValueOnce(0) // hash doesn't exist
				.mockResolvedValueOnce(1); // list exists
			mockClient.lRange.mockResolvedValueOnce(listData);

			const result = await userStorage.retrieve(userId, key);

			expect(result).toEqual(['item1', 'item2', 'item3']);
		});

		it('should retrieve set values', async () => {
			const setData = ['"a"', '"b"', '"c"'];

			mockClient.get.mockResolvedValueOnce(null);
			mockClient.exists
				.mockResolvedValueOnce(0) // simple
				.mockResolvedValueOnce(0) // hash
				.mockResolvedValueOnce(0) // list
				.mockResolvedValueOnce(1); // set exists
			mockClient.sMembers.mockResolvedValueOnce(setData);

			const result = await userStorage.retrieve(userId, key);

			expect(result).toEqual(['a', 'b', 'c']);
		});

		it('should retrieve sorted set values', async () => {
			const zsetData = [
				{ value: '"item1"', score: 1.0 },
				{ value: '"item2"', score: 2.0 },
			];

			mockClient.get.mockResolvedValueOnce(null);
			mockClient.exists
				.mockResolvedValueOnce(0) // simple
				.mockResolvedValueOnce(0) // hash
				.mockResolvedValueOnce(0) // list
				.mockResolvedValueOnce(0) // set
				.mockResolvedValueOnce(1); // zset exists
			mockClient.zRangeWithScores.mockResolvedValueOnce(zsetData);

			const result = await userStorage.retrieve(userId, key);

			expect(result).toEqual([
				{ value: 'item1', score: 1.0 },
				{ value: 'item2', score: 2.0 },
			]);
		});

		it('should return null for non-existent keys', async () => {
			mockClient.get.mockResolvedValueOnce(null);
			mockClient.exists.mockResolvedValue(0);

			const result = await userStorage.retrieve(userId, key);

			expect(result).toBeNull();
		});

		it('should handle corrupted simple values gracefully', async () => {
			mockClient.get.mockResolvedValueOnce('invalid-json');
			mockClient.exists.mockResolvedValue(0);

			const result = await userStorage.retrieve(userId, key);

			expect(result).toBe('invalid-json'); // Fallback to raw value
		});
	});

	describe('Deletion Operations', () => {
		const userId = 'user-123';
		const key = 'test-key';

		it('should delete values and clean up all key variations', async () => {
			const mockPipeline = {
				del: jest.fn().mockReturnThis(),
				hDel: jest.fn().mockReturnThis(),
				exec: jest.fn().mockResolvedValue([
					{ reply: 1 }, // simple key deleted
					{ reply: 0 }, // hash key not found
					{ reply: 0 }, // list key not found
					{ reply: 0 }, // set key not found
					{ reply: 0 }, // zset key not found
					{ reply: 1 }, // index updated
				]),
			};
			mockClient.multi.mockReturnValue(mockPipeline);

			const result = await userStorage.delete(userId, key);

			expect(result).toBe(true);
			expect(mockPipeline.del).toHaveBeenCalledTimes(5); // All key variations
			expect(mockPipeline.hDel).toHaveBeenCalledWith(
				'test_storage:index:user-123',
				'test-key'
			);
		});

		it('should return false when no keys are deleted', async () => {
			const mockPipeline = {
				del: jest.fn().mockReturnThis(),
				hDel: jest.fn().mockReturnThis(),
				exec: jest.fn().mockResolvedValue([
					{ reply: 0 },
					{ reply: 0 },
					{ reply: 0 },
					{ reply: 0 },
					{ reply: 0 },
					{ reply: 0 },
				]),
			};
			mockClient.multi.mockReturnValue(mockPipeline);

			const result = await userStorage.delete(userId, key);

			expect(result).toBe(false);
		});
	});

	describe('Existence and TTL Operations', () => {
		const userId = 'user-123';
		const key = 'test-key';

		it('should check if key exists', async () => {
			mockClient.exists
				.mockResolvedValueOnce(1) // simple key exists
				.mockResolvedValueOnce(0)
				.mockResolvedValueOnce(0)
				.mockResolvedValueOnce(0)
				.mockResolvedValueOnce(0);

			const result = await userStorage.exists(userId, key);

			expect(result).toBe(true);
		});

		it('should return false when key does not exist', async () => {
			mockClient.exists.mockResolvedValue(0);

			const result = await userStorage.exists(userId, key);

			expect(result).toBe(false);
		});

		it('should get TTL for existing key', async () => {
			mockClient.ttl
				.mockResolvedValueOnce(3600) // simple key TTL
				.mockResolvedValueOnce(-2)
				.mockResolvedValueOnce(-2)
				.mockResolvedValueOnce(-2)
				.mockResolvedValueOnce(-2);

			const result = await userStorage.getTTL(userId, key);

			expect(result).toBe(3600);
		});

		it('should return -1 for key without TTL', async () => {
			mockClient.ttl
				.mockResolvedValueOnce(-1) // key exists but no TTL
				.mockResolvedValueOnce(-2)
				.mockResolvedValueOnce(-2)
				.mockResolvedValueOnce(-2)
				.mockResolvedValueOnce(-2);

			const result = await userStorage.getTTL(userId, key);

			expect(result).toBe(-1);
		});

		it('should return -2 for non-existent key', async () => {
			mockClient.ttl.mockResolvedValue(-2);

			const result = await userStorage.getTTL(userId, key);

			expect(result).toBe(-2);
		});

		it('should set TTL for keys', async () => {
			const mockPipeline = {
				expire: jest.fn().mockReturnThis(),
				exec: jest.fn().mockResolvedValue([
					{ reply: 1 }, // simple key TTL set
					{ reply: 0 },
					{ reply: 0 },
					{ reply: 0 },
					{ reply: 0 },
				]),
			};
			mockClient.multi.mockReturnValue(mockPipeline);

			const result = await userStorage.setTTL(userId, key, 7200);

			expect(result).toBe(true);
			expect(mockPipeline.expire).toHaveBeenCalledTimes(5); // All key variations
		});
	});

	describe('Key Listing and Querying', () => {
		const userId = 'user-123';

		describe('With Indexing', () => {
			it('should list keys from index', async () => {
				const indexData = {
					'key1': JSON.stringify({ type: 'simple', createdAt: Date.now() - 1000 }),
					'key2': JSON.stringify({ type: 'hash', createdAt: Date.now() - 2000 }),
					'key3': JSON.stringify({ type: 'list', createdAt: Date.now() - 3000 }),
				};

				mockClient.hGetAll.mockResolvedValueOnce(indexData);

				const result = await userStorage.listKeys(userId);

				expect(result).toEqual(['key1', 'key2', 'key3']);
			});

			it('should filter keys by type', async () => {
				const indexData = {
					'key1': JSON.stringify({ type: 'simple', createdAt: Date.now() }),
					'key2': JSON.stringify({ type: 'hash', createdAt: Date.now() }),
					'key3': JSON.stringify({ type: 'simple', createdAt: Date.now() }),
				};

				mockClient.hGetAll.mockResolvedValueOnce(indexData);

				const query: StorageQuery = { type: 'simple' };
				const result = await userStorage.listKeys(userId, query);

				expect(result).toEqual(['key1', 'key3']);
			});

			it('should filter keys by age', async () => {
				const now = Date.now();
				const indexData = {
					'old-key': JSON.stringify({ type: 'simple', createdAt: now - 10000 }),
					'new-key': JSON.stringify({ type: 'simple', createdAt: now - 1000 }),
				};

				mockClient.hGetAll.mockResolvedValueOnce(indexData);

				const query: StorageQuery = { minAge: 5000 }; // Older than 5 seconds
				const result = await userStorage.listKeys(userId, query);

				expect(result).toEqual(['old-key']);
			});

			it('should filter keys by pattern', async () => {
				const indexData = {
					'user-profile': JSON.stringify({ type: 'hash', createdAt: Date.now() }),
					'user-settings': JSON.stringify({ type: 'hash', createdAt: Date.now() }),
					'session-data': JSON.stringify({ type: 'simple', createdAt: Date.now() }),
				};

				mockClient.hGetAll.mockResolvedValueOnce(indexData);

				const query: StorageQuery = { pattern: 'user-*' };
				const result = await userStorage.listKeys(userId, query);

				expect(result).toEqual(['user-profile', 'user-settings']);
			});

			it('should apply pagination', async () => {
				const indexData = {
					'key1': JSON.stringify({ type: 'simple', createdAt: Date.now() }),
					'key2': JSON.stringify({ type: 'simple', createdAt: Date.now() }),
					'key3': JSON.stringify({ type: 'simple', createdAt: Date.now() }),
					'key4': JSON.stringify({ type: 'simple', createdAt: Date.now() }),
				};

				mockClient.hGetAll.mockResolvedValueOnce(indexData);

				const query: StorageQuery = { offset: 1, limit: 2 };
				const result = await userStorage.listKeys(userId, query);

				expect(result).toHaveLength(2);
			});
		});

		describe('Without Indexing', () => {
			beforeEach(() => {
				config.enableIndexing = false;
				userStorage = new UserStorage(mockRedisManager, config);
			});

			it('should list keys using pattern matching', async () => {
				const keys = [
					'test_storage:user-123:key1',
					'test_storage:user-123:key2',
					'test_storage:user-123:key3:hash',
					'test_storage:user-123:key4:list',
				];

				mockClient.keys.mockResolvedValueOnce(keys);

				const result = await userStorage.listKeys(userId);

				expect(result).toEqual(['key1', 'key2']); // Type-specific keys excluded
			});
		});
	});

	describe('Statistics', () => {
		const userId = 'user-123';

		it('should calculate storage statistics', async () => {
			// Mock list keys
			const indexData = {
				'key1': JSON.stringify({ type: 'simple', createdAt: Date.now() - 10000, updatedAt: Date.now() - 5000 }),
				'key2': JSON.stringify({ type: 'hash', createdAt: Date.now() - 8000, updatedAt: Date.now() - 3000 }),
			};
			mockClient.hGetAll.mockResolvedValueOnce(indexData);

			// Mock TTL checks
			mockClient.ttl
				.mockResolvedValueOnce(3600) // key1 has TTL
				.mockResolvedValueOnce(-1);  // key2 no TTL

			// Mock retrieve operations for size calculation
			const key1Value = { data: 'simple value', type: 'simple', createdAt: Date.now() - 10000, updatedAt: Date.now() - 5000 };
			const key2Value = { name: 'John', age: 30 };

			mockClient.get
				.mockResolvedValueOnce(JSON.stringify(key1Value)) // For key1 stats
				.mockResolvedValueOnce(JSON.stringify(key1Value)) // For key1 retrieve
				.mockResolvedValueOnce(null); // For key2 stats

			// Mock key2 retrieval (hash)
			mockClient.exists
				.mockResolvedValueOnce(0) // simple doesn't exist
				.mockResolvedValueOnce(1); // hash exists
			mockClient.hGetAll.mockResolvedValueOnce({
				name: 'John',
				age: '30',
				_storage_meta: JSON.stringify({ type: 'hash', createdAt: Date.now() - 8000, updatedAt: Date.now() - 3000 }),
			});

			const stats = await userStorage.getStats(userId);

			expect(stats).toMatchObject({
				totalKeys: 2,
				totalSize: expect.any(Number),
				typeDistribution: {
					simple: 1,
					hash: 0,
					list: 0,
					set: 0,
					sorted_set: 0,
				},
				expiringKeys: 1,
				oldestKey: expect.any(Number),
				newestKey: expect.any(Number),
			});
		});

		it('should handle empty user storage', async () => {
			mockClient.hGetAll.mockResolvedValueOnce({});

			const stats = await userStorage.getStats(userId);

			expect(stats).toMatchObject({
				totalKeys: 0,
				totalSize: 0,
				expiringKeys: 0,
				oldestKey: expect.any(Number),
				newestKey: 0,
			});
		});
	});

	describe('User Data Management', () => {
		const userId = 'user-123';

		it('should clear all user data', async () => {
			// Mock list keys
			mockClient.hGetAll.mockResolvedValueOnce({
				'key1': JSON.stringify({ type: 'simple' }),
				'key2': JSON.stringify({ type: 'hash' }),
			});

			// Mock delete operations
			const mockPipeline = {
				del: jest.fn().mockReturnThis(),
				hDel: jest.fn().mockReturnThis(),
				exec: jest.fn().mockResolvedValue([
					{ reply: 1 }, // key1 deleted
					{ reply: 0 },
					{ reply: 0 },
					{ reply: 0 },
					{ reply: 0 },
					{ reply: 1 }, // index updated
				]),
			};
			mockClient.multi.mockReturnValue(mockPipeline);

			const result = await userStorage.clearUser(userId);

			expect(result).toBe(2); // 2 keys cleared
			expect(mockClient.del).toHaveBeenCalledWith('test_storage:index:user-123');
		});
	});

	describe('Type Detection', () => {
		it('should detect simple types', () => {
			const testCases = [
				{ value: 'string', expected: 'simple' },
				{ value: 123, expected: 'simple' },
				{ value: true, expected: 'simple' },
				{ value: null, expected: 'simple' },
				{ value: undefined, expected: 'simple' },
			];

			testCases.forEach(({ value, expected }) => {
				const result = (userStorage as any).detectType(value);
				expect(result).toBe(expected);
			});
		});

		it('should detect array as list', () => {
			const result = (userStorage as any).detectType(['a', 'b', 'c']);
			expect(result).toBe('list');
		});

		it('should detect Set', () => {
			const result = (userStorage as any).detectType(new Set(['a', 'b']));
			expect(result).toBe('set');
		});

		it('should detect sorted set format', () => {
			const value = [
				{ value: 'item1', score: 1.0 },
				{ value: 'item2', score: 2.0 },
			];
			const result = (userStorage as any).detectType(value);
			expect(result).toBe('sorted_set');
		});

		it('should detect object as hash', () => {
			const result = (userStorage as any).detectType({ name: 'John', age: 30 });
			expect(result).toBe('hash');
		});
	});

	describe('Configuration Management', () => {
		it('should get current configuration', () => {
			const currentConfig = userStorage.getConfig();

			expect(currentConfig).toEqual(expect.objectContaining({
				defaultTtl: 86400,
				enableTypeDetection: true,
				enableCompression: false,
				maxValueSize: 1024 * 1024,
			}));
		});

		it('should update configuration', () => {
			const newConfig = {
				defaultTtl: 172800,
				enableCompression: true,
				maxValueSize: 2048 * 1024,
			};

			userStorage.updateConfig(newConfig);

			const updatedConfig = userStorage.getConfig();
			expect(updatedConfig.defaultTtl).toBe(172800);
			expect(updatedConfig.enableCompression).toBe(true);
			expect(updatedConfig.maxValueSize).toBe(2048 * 1024);
		});
	});

	describe('Error Handling', () => {
		const userId = 'user-123';
		const key = 'test-key';

		it('should handle Redis operation failures', async () => {
			(mockRedisManager.executeOperation as jest.Mock).mockRejectedValueOnce(
				new Error('Redis connection failed')
			);

			await expect(userStorage.store(userId, key, 'test')).rejects.toThrow();
		});

		it('should handle corrupted index data gracefully', async () => {
			const indexData = {
				'valid-key': JSON.stringify({ type: 'simple', createdAt: Date.now() }),
				'invalid-key': 'invalid-json-data',
			};

			mockClient.hGetAll.mockResolvedValueOnce(indexData);

			const result = await userStorage.listKeys(userId, { type: 'simple' });

			// Should only return valid keys
			expect(result).toEqual(['valid-key']);
		});

		it('should handle statistics calculation errors gracefully', async () => {
			mockClient.hGetAll.mockResolvedValueOnce({
				'problematic-key': JSON.stringify({ type: 'simple', createdAt: Date.now() }),
			});

			mockClient.ttl.mockResolvedValueOnce(3600);
			
			// Mock retrieve failure for problematic key
			(mockRedisManager.executeOperation as jest.Mock)
				.mockImplementationOnce(async (operation) => operation(mockClient))
				.mockRejectedValueOnce(new Error('Retrieve failed'));

			const stats = await userStorage.getStats(userId);

			// Should still return stats, skipping problematic keys
			expect(stats.totalKeys).toBe(1);
		});

		it('should handle JSON parsing failures in retrieval', async () => {
			// Test with corrupted list data
			mockClient.get.mockResolvedValueOnce(null);
			mockClient.exists
				.mockResolvedValueOnce(0) // simple
				.mockResolvedValueOnce(0) // hash
				.mockResolvedValueOnce(1); // list exists
			mockClient.lRange.mockResolvedValueOnce(['valid-json', 'invalid-json{']);

			const result = await userStorage.retrieve(userId, key);

			// Should handle both valid and invalid JSON gracefully
			expect(result).toEqual(['valid-json', 'invalid-json{']);
		});
	});

	describe('Performance Considerations', () => {
		it('should handle large datasets efficiently', async () => {
			const userId = 'user-123';
			
			// Mock a large number of keys
			const largeIndexData: Record<string, string> = {};
			for (let i = 0; i < 1000; i++) {
				largeIndexData[`key-${i}`] = JSON.stringify({
					type: 'simple',
					createdAt: Date.now() - i * 1000,
				});
			}

			mockClient.hGetAll.mockResolvedValueOnce(largeIndexData);

			const startTime = Date.now();
			const result = await userStorage.listKeys(userId);
			const endTime = Date.now();

			expect(result).toHaveLength(1000);
			expect(endTime - startTime).toBeLessThan(1000); // Should be reasonably fast
		});

		it('should handle compression when enabled', async () => {
			config.enableCompression = true;
			userStorage = new UserStorage(mockRedisManager, config);

			const userId = 'user-123';
			const key = 'test-key';
			const value = 'test value';

			await userStorage.store(userId, key, value);

			// Should store compressed JSON (without pretty formatting)
			expect(mockClient.setEx).toHaveBeenCalledWith(
				expect.any(String),
				expect.any(Number),
				expect.not.stringMatching(/\n|\s{2,}/) // No newlines or multiple spaces
			);
		});

		it('should efficiently serialize and deserialize hash data', () => {
			const testData = {
				string: 'text',
				number: 42,
				boolean: true,
				object: { nested: 'value' },
				array: [1, 2, 3],
			};

			const serialized = (userStorage as any).serializeHashData(testData);
			expect(serialized).toEqual({
				string: 'text',
				number: '42',
				boolean: 'true',
				object: '{"nested":"value"}',
				array: '[1,2,3]',
			});

			const meta = { type: 'hash', createdAt: Date.now(), updatedAt: Date.now() };
			const deserialized = (userStorage as any).deserializeHashData(serialized, meta);
			expect(deserialized).toEqual(testData);
		});
	});
});