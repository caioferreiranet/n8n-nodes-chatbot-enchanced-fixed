import { createClient } from 'redis';
import { RedisCredential } from './types';

/**
 * Setup Redis client based on credentials configuration
 */
export function setupRedisClient(credentials: RedisCredential) {
	let client;
	
	switch (credentials.connectionType) {
		case 'standard':
			client = createClient({
				socket: {
					host: credentials.host || 'localhost',
					port: credentials.port || 6379,
					tls: credentials.ssl,
					connectTimeout: credentials.connectionOptions?.connectTimeout || 10000,
					commandTimeout: credentials.connectionOptions?.commandTimeout || 5000,
					keepAlive: credentials.connectionOptions?.keepAlive !== false,
				},
				database: credentials.database || 0,
				username: credentials.authType === 'userpass' ? credentials.username : undefined,
				password: credentials.authType !== 'none' ? credentials.password : undefined,
			});
			break;
		
		case 'cluster':
			// Cluster configuration for future implementation
			const clusterHosts = credentials.clusterHosts?.split(',').map(host => {
				const [hostname, port] = host.trim().split(':');
				return { host: hostname, port: parseInt(port) || 6379 };
			}) || [];
			
			throw new Error('Cluster mode not yet implemented. Will be available in Phase 3.');
			
		case 'sentinel':
			// Sentinel configuration for future implementation
			const sentinelHosts = credentials.sentinelHosts?.split(',').map(host => {
				const [hostname, port] = host.trim().split(':');
				return { host: hostname, port: parseInt(port) || 26379 };
			}) || [];
			
			throw new Error('Sentinel mode not yet implemented. Will be available in Phase 3.');
			
		default:
			throw new Error(`Unsupported connection type: ${credentials.connectionType}`);
	}

	return client;
}

/**
 * Generate Redis keys with consistent patterns
 */
export class RedisKeyGenerator {
	constructor(private prefix: string = 'chatbot', private workflowId?: string) {}

	/**
	 * Generate rate limit key
	 */
	rateLimit(userId: string, windowStart: number): string {
		const baseKey = `${this.prefix}:ratelimit:${userId}:${windowStart}`;
		return this.workflowId ? `${this.workflowId}:${baseKey}` : baseKey;
	}

	/**
	 * Generate session key
	 */
	session(sessionId: string): string {
		const baseKey = `${this.prefix}:session:${sessionId}`;
		return this.workflowId ? `${this.workflowId}:${baseKey}` : baseKey;
	}

	/**
	 * Generate buffer key
	 */
	buffer(sessionId: string): string {
		const baseKey = `${this.prefix}:buffer:${sessionId}`;
		return this.workflowId ? `${this.workflowId}:${baseKey}` : baseKey;
	}

	/**
	 * Generate memory key
	 */
	memory(userId: string, memoryType: string): string {
		const baseKey = `${this.prefix}:memory:${memoryType}:${userId}`;
		return this.workflowId ? `${this.workflowId}:${baseKey}` : baseKey;
	}

	/**
	 * Generate routing key
	 */
	routing(channelId: string): string {
		const baseKey = `${this.prefix}:routing:${channelId}`;
		return this.workflowId ? `${this.workflowId}:${baseKey}` : baseKey;
	}

	/**
	 * Generate user storage key
	 */
	userStorage(userId: string, storageType: string): string {
		const baseKey = `${this.prefix}:storage:${storageType}:${userId}`;
		return this.workflowId ? `${this.workflowId}:${baseKey}` : baseKey;
	}

	/**
	 * Generate analytics key
	 */
	analytics(level: string, date: string): string {
		const baseKey = `${this.prefix}:analytics:${level}:${date}`;
		return this.workflowId ? `${this.workflowId}:${baseKey}` : baseKey;
	}

	/**
	 * Generate penalty key for rate limiting
	 */
	penalty(userId: string): string {
		const baseKey = `${this.prefix}:penalty:${userId}`;
		return this.workflowId ? `${this.workflowId}:${baseKey}` : baseKey;
	}
}

/**
 * Time conversion utilities
 */
export class TimeUtils {
	/**
	 * Convert time amount and unit to milliseconds
	 */
	static toMilliseconds(amount: number, unit: string): number {
		switch (unit) {
			case 'seconds':
				return amount * 1000;
			case 'minutes':
				return amount * 60 * 1000;
			case 'hours':
				return amount * 60 * 60 * 1000;
			case 'days':
				return amount * 24 * 60 * 60 * 1000;
			case 'weeks':
				return amount * 7 * 24 * 60 * 60 * 1000;
			default:
				return amount * 1000; // Default to seconds
		}
	}

	/**
	 * Convert milliseconds to seconds (for Redis TTL)
	 */
	static toSeconds(milliseconds: number): number {
		return Math.ceil(milliseconds / 1000);
	}

	/**
	 * Get current time window start for rate limiting
	 */
	static getWindowStart(windowMs: number): number {
		return Math.floor(Date.now() / windowMs) * windowMs;
	}

	/**
	 * Format date for analytics keys
	 */
	static formatDate(date: Date = new Date()): string {
		return date.toISOString().split('T')[0]; // YYYY-MM-DD
	}

	/**
	 * Format datetime for analytics keys
	 */
	static formatDateTime(date: Date = new Date()): string {
		return date.toISOString().replace(/[:.]/g, '-').slice(0, -5); // YYYY-MM-DDTHH-MM-SS
	}
}

/**
 * Data compression utilities (for memory optimization)
 */
export class CompressionUtils {
	/**
	 * Simple JSON compression by removing whitespace
	 */
	static compressJson(obj: any): string {
		return JSON.stringify(obj, null, 0);
	}

	/**
	 * Decompress JSON data
	 */
	static decompressJson(str: string): any {
		return JSON.parse(str);
	}

	/**
	 * Estimate size of JSON object in bytes
	 */
	static estimateSize(obj: any): number {
		return new Blob([JSON.stringify(obj)]).size;
	}

	/**
	 * Truncate large objects to fit within size limits
	 */
	static truncateObject(obj: any[], maxSize: number): any[] {
		if (obj.length <= maxSize) {
			return obj;
		}
		return obj.slice(-maxSize); // Keep most recent items
	}
}

/**
 * Error handling utilities
 */
export class ErrorUtils {
	/**
	 * Check if error is retryable
	 */
	static isRetryableError(error: any): boolean {
		// Network and connection errors are typically retryable
		if (error.code === 'ECONNREFUSED' || error.code === 'ETIMEDOUT') {
			return true;
		}
		if (error.code === 'ENOTFOUND' || error.code === 'EHOSTUNREACH') {
			return true;
		}
		if (error.message?.includes('timeout') || error.message?.includes('connection')) {
			return true;
		}
		// Redis specific errors
		if (error.message?.includes('READONLY') || error.message?.includes('LOADING')) {
			return true;
		}
		return false;
	}

	/**
	 * Extract error information for output
	 */
	static extractErrorInfo(error: any): {
		type: string;
		message: string;
		code?: string;
		retryable: boolean;
	} {
		return {
			type: error.constructor.name,
			message: error.message || 'Unknown error',
			code: error.code,
			retryable: this.isRetryableError(error),
		};
	}
}

/**
 * Validation utilities for configuration
 */
export class ValidationUtils {
	/**
	 * Validate rate limit configuration
	 */
	static validateRateLimit(config: any): string[] {
		const errors: string[] = [];
		
		if (!config) {
			errors.push('Rate limit configuration is required');
			return errors;
		}

		if (!config.windowSize || config.windowSize < 1) {
			errors.push('Window size must be at least 1');
		}
		if (!config.maxRequests || config.maxRequests < 1) {
			errors.push('Max requests must be at least 1');
		}
		if (config.burstLimit && config.burstLimit < config.maxRequests) {
			errors.push('Burst limit must be greater than or equal to max requests');
		}

		return errors;
	}

	/**
	 * Validate session configuration
	 */
	static validateSession(config: any): string[] {
		const errors: string[] = [];
		
		if (!config) {
			errors.push('Session configuration is required');
			return errors;
		}

		if (!config.sessionTimeout || config.sessionTimeout < 1) {
			errors.push('Session timeout must be at least 1');
		}
		if (config.maxSessions && config.maxSessions < 1) {
			errors.push('Max sessions must be at least 1');
		}

		return errors;
	}

	/**
	 * Validate buffer configuration
	 */
	static validateBuffer(config: any): string[] {
		const errors: string[] = [];
		
		if (!config) {
			errors.push('Buffer configuration is required');
			return errors;
		}

		if (!config.bufferSize || config.bufferSize < 1) {
			errors.push('Buffer size must be at least 1');
		}
		if (!config.flushInterval || config.flushInterval < 1) {
			errors.push('Flush interval must be at least 1');
		}

		return errors;
	}

	/**
	 * Validate memory configuration
	 */
	static validateMemory(config: any): string[] {
		const errors: string[] = [];
		
		if (!config) {
			errors.push('Memory configuration is required');
			return errors;
		}

		if (!config.memoryType) {
			errors.push('Memory type is required');
		}
		if (!config.maxMemorySize || config.maxMemorySize < 1) {
			errors.push('Max memory size must be at least 1');
		}
		if (!config.memoryTtl || config.memoryTtl < 1) {
			errors.push('Memory TTL must be at least 1');
		}

		return errors;
	}
}