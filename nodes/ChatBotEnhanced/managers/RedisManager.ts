import { createClient, RedisClientType } from 'redis';
import { RedisCredential } from '../types';

export interface RedisConnectionConfig {
	connectionTimeout: number;
}

/**
 * Simplified Redis Manager following TimedBuffer pattern
 * Provides basic Redis operations with simple connection management
 */
export class RedisManager {
	private client: RedisClientType | null = null;
	private credentials: RedisCredential;

	constructor(
		credentials: RedisCredential,
		config: Partial<RedisConnectionConfig> = {}
	) {
		this.credentials = credentials;
		// Config kept for compatibility but simplified
	}

	/**
	 * Create and configure Redis client using simple credentials
	 */
	private setupRedisClient(): RedisClientType {
		const config: any = {
			database: this.credentials.database,
			username: this.credentials.user || undefined,
			password: this.credentials.password || undefined,
		};

		if (this.credentials.ssl) {
			config.socket = {
				host: this.credentials.host,
				port: this.credentials.port,
				tls: true,
			};
		} else {
			config.socket = {
				host: this.credentials.host,
				port: this.credentials.port,
			};
		}

		return createClient(config);
	}

	/**
	 * Get Redis client, creating if needed
	 */
	getClient(): RedisClientType {
		if (!this.client) {
			this.client = this.setupRedisClient();
		}
		return this.client;
	}

	/**
	 * Check if Redis connection is available
	 */
	isAvailable(): boolean {
		return this.client !== null && this.client.isReady;
	}

	/**
	 * Execute a Redis operation with connection management
	 */
	async executeOperation<T>(operation: (client: RedisClientType) => Promise<T>): Promise<T> {
		const client = this.getClient();
		
		try {
			// Connect if not already connected
			if (!client.isOpen) {
				await client.connect();
			}

			// Execute the operation
			const result = await operation(client);
			return result;

		} catch (error: any) {
			throw new Error(`Redis operation failed: ${error.message}`);
		}
	}

	/**
	 * Read value from Redis
	 */
	async read(key: string): Promise<string | null> {
		return this.executeOperation(async (client) => {
			return await client.get(key);
		});
	}

	/**
	 * Write value to Redis
	 */
	async write(key: string, value: string, ttlSeconds?: number): Promise<void> {
		return this.executeOperation(async (client) => {
			if (ttlSeconds) {
				await client.set(key, value, { EX: ttlSeconds });
			} else {
				await client.set(key, value);
			}
		});
	}

	/**
	 * Delete key from Redis
	 */
	async delete(key: string): Promise<boolean> {
		return this.executeOperation(async (client) => {
			const result = await client.del(key);
			return result > 0;
		});
	}

	/**
	 * Check if key exists in Redis
	 */
	async exists(key: string): Promise<boolean> {
		return this.executeOperation(async (client) => {
			const result = await client.exists(key);
			return result > 0;
		});
	}

	/**
	 * Get multiple values from Redis
	 */
	async mget(keys: string[]): Promise<(string | null)[]> {
		return this.executeOperation(async (client) => {
			return await client.mGet(keys);
		});
	}

	/**
	 * Set multiple values in Redis
	 */
	async mset(keyValues: Record<string, string>): Promise<void> {
		return this.executeOperation(async (client) => {
			await client.mSet(keyValues);
		});
	}

	/**
	 * Increment a value in Redis
	 */
	async increment(key: string, increment: number = 1): Promise<number> {
		return this.executeOperation(async (client) => {
			return await client.incrBy(key, increment);
		});
	}

	/**
	 * Set expiration on a key
	 */
	async expire(key: string, seconds: number): Promise<boolean> {
		return this.executeOperation(async (client) => {
			const result = await client.expire(key, seconds);
			return result === 1;
		});
	}

	/**
	 * Get keys matching a pattern
	 */
	async keys(pattern: string): Promise<string[]> {
		return this.executeOperation(async (client) => {
			return await client.keys(pattern);
		});
	}

	/**
	 * List operations
	 */
	async lRange(key: string, start: number, stop: number): Promise<string[]> {
		return this.executeOperation(async (client) => {
			return await client.lRange(key, start, stop);
		});
	}

	async lPush(key: string, ...values: string[]): Promise<number> {
		return this.executeOperation(async (client) => {
			return await client.lPush(key, values);
		});
	}

	async lTrim(key: string, start: number, stop: number): Promise<void> {
		return this.executeOperation(async (client) => {
			await client.lTrim(key, start, stop);
		});
	}

	/**
	 * Sorted set operations
	 */
	async zAdd(key: string, member: { score: number; value: string }): Promise<number> {
		return this.executeOperation(async (client) => {
			return await client.zAdd(key, member);
		});
	}

	async zRemRangeByScore(key: string, min: number, max: number): Promise<number> {
		return this.executeOperation(async (client) => {
			return await client.zRemRangeByScore(key, min, max);
		});
	}

	async zCard(key: string): Promise<number> {
		return this.executeOperation(async (client) => {
			return await client.zCard(key);
		});
	}

	/**
	 * Clean up Redis connection
	 */
	async cleanup(): Promise<void> {
		if (this.client) {
			try {
				if (this.client.isOpen) {
					await this.client.quit();
				}
			} catch (error: any) {
				console.warn('Error during Redis cleanup:', error.message);
				try {
					await this.client.disconnect();
				} catch (disconnectError: any) {
					console.warn('Error forcing Redis disconnect:', disconnectError.message);
				}
			} finally {
				this.client = null;
			}
		}
	}
}