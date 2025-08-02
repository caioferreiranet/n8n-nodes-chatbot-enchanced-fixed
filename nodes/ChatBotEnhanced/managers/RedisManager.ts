import { createClient, RedisClientType } from 'redis';
import { NodeOperationError } from 'n8n-workflow';
import { RedisCredential } from '../types';

export interface RedisConnectionConfig {
	maxRetries: number;
	retryDelay: number;
	connectionTimeout: number;
	healthCheckInterval: number;
	gracefulShutdownTimeout: number;
}

export interface RedisHealthStatus {
	isConnected: boolean;
	isReady: boolean;
	latency: number;
	lastHealthCheck: number;
	connectionUptime: number;
	errorCount: number;
	lastError?: string;
}

export class RedisManager {
	private client: RedisClientType | null = null;
	private credentials: RedisCredential;
	private config: RedisConnectionConfig;
	private isConnecting: boolean = false;
	private connectionAttempts: number = 0;
	private lastConnectionTime: number = 0;
	private healthStatus: RedisHealthStatus;
	private healthCheckInterval: NodeJS.Timeout | null = null;
	private reconnectTimer: NodeJS.Timeout | null = null;
	private gracefulShutdown: boolean = false;

	constructor(
		credentials: RedisCredential,
		config: Partial<RedisConnectionConfig> = {}
	) {
		this.credentials = credentials;
		this.config = {
			maxRetries: config.maxRetries || 3,
			retryDelay: config.retryDelay || 1000,
			connectionTimeout: config.connectionTimeout || 5000,
			healthCheckInterval: config.healthCheckInterval || 30000,
			gracefulShutdownTimeout: config.gracefulShutdownTimeout || 5000,
			...config,
		};

		this.healthStatus = {
			isConnected: false,
			isReady: false,
			latency: 0,
			lastHealthCheck: 0,
			connectionUptime: 0,
			errorCount: 0,
		};
	}

	/**
	 * Establish connection to Redis/Valkey with retry logic and health monitoring
	 */
	async connect(): Promise<void> {
		if (this.client && this.healthStatus.isConnected) {
			return;
		}

		if (this.isConnecting) {
			// Wait for ongoing connection attempt
			return this.waitForConnection();
		}

		this.isConnecting = true;

		try {
			await this.establishConnection();
			await this.startHealthChecks();
			this.connectionAttempts = 0;
		} catch (error) {
			this.isConnecting = false;
			this.handleConnectionError(error);
			throw error;
		}
	}

	/**
	 * Establish the actual Redis connection
	 */
	private async establishConnection(): Promise<void> {
		// Support both Redis and Valkey
		const clientConfig: any = {
			socket: {
				host: this.credentials.host,
				port: this.credentials.port,
				tls: this.credentials.ssl === true,
				connectTimeout: this.config.connectionTimeout,
				reconnectStrategy: (retries: number) => {
					if (retries >= this.config.maxRetries || this.gracefulShutdown) {
						return false; // Stop reconnecting
					}
					return Math.min(retries * this.config.retryDelay, 5000);
				},
			},
			database: this.credentials.database || 0,
		};

		// Add authentication if provided
		if (this.credentials.username) {
			clientConfig.username = this.credentials.username;
		}
		if (this.credentials.password) {
			clientConfig.password = this.credentials.password;
		}

		this.client = createClient(clientConfig);

		// Set up event handlers
		this.setupEventHandlers();

		// Connect with timeout
		const connectPromise = this.client.connect();
		const timeoutPromise = new Promise((_, reject) => {
			setTimeout(() => reject(new Error('Connection timeout')), this.config.connectionTimeout);
		});

		await Promise.race([connectPromise, timeoutPromise]);

		this.lastConnectionTime = Date.now();
		this.healthStatus.isConnected = true;
		this.healthStatus.isReady = true;
		this.healthStatus.connectionUptime = Date.now();
		this.isConnecting = false;
	}

	/**
	 * Set up Redis client event handlers
	 */
	private setupEventHandlers(): void {
		if (!this.client) return;

		this.client.on('connect', () => {
			this.healthStatus.isConnected = true;
			this.connectionAttempts = 0;
		});

		this.client.on('ready', () => {
			this.healthStatus.isReady = true;
		});

		this.client.on('error', (error) => {
			this.healthStatus.errorCount++;
			this.healthStatus.lastError = error.message;
			this.handleConnectionError(error);
		});

		this.client.on('end', () => {
			this.healthStatus.isConnected = false;
			this.healthStatus.isReady = false;
			if (!this.gracefulShutdown) {
				this.scheduleReconnect();
			}
		});

		this.client.on('reconnecting', () => {
			this.connectionAttempts++;
		});
	}

	/**
	 * Wait for ongoing connection attempt to complete
	 */
	private async waitForConnection(): Promise<void> {
		const maxWait = this.config.connectionTimeout;
		const startTime = Date.now();

		while (this.isConnecting && (Date.now() - startTime) < maxWait) {
			await new Promise(resolve => setTimeout(resolve, 100));
		}

		if (this.isConnecting) {
			throw new Error('Connection attempt timed out');
		}

		if (!this.healthStatus.isConnected) {
			throw new Error('Failed to establish connection');
		}
	}

	/**
	 * Handle connection errors with appropriate logging and recovery
	 */
	private handleConnectionError(error: any): void {
		console.error('Redis connection error:', error.message);
		
		if (this.shouldRetry()) {
			this.scheduleReconnect();
		}
	}

	/**
	 * Determine if reconnection should be attempted
	 */
	private shouldRetry(): boolean {
		return (
			!this.gracefulShutdown &&
			this.connectionAttempts < this.config.maxRetries &&
			!this.reconnectTimer
		);
	}

	/**
	 * Schedule automatic reconnection
	 */
	private scheduleReconnect(): void {
		if (this.reconnectTimer || this.gracefulShutdown) return;

		const delay = Math.min(
			this.connectionAttempts * this.config.retryDelay,
			5000
		);

		this.reconnectTimer = setTimeout(async () => {
			this.reconnectTimer = null;
			try {
				await this.connect();
			} catch (error) {
				console.error('Reconnection failed:', error.message);
			}
		}, delay);
	}

	/**
	 * Start periodic health checks
	 */
	private async startHealthChecks(): Promise<void> {
		if (this.healthCheckInterval) {
			clearInterval(this.healthCheckInterval);
		}

		this.healthCheckInterval = setInterval(async () => {
			await this.performHealthCheck();
		}, this.config.healthCheckInterval);

		// Perform initial health check
		await this.performHealthCheck();
	}

	/**
	 * Perform health check with latency measurement
	 */
	private async performHealthCheck(): Promise<void> {
		if (!this.client || !this.healthStatus.isConnected) {
			return;
		}

		try {
			const startTime = Date.now();
			await this.client.ping();
			const endTime = Date.now();

			this.healthStatus.latency = endTime - startTime;
			this.healthStatus.lastHealthCheck = endTime;
			this.healthStatus.isReady = true;
		} catch (error) {
			this.healthStatus.isReady = false;
			this.healthStatus.errorCount++;
			this.healthStatus.lastError = error.message;
		}
	}

	/**
	 * Get current health status
	 */
	getHealthStatus(): RedisHealthStatus {
		return {
			...this.healthStatus,
			connectionUptime: this.healthStatus.connectionUptime 
				? Date.now() - this.healthStatus.connectionUptime 
				: 0,
		};
	}

	/**
	 * Check if Redis is available for operations
	 */
	isAvailable(): boolean {
		return (
			this.client !== null &&
			this.healthStatus.isConnected &&
			this.healthStatus.isReady &&
			!this.gracefulShutdown
		);
	}

	/**
	 * Get Redis client with availability check
	 */
	getClient(): RedisClientType {
		if (!this.isAvailable()) {
			throw new NodeOperationError(
				null as any,
				'Redis connection is not available',
				{ description: 'Redis client is not connected or ready for operations' }
			);
		}
		return this.client!;
	}

	/**
	 * Execute Redis operation with error handling and retries
	 */
	async executeOperation<T>(
		operation: (client: RedisClientType) => Promise<T>,
		options: { retries?: number; timeout?: number } = {}
	): Promise<T> {
		const { retries = 1, timeout = 5000 } = options;
		let lastError: Error;

		for (let attempt = 0; attempt <= retries; attempt++) {
			try {
				if (!this.isAvailable()) {
					await this.connect();
				}

				const client = this.getClient();
				
				// Execute with timeout
				const operationPromise = operation(client);
				const timeoutPromise = new Promise<never>((_, reject) => {
					setTimeout(() => reject(new Error('Operation timeout')), timeout);
				});

				return await Promise.race([operationPromise, timeoutPromise]);

			} catch (error) {
				lastError = error;
				
				if (attempt < retries) {
					// Wait before retry
					await new Promise(resolve => 
						setTimeout(resolve, Math.min(attempt * 1000, 3000))
					);
					
					// Try to reconnect if connection was lost
					if (!this.isAvailable()) {
						try {
							await this.connect();
						} catch (connectError) {
							// Continue to next retry
						}
					}
				}
			}
		}

		throw new NodeOperationError(
			null as any,
			`Redis operation failed after ${retries + 1} attempts: ${lastError!.message}`
		);
	}

	/**
	 * Graceful shutdown with connection cleanup
	 */
	async cleanup(): Promise<void> {
		this.gracefulShutdown = true;

		// Clear timers
		if (this.healthCheckInterval) {
			clearInterval(this.healthCheckInterval);
			this.healthCheckInterval = null;
		}

		if (this.reconnectTimer) {
			clearTimeout(this.reconnectTimer);
			this.reconnectTimer = null;
		}

		// Close Redis connection
		if (this.client && this.healthStatus.isConnected) {
			try {
				await Promise.race([
					this.client.quit(),
					new Promise(resolve => 
						setTimeout(resolve, this.config.gracefulShutdownTimeout)
					),
				]);
			} catch (error) {
				console.warn('Error during Redis cleanup:', error.message);
				// Force disconnect if graceful shutdown fails
				try {
					await this.client.disconnect();
				} catch (disconnectError) {
					console.warn('Error forcing Redis disconnect:', disconnectError.message);
				}
			}
		}

		// Reset state
		this.client = null;
		this.healthStatus.isConnected = false;
		this.healthStatus.isReady = false;
		this.isConnecting = false;
	}

	/**
	 * Force reconnection (useful for testing or manual recovery)
	 */
	async forceReconnect(): Promise<void> {
		await this.cleanup();
		this.gracefulShutdown = false;
		this.connectionAttempts = 0;
		await this.connect();
	}

	/**
	 * Get connection statistics
	 */
	getConnectionStats(): {
		connectionAttempts: number;
		lastConnectionTime: number;
		healthStatus: RedisHealthStatus;
	} {
		return {
			connectionAttempts: this.connectionAttempts,
			lastConnectionTime: this.lastConnectionTime,
			healthStatus: this.getHealthStatus(),
		};
	}
}