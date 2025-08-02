import { RedisClientType } from 'redis';
import { NodeOperationError } from 'n8n-workflow';
import { RedisManager } from './RedisManager';

export type StorageType = 'simple' | 'hash' | 'list' | 'set' | 'sorted_set';

export interface StorageConfig {
	defaultTtl?: number; // in seconds
	enableTypeDetection: boolean;
	enableCompression: boolean;
	keyPrefix?: string;
	maxValueSize?: number; // in bytes
	enableIndexing?: boolean;
}

export interface StorageValue {
	data: any;
	type: StorageType;
	createdAt: number;
	updatedAt: number;
	ttl?: number;
	metadata?: Record<string, any>;
}

export interface StorageQuery {
	pattern?: string;
	type?: StorageType;
	minAge?: number;
	maxAge?: number;
	limit?: number;
	offset?: number;
}

export interface StorageStats {
	totalKeys: number;
	totalSize: number; // approximate size in bytes
	typeDistribution: Record<StorageType, number>;
	expiringKeys: number;
	oldestKey: number;
	newestKey: number;
}

export class UserStorage {
	private redisManager: RedisManager;
	private config: StorageConfig;
	private keyPrefix: string;

	constructor(redisManager: RedisManager, config: Partial<StorageConfig> = {}) {
		this.redisManager = redisManager;
		this.config = {
			defaultTtl: 86400, // 24 hours
			enableTypeDetection: true,
			enableCompression: false,
			keyPrefix: 'storage',
			maxValueSize: 1024 * 1024, // 1MB
			enableIndexing: true,
			...config,
		};
		this.keyPrefix = this.config.keyPrefix || 'storage';
	}

	/**
	 * Store a value with automatic type detection
	 */
	async store(
		userId: string,
		key: string,
		value: any,
		options: {
			ttl?: number;
			type?: StorageType;
			metadata?: Record<string, any>;
		} = {}
	): Promise<void> {
		const storageKey = this.generateStorageKey(userId, key);
		const now = Date.now();

		// Detect storage type if not specified
		const storageType = options.type || (this.config.enableTypeDetection ? this.detectType(value) : 'simple');
		
		// Validate value size
		const serializedSize = JSON.stringify(value).length;
		if (this.config.maxValueSize && serializedSize > this.config.maxValueSize) {
			throw new NodeOperationError(
				null as any,
				`Value size (${serializedSize} bytes) exceeds maximum allowed size (${this.config.maxValueSize} bytes)`
			);
		}

		const storageValue: StorageValue = {
			data: value,
			type: storageType,
			createdAt: now,
			updatedAt: now,
			ttl: options.ttl || this.config.defaultTtl,
			metadata: options.metadata,
		};

		await this.redisManager.executeOperation(async (client) => {
			await this.storeByType(client, storageKey, storageValue, storageType);
			
			// Update index if enabled
			if (this.config.enableIndexing) {
				await this.updateIndex(client, userId, key, storageValue);
			}
		});
	}

	/**
	 * Retrieve a value by key
	 */
	async retrieve(userId: string, key: string): Promise<any> {
		const storageKey = this.generateStorageKey(userId, key);

		return this.redisManager.executeOperation(async (client) => {
			// First try to get as simple value
			const simpleValue = await client.get(storageKey);
			if (simpleValue) {
				try {
					const parsed: StorageValue = JSON.parse(simpleValue);
					return parsed.data;
				} catch (error) {
					// Fallback to raw value
					return simpleValue;
				}
			}

			// Try other data types
			const hashExists = await client.exists(`${storageKey}:hash`);
			if (hashExists) {
				const hashData = await client.hGetAll(`${storageKey}:hash`);
				if (hashData._storage_meta) {
					const meta: StorageValue = JSON.parse(hashData._storage_meta);
					delete hashData._storage_meta;
					return this.deserializeHashData(hashData, meta);
				}
				return hashData;
			}

			// Try list
			const listExists = await client.exists(`${storageKey}:list`);
			if (listExists) {
				const listData = await client.lRange(`${storageKey}:list`, 0, -1);
				return listData.map(item => {
					try {
						return JSON.parse(item);
					} catch (error) {
						return item;
					}
				});
			}

			// Try set
			const setExists = await client.exists(`${storageKey}:set`);
			if (setExists) {
				const setData = await client.sMembers(`${storageKey}:set`);
				return setData.map(item => {
					try {
						return JSON.parse(item);
					} catch (error) {
						return item;
					}
				});
			}

			// Try sorted set
			const zsetExists = await client.exists(`${storageKey}:zset`);
			if (zsetExists) {
				const zsetData = await client.zRangeWithScores(`${storageKey}:zset`, 0, -1);
				return zsetData.map(item => ({
					value: this.tryParseJson(item.value),
					score: item.score,
				}));
			}

			return null;
		});
	}

	/**
	 * Delete a value
	 */
	async delete(userId: string, key: string): Promise<boolean> {
		const storageKey = this.generateStorageKey(userId, key);

		return this.redisManager.executeOperation(async (client) => {
			const pipeline = client.multi();
			
			// Delete all possible key variations
			pipeline.del(storageKey);
			pipeline.del(`${storageKey}:hash`);
			pipeline.del(`${storageKey}:list`);
			pipeline.del(`${storageKey}:set`);
			pipeline.del(`${storageKey}:zset`);

			// Remove from index
			if (this.config.enableIndexing) {
				const indexKey = this.generateIndexKey(userId);
				pipeline.hDel(indexKey, key);
			}

			const results = await pipeline.exec();
			return results && results.some(result => result && (result as any).reply > 0);
		});
	}

	/**
	 * Check if a key exists
	 */
	async exists(userId: string, key: string): Promise<boolean> {
		const storageKey = this.generateStorageKey(userId, key);

		return this.redisManager.executeOperation(async (client) => {
			const exists = await Promise.all([
				client.exists(storageKey),
				client.exists(`${storageKey}:hash`),
				client.exists(`${storageKey}:list`),
				client.exists(`${storageKey}:set`),
				client.exists(`${storageKey}:zset`),
			]);

			return exists.some(e => e > 0);
		});
	}

	/**
	 * Get TTL for a key
	 */
	async getTTL(userId: string, key: string): Promise<number> {
		const storageKey = this.generateStorageKey(userId, key);

		return this.redisManager.executeOperation(async (client) => {
			// Check TTL for different key types
			const ttls = await Promise.all([
				client.ttl(storageKey),
				client.ttl(`${storageKey}:hash`),
				client.ttl(`${storageKey}:list`),
				client.ttl(`${storageKey}:set`),
				client.ttl(`${storageKey}:zset`),
			]);

			// Return the first valid TTL found
			for (const ttl of ttls) {
				if (ttl > 0) return ttl;
				if (ttl === -1) return -1; // Key exists but has no TTL
			}

			return -2; // Key doesn't exist
		});
	}

	/**
	 * Set TTL for a key
	 */
	async setTTL(userId: string, key: string, ttl: number): Promise<boolean> {
		const storageKey = this.generateStorageKey(userId, key);

		return this.redisManager.executeOperation(async (client) => {
			const pipeline = client.multi();
			
			// Set TTL for all possible key variations
			pipeline.expire(storageKey, ttl);
			pipeline.expire(`${storageKey}:hash`, ttl);
			pipeline.expire(`${storageKey}:list`, ttl);
			pipeline.expire(`${storageKey}:set`, ttl);
			pipeline.expire(`${storageKey}:zset`, ttl);

			const results = await pipeline.exec();
			return results && results.some(result => result && (result as any).reply === 1);
		});
	}

	/**
	 * List all keys for a user
	 */
	async listKeys(userId: string, query: StorageQuery = {}): Promise<string[]> {
		return this.redisManager.executeOperation(async (client) => {
			if (this.config.enableIndexing) {
				return this.listKeysFromIndex(client, userId, query);
			} else {
				return this.listKeysFromPattern(client, userId, query);
			}
		});
	}

	/**
	 * Get storage statistics for a user
	 */
	async getStats(userId: string): Promise<StorageStats> {
		return this.redisManager.executeOperation(async (client) => {
			const keys = await this.listKeys(userId);
			const stats: StorageStats = {
				totalKeys: keys.length,
				totalSize: 0,
				typeDistribution: {
					simple: 0,
					hash: 0,
					list: 0,
					set: 0,
					sorted_set: 0,
				},
				expiringKeys: 0,
				oldestKey: Date.now(),
				newestKey: 0,
			};

			for (const key of keys) {
				const storageKey = this.generateStorageKey(userId, key);
				
				// Check TTL
				const ttl = await client.ttl(storageKey);
				if (ttl > 0) {
					stats.expiringKeys++;
				}

				// Estimate size and get metadata
				try {
					const value = await this.retrieve(userId, key);
					if (value) {
						const size = JSON.stringify(value).length;
						stats.totalSize += size;

						// Try to get type information
						const simpleValue = await client.get(storageKey);
						if (simpleValue) {
							try {
								const parsed: StorageValue = JSON.parse(simpleValue);
								stats.typeDistribution[parsed.type]++;
								stats.oldestKey = Math.min(stats.oldestKey, parsed.createdAt);
								stats.newestKey = Math.max(stats.newestKey, parsed.updatedAt);
							} catch (error) {
								stats.typeDistribution.simple++;
							}
						}
					}
				} catch (error) {
					// Skip problematic keys
				}
			}

			return stats;
		});
	}

	/**
	 * Clear all data for a user
	 */
	async clearUser(userId: string): Promise<number> {
		return this.redisManager.executeOperation(async (client) => {
			const keys = await this.listKeys(userId);
			let deletedCount = 0;

			for (const key of keys) {
				const deleted = await this.delete(userId, key);
				if (deleted) deletedCount++;
			}

			// Clear index
			if (this.config.enableIndexing) {
				const indexKey = this.generateIndexKey(userId);
				await client.del(indexKey);
			}

			return deletedCount;
		});
	}

	/**
	 * Detect storage type based on value
	 */
	private detectType(value: any): StorageType {
		if (value === null || value === undefined) {
			return 'simple';
		}

		if (Array.isArray(value)) {
			return 'list';
		}

		if (typeof value === 'object') {
			// Check if it looks like a sorted set (array of {value, score} objects)
			if (Array.isArray(value) && value.length > 0 && 
				typeof value[0] === 'object' && 
				'value' in value[0] && 'score' in value[0]) {
				return 'sorted_set';
			}

			// Check if it's a Set
			if (value instanceof Set) {
				return 'set';
			}

			// Default to hash for objects
			return 'hash';
		}

		return 'simple';
	}

	/**
	 * Store value based on detected type
	 */
	private async storeByType(
		client: RedisClientType,
		storageKey: string,
		storageValue: StorageValue,
		type: StorageType
	): Promise<void> {
		const ttl = storageValue.ttl || this.config.defaultTtl;

		switch (type) {
			case 'simple':
				const serialized = this.config.enableCompression 
					? JSON.stringify(storageValue, null, 0)
					: JSON.stringify(storageValue, null, 2);
				
				if (ttl) {
					await client.setEx(storageKey, ttl, serialized);
				} else {
					await client.set(storageKey, serialized);
				}
				break;

			case 'hash':
				const hashKey = `${storageKey}:hash`;
				const hashData = this.serializeHashData(storageValue.data);
				
				// Store data
				await client.hSet(hashKey, hashData);
				
				// Store metadata
				await client.hSet(hashKey, '_storage_meta', JSON.stringify(storageValue));
				
				if (ttl) {
					await client.expire(hashKey, ttl);
				}
				break;

			case 'list':
				const listKey = `${storageKey}:list`;
				const listData = Array.isArray(storageValue.data) ? storageValue.data : [storageValue.data];
				
				// Clear existing list and add new items
				await client.del(listKey);
				if (listData.length > 0) {
					await client.lPush(listKey, ...listData.map(item => JSON.stringify(item)));
				}
				
				if (ttl) {
					await client.expire(listKey, ttl);
				}
				break;

			case 'set':
				const setKey = `${storageKey}:set`;
				const setData = storageValue.data instanceof Set 
					? Array.from(storageValue.data) 
					: Array.isArray(storageValue.data) ? storageValue.data : [storageValue.data];
				
				// Clear existing set and add new items
				await client.del(setKey);
				if (setData.length > 0) {
					await client.sAdd(setKey, ...setData.map(item => JSON.stringify(item)));
				}
				
				if (ttl) {
					await client.expire(setKey, ttl);
				}
				break;

			case 'sorted_set':
				const zsetKey = `${storageKey}:zset`;
				const zsetData = Array.isArray(storageValue.data) ? storageValue.data : [];
				
				// Clear existing sorted set
				await client.del(zsetKey);
				
				// Add new items
				for (const item of zsetData) {
					if (typeof item === 'object' && 'value' in item && 'score' in item) {
						await client.zAdd(zsetKey, {
							score: item.score,
							value: JSON.stringify(item.value),
						});
					}
				}
				
				if (ttl) {
					await client.expire(zsetKey, ttl);
				}
				break;
		}
	}

	/**
	 * Serialize hash data for storage
	 */
	private serializeHashData(data: any): Record<string, string> {
		const result: Record<string, string> = {};
		
		for (const [key, value] of Object.entries(data)) {
			result[key] = typeof value === 'string' ? value : JSON.stringify(value);
		}
		
		return result;
	}

	/**
	 * Deserialize hash data from storage
	 */
	private deserializeHashData(data: Record<string, string>, meta: StorageValue): any {
		const result: any = {};
		
		for (const [key, value] of Object.entries(data)) {
			result[key] = this.tryParseJson(value);
		}
		
		return result;
	}

	/**
	 * Try to parse JSON, return original value if parsing fails
	 */
	private tryParseJson(value: string): any {
		try {
			return JSON.parse(value);
		} catch (error) {
			return value;
		}
	}

	/**
	 * Update storage index
	 */
	private async updateIndex(
		client: RedisClientType,
		userId: string,
		key: string,
		storageValue: StorageValue
	): Promise<void> {
		const indexKey = this.generateIndexKey(userId);
		const indexEntry = {
			type: storageValue.type,
			createdAt: storageValue.createdAt,
			updatedAt: storageValue.updatedAt,
			ttl: storageValue.ttl,
		};
		
		await client.hSet(indexKey, key, JSON.stringify(indexEntry));
		
		// Set TTL for index key itself
		const indexTtl = (storageValue.ttl || this.config.defaultTtl) + 86400; // Index lives longer
		await client.expire(indexKey, indexTtl);
	}

	/**
	 * List keys from index (faster)
	 */
	private async listKeysFromIndex(
		client: RedisClientType,
		userId: string,
		query: StorageQuery
	): Promise<string[]> {
		const indexKey = this.generateIndexKey(userId);
		const indexData = await client.hGetAll(indexKey);
		
		let keys = Object.keys(indexData);
		
		// Apply filters
		if (query.type || query.minAge || query.maxAge) {
			keys = keys.filter(key => {
				try {
					const entry = JSON.parse(indexData[key]);
					
					if (query.type && entry.type !== query.type) {
						return false;
					}
					
					if (query.minAge && (Date.now() - entry.createdAt) < query.minAge) {
						return false;
					}
					
					if (query.maxAge && (Date.now() - entry.createdAt) > query.maxAge) {
						return false;
					}
					
					return true;
				} catch (error) {
					return false;
				}
			});
		}

		// Apply pattern filter
		if (query.pattern) {
			const regex = new RegExp(query.pattern.replace(/\*/g, '.*'), 'i');
			keys = keys.filter(key => regex.test(key));
		}

		// Apply pagination
		if (query.offset || query.limit) {
			const offset = query.offset || 0;
			const limit = query.limit || keys.length;
			keys = keys.slice(offset, offset + limit);
		}

		return keys;
	}

	/**
	 * List keys from pattern matching (slower but works without index)
	 */
	private async listKeysFromPattern(
		client: RedisClientType,
		userId: string,
		query: StorageQuery
	): Promise<string[]> {
		const pattern = query.pattern || '*';
		const searchPattern = `${this.keyPrefix}:${userId}:${pattern}`;
		const keys = await client.keys(searchPattern);
		
		return keys
			.map(key => key.replace(`${this.keyPrefix}:${userId}:`, ''))
			.filter(key => !key.includes(':')) // Exclude type-specific keys
			.slice(query.offset || 0, (query.offset || 0) + (query.limit || keys.length));
	}

	/**
	 * Generate storage key
	 */
	private generateStorageKey(userId: string, key: string): string {
		return `${this.keyPrefix}:${userId}:${key}`;
	}

	/**
	 * Generate index key
	 */
	private generateIndexKey(userId: string): string {
		return `${this.keyPrefix}:index:${userId}`;
	}

	/**
	 * Get configuration
	 */
	getConfig(): StorageConfig {
		return { ...this.config };
	}

	/**
	 * Update configuration
	 */
	updateConfig(newConfig: Partial<StorageConfig>): void {
		this.config = { ...this.config, ...newConfig };
	}
}