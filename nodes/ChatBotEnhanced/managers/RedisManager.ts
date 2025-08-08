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
	protected credentials: RedisCredential;
	private connectionLost = false;
	private lastHealthCheck = 0;
	private readonly HEALTH_CHECK_INTERVAL = 5000; // 5 seconds

	constructor(
		credentials: RedisCredential,
		config: Partial<RedisConnectionConfig> = {}
	) {
		this.credentials = credentials;
		// Initialize Redis client immediately
		this.client = this.setupRedisClient();
	}

	/**
	 * Create and configure Redis client with anti-infinite-loop settings
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
				// CRITICAL: Connection timeout to prevent hanging
				connectTimeout: 2000,
				// Disable reconnection attempts to prevent infinite loops
				reconnectStrategy: false,
			};
		} else {
			config.socket = {
				host: this.credentials.host,
				port: this.credentials.port,
				// CRITICAL: Connection timeout to prevent hanging
				connectTimeout: 2000,
				// Disable reconnection attempts to prevent infinite loops
				reconnectStrategy: false,
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
	 * Check if Redis connection is available and healthy
	 */
	isAvailable(): boolean {
		// For valid credentials, we should be able to create a client
		// Don't check isReady until we actually attempt to connect
		return this.client !== null && !this.connectionLost;
	}

	/**
	 * Perform health check with Promise wrapper and timeout to prevent infinite loops
	 */
	async healthCheck(): Promise<boolean> {
		const now = Date.now();
		
		// Skip if health check was done recently
		if (now - this.lastHealthCheck < this.HEALTH_CHECK_INTERVAL && !this.connectionLost) {
			return this.isAvailable();
		}
		
		this.lastHealthCheck = now;
		
		// Use Promise wrapper pattern to prevent infinite loops
		return new Promise((resolve, reject) => {
			const client = this.getClient();
			
			if (!client) {
				this.connectionLost = true;
				resolve(false);
				return;
			}
			
			// Set timeout to prevent hanging
			const timeoutId = setTimeout(() => {
				this.connectionLost = true;
				client.removeAllListeners('connect');
				client.removeAllListeners('error');
				reject(new Error('Redis health check timeout after 2 seconds'));
			}, 2000);
			
			// Handle successful connection
			const onConnect = async () => {
				try {
					clearTimeout(timeoutId);
					client.removeAllListeners('error');
					
					// Test with ping
					await client.ping();
					this.connectionLost = false;
					resolve(true);
				} catch (pingError) {
					this.connectionLost = true;
					resolve(false);
				}
			};
			
			// Handle connection errors
			const onError = (error: Error) => {
				clearTimeout(timeoutId);
				client.removeAllListeners('connect');
				this.connectionLost = true;
				reject(new Error(`Redis connection failed: ${error.message}`));
			};
			
			// Set up event listeners
			client.once('connect', onConnect);
			client.once('error', onError);
			
			// Attempt connection if not ready
			if (!client.isReady) {
				client.connect().catch(onError);
			} else {
				// Already connected, test with ping
				onConnect();
			}
		});
	}

	/**
	 * Execute a Redis operation with Promise wrapper to prevent infinite loops
	 */
	async executeOperation<T>(operation: (client: RedisClientType) => Promise<T>): Promise<T> {
		return new Promise(async (resolve, reject) => {
			try {
				// Check health with timeout
				const healthCheckPassed = await this.healthCheck();
				
				if (!healthCheckPassed) {
					this.connectionLost = true;
					reject(new Error(`Redis connection health check failed for ${this.credentials.host}:${this.credentials.port}. Connection is not available.`));
					return;
				}
				
				const client = this.getClient();
				
				// Set operation timeout
				const timeoutId = setTimeout(() => {
					this.connectionLost = true;
					reject(new Error(`Redis operation timeout after 3 seconds for ${this.credentials.host}:${this.credentials.port}`));
				}, 3000);
				
				try {
					// Connect if not already connected
					if (!client.isOpen) {
						await client.connect();
					}

					// Execute the operation
					const result = await operation(client);
					
					// Clear timeout and reset connection lost flag
					clearTimeout(timeoutId);
					this.connectionLost = false;
					
					resolve(result);
				} catch (operationError: any) {
					clearTimeout(timeoutId);
					this.connectionLost = true;
					reject(this.classifyConnectionError(operationError));
				}
			} catch (healthError: any) {
				this.connectionLost = true;
				reject(new Error(`Redis health check failed: ${healthError.message}`));
			}
		});
	}

	/**
	 * Classify Redis connection errors for better error handling
	 */
	private classifyConnectionError(error: any): Error {
		// Provide specific error messages for common connection issues
		if (error.code === 'ECONNREFUSED') {
			return new Error(`Redis connection refused. Please verify Redis server is running at ${this.credentials.host}:${this.credentials.port}`);
		} else if (error.code === 'ENOTFOUND') {
			return new Error(`Redis host not found: ${this.credentials.host}. Please verify the hostname/IP address.`);
		} else if (error.code === 'ETIMEDOUT') {
			return new Error(`Redis connection timeout. Please check network connectivity to ${this.credentials.host}:${this.credentials.port}`);
		} else if (error.message && error.message.includes('invalid password')) {
			return new Error(`Redis authentication failed. Please verify your password credentials.`);
		} else if (error.message && error.message.includes('NOAUTH')) {
			return new Error(`Redis requires authentication but no password provided. Please set password in credentials.`);
		}
		
		return new Error(`Redis operation failed: ${error.message || 'Unknown error'}`);
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
				
				try {
					await this.client.disconnect();
				} catch (disconnectError: any) {
					
				}
			} finally {
				this.client = null;
			}
		}
	}
}