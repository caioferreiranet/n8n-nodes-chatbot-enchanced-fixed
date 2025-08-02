import { NodeOperationError } from 'n8n-workflow';

export interface UserFriendlyError {
	userMessage: string;
	technicalMessage: string;
	troubleshooting: string[];
	errorCode: string;
	category: ErrorCategory;
}

export enum ErrorCategory {
	CONNECTION = 'CONNECTION',
	CONFIGURATION = 'CONFIGURATION',
	OPERATION = 'OPERATION',
	TIMEOUT = 'TIMEOUT',
	RESOURCE_LIMIT = 'RESOURCE_LIMIT',
	VALIDATION = 'VALIDATION',
}

export class ErrorHandler {
	private static readonly ERROR_MESSAGES: Record<string, UserFriendlyError> = {
		// Redis Connection Errors
		REDIS_CONNECTION_FAILED: {
			userMessage: 'Unable to connect to Redis database. Please check your connection settings.',
			technicalMessage: 'Redis connection failed',
			troubleshooting: [
				'Verify Redis server is running and accessible',
				'Check host, port, and authentication credentials',
				'Ensure network connectivity to Redis server',
				'Check firewall settings and security groups',
			],
			errorCode: 'REDIS_001',
			category: ErrorCategory.CONNECTION,
		},

		REDIS_AUTH_FAILED: {
			userMessage: 'Redis authentication failed. Please check your username and password.',
			technicalMessage: 'Redis authentication error',
			troubleshooting: [
				'Verify the Redis password is correct',
				'Check if Redis requires authentication',
				'Ensure the user has appropriate permissions',
			],
			errorCode: 'REDIS_002',
			category: ErrorCategory.CONNECTION,
		},

		REDIS_TIMEOUT: {
			userMessage: 'Redis operation timed out. The server may be overloaded or network is slow.',
			technicalMessage: 'Redis operation timeout',
			troubleshooting: [
				'Check Redis server performance and load',
				'Verify network latency to Redis server',
				'Consider increasing timeout values',
				'Check if Redis server is experiencing high memory usage',
			],
			errorCode: 'REDIS_003',
			category: ErrorCategory.TIMEOUT,
		},

		REDIS_MEMORY_LIMIT: {
			userMessage: 'Redis server is out of memory. Please contact your administrator.',
			technicalMessage: 'Redis memory limit exceeded',
			troubleshooting: [
				'Check Redis memory usage and limits',
				'Clear old or unused data from Redis',
				'Increase Redis memory limit if possible',
				'Consider using data expiration policies',
			],
			errorCode: 'REDIS_004',
			category: ErrorCategory.RESOURCE_LIMIT,
		},

		// Rate Limiting Errors
		INVALID_RATE_LIMIT: {
			userMessage: 'Rate limit configuration is invalid. Please use positive numbers for limits and time windows.',
			technicalMessage: 'Invalid rate limit configuration',
			troubleshooting: [
				'Ensure maxRequests is a positive number',
				'Verify windowSize is greater than 0',
				'Check that algorithm is one of: token_bucket, sliding_window, fixed_window',
				'Validate strategy is one of: per_user, per_ip, per_session, global',
			],
			errorCode: 'RATE_001',
			category: ErrorCategory.CONFIGURATION,
		},

		RATE_LIMIT_EXCEEDED: {
			userMessage: 'Rate limit exceeded. Please wait before making more requests.',
			technicalMessage: 'Rate limit threshold reached',
			troubleshooting: [
				'Wait for the rate limit window to reset',
				'Reduce request frequency',
				'Consider upgrading to higher rate limits if available',
				'Implement exponential backoff in your application',
			],
			errorCode: 'RATE_002',
			category: ErrorCategory.RESOURCE_LIMIT,
		},

		// Session Management Errors
		SESSION_EXPIRED: {
			userMessage: 'User session has expired. A new session will be created.',
			technicalMessage: 'Session TTL expired',
			troubleshooting: [
				'This is normal behavior for expired sessions',
				'Consider extending session TTL if needed',
				'Implement session refresh mechanisms',
			],
			errorCode: 'SESSION_001',
			category: ErrorCategory.OPERATION,
		},

		SESSION_LIMIT_EXCEEDED: {
			userMessage: 'Maximum number of sessions reached. Oldest sessions will be removed.',
			technicalMessage: 'Session limit exceeded',
			troubleshooting: [
				'This is automatic cleanup behavior',
				'Consider increasing maxSessions limit',
				'Implement session cleanup policies',
				'Monitor session usage patterns',
			],
			errorCode: 'SESSION_002',
			category: ErrorCategory.RESOURCE_LIMIT,
		},

		INVALID_SESSION_CONFIG: {
			userMessage: 'Session configuration is invalid. Please check TTL and session limits.',
			technicalMessage: 'Invalid session configuration',
			troubleshooting: [
				'Ensure defaultTtl is a positive number',
				'Verify maxSessions is greater than 0',
				'Check maxContextSize is reasonable',
			],
			errorCode: 'SESSION_003',
			category: ErrorCategory.CONFIGURATION,
		},

		// Message Buffer Errors
		BUFFER_SIZE_EXCEEDED: {
			userMessage: 'Message buffer is full. Messages will be processed to make room.',
			technicalMessage: 'Buffer size limit reached',
			troubleshooting: [
				'This triggers automatic buffer flushing',
				'Consider increasing buffer size if needed',
				'Reduce message processing time',
				'Implement buffer monitoring',
			],
			errorCode: 'BUFFER_001',
			category: ErrorCategory.RESOURCE_LIMIT,
		},

		INVALID_BUFFER_CONFIG: {
			userMessage: 'Message buffer configuration is invalid. Please check size and interval settings.',
			technicalMessage: 'Invalid buffer configuration',
			troubleshooting: [
				'Ensure maxSize is a positive number',
				'Verify flushInterval is greater than 0',
				'Check that pattern is valid: collect_send, throttle, batch, priority',
			],
			errorCode: 'BUFFER_002',
			category: ErrorCategory.CONFIGURATION,
		},

		// Message Routing Errors
		ROUTING_FAILED: {
			userMessage: 'Message routing failed. Please check channel configuration.',
			technicalMessage: 'Message routing error',
			troubleshooting: [
				'Verify target channels exist and are accessible',
				'Check routing rules and patterns',
				'Ensure pub/sub connections are working',
				'Validate channel permissions',
			],
			errorCode: 'ROUTING_001',
			category: ErrorCategory.OPERATION,
		},

		INVALID_ROUTING_CONFIG: {
			userMessage: 'Message routing configuration is invalid. Please check channels and patterns.',
			technicalMessage: 'Invalid routing configuration',
			troubleshooting: [
				'Ensure channels array is not empty',
				'Verify routing pattern is valid',
				'Check routing rules syntax',
				'Validate channel names',
			],
			errorCode: 'ROUTING_002',
			category: ErrorCategory.CONFIGURATION,
		},

		// Storage Errors
		STORAGE_SIZE_LIMIT: {
			userMessage: 'Data size exceeds storage limit. Please reduce the amount of data being stored.',
			technicalMessage: 'Storage size limit exceeded',
			troubleshooting: [
				'Reduce the size of data being stored',
				'Use data compression if available',
				'Consider breaking large data into smaller chunks',
				'Increase maxValueSize limit if possible',
			],
			errorCode: 'STORAGE_001',
			category: ErrorCategory.RESOURCE_LIMIT,
		},

		INVALID_STORAGE_CONFIG: {
			userMessage: 'Storage configuration is invalid. Please check TTL and size limits.',
			technicalMessage: 'Invalid storage configuration',
			troubleshooting: [
				'Ensure defaultTtl is a positive number',
				'Verify maxValueSize is reasonable',
				'Check storage type settings',
			],
			errorCode: 'STORAGE_002',
			category: ErrorCategory.CONFIGURATION,
		},

		// Analytics Errors
		ANALYTICS_LIMIT_EXCEEDED: {
			userMessage: 'Analytics storage limit reached. Old metrics will be cleaned up automatically.',
			technicalMessage: 'Analytics storage limit exceeded',
			troubleshooting: [
				'This triggers automatic cleanup',
				'Consider increasing retention period',
				'Implement metric aggregation',
				'Monitor analytics storage usage',
			],
			errorCode: 'ANALYTICS_001',
			category: ErrorCategory.RESOURCE_LIMIT,
		},

		INVALID_ANALYTICS_CONFIG: {
			userMessage: 'Analytics configuration is invalid. Please check retention and batch settings.',
			technicalMessage: 'Invalid analytics configuration',
			troubleshooting: [
				'Ensure retentionDays is a positive number',
				'Verify batchSize is greater than 0',
				'Check flushInterval is reasonable',
			],
			errorCode: 'ANALYTICS_002',
			category: ErrorCategory.CONFIGURATION,
		},

		// General Errors
		VALIDATION_ERROR: {
			userMessage: 'Input validation failed. Please check your input parameters.',
			technicalMessage: 'Input validation error',
			troubleshooting: [
				'Check required fields are provided',
				'Verify data types match expected formats',
				'Ensure values are within valid ranges',
			],
			errorCode: 'VALIDATION_001',
			category: ErrorCategory.VALIDATION,
		},

		OPERATION_TIMEOUT: {
			userMessage: 'Operation timed out. The system may be busy, please try again.',
			technicalMessage: 'Operation timeout',
			troubleshooting: [
				'Wait a moment and try again',
				'Check system load and performance',
				'Consider increasing timeout values',
				'Verify network connectivity',
			],
			errorCode: 'TIMEOUT_001',
			category: ErrorCategory.TIMEOUT,
		},
	};

	/**
	 * Create a user-friendly error from a technical error
	 */
	static createUserFriendlyError(
		errorKey: string,
		originalError?: Error,
		context?: Record<string, any>
	): NodeOperationError {
		const errorInfo = this.ERROR_MESSAGES[errorKey];
		
		if (!errorInfo) {
			// Fallback for unknown errors
			return new NodeOperationError(
				null as any,
				originalError?.message || 'An unexpected error occurred',
				{
					description: 'Please contact support if this error persists',
				}
			);
		}

		const errorMessage = context 
			? this.interpolateMessage(errorInfo.userMessage, context)
			: errorInfo.userMessage;

		const troubleshootingText = errorInfo.troubleshooting
			.map((tip, index) => `${index + 1}. ${tip}`)
			.join('\n');

		return new NodeOperationError(
			null as any,
			errorMessage,
			{
				description: `${errorInfo.technicalMessage}\n\nTroubleshooting:\n${troubleshootingText}`,
				itemIndex: context?.itemIndex,
				runIndex: context?.runIndex,
			}
		);
	}

	/**
	 * Get error information without throwing
	 */
	static getErrorInfo(errorKey: string): UserFriendlyError | undefined {
		return this.ERROR_MESSAGES[errorKey];
	}

	/**
	 * Check if an error is a specific type
	 */
	static isErrorType(error: Error, errorKey: string): boolean {
		if (error instanceof NodeOperationError) {
			return error.description?.includes(this.ERROR_MESSAGES[errorKey]?.errorCode) || false;
		}
		return false;
	}

	/**
	 * Extract error category from technical error
	 */
	static categorizeError(error: Error): ErrorCategory {
		const message = error.message.toLowerCase();
		
		if (message.includes('connection') || message.includes('connect')) {
			return ErrorCategory.CONNECTION;
		}
		if (message.includes('timeout')) {
			return ErrorCategory.TIMEOUT;
		}
		if (message.includes('memory') || message.includes('limit') || message.includes('exceeded')) {
			return ErrorCategory.RESOURCE_LIMIT;
		}
		if (message.includes('config') || message.includes('invalid')) {
			return ErrorCategory.CONFIGURATION;
		}
		if (message.includes('validation') || message.includes('validate')) {
			return ErrorCategory.VALIDATION;
		}
		
		return ErrorCategory.OPERATION;
	}

	/**
	 * Create graceful degradation response
	 */
	static createGracefulResponse(
		operation: string,
		fallbackValue: any,
		reason: string
	): { success: boolean; data: any; warning: string } {
		return {
			success: true,
			data: fallbackValue,
			warning: `${operation} is using fallback mode: ${reason}`,
		};
	}

	/**
	 * Interpolate context variables into message templates
	 */
	private static interpolateMessage(template: string, context: Record<string, any>): string {
		return template.replace(/\{(\w+)\}/g, (match, key) => {
			return context[key]?.toString() || match;
		});
	}

	/**
	 * Log structured error for debugging
	 */
	static logError(
		errorKey: string,
		originalError?: Error,
		context?: Record<string, any>
	): void {
		const errorInfo = this.ERROR_MESSAGES[errorKey];
		
		console.error('Structured Error Log:', {
			errorKey,
			errorCode: errorInfo?.errorCode,
			category: errorInfo?.category,
			userMessage: errorInfo?.userMessage,
			technicalMessage: errorInfo?.technicalMessage,
			originalError: originalError?.message,
			stack: originalError?.stack,
			context,
			timestamp: new Date().toISOString(),
		});
	}
}

/**
 * Utility function to wrap operations with error handling
 */
export async function withErrorHandling<T>(
	operation: () => Promise<T>,
	errorKey: string,
	context?: Record<string, any>
): Promise<T> {
	try {
		return await operation();
	} catch (error) {
		ErrorHandler.logError(errorKey, error as Error, context);
		throw ErrorHandler.createUserFriendlyError(errorKey, error as Error, context);
	}
}

/**
 * Utility function for graceful degradation
 */
export async function withGracefulDegradation<T>(
	operation: () => Promise<T>,
	fallback: () => T,
	errorKey: string,
	context?: Record<string, any>
): Promise<{ success: boolean; data: T; error?: string }> {
	try {
		const data = await operation();
		return { success: true, data };
	} catch (error) {
		ErrorHandler.logError(errorKey, error as Error, context);
		
		try {
			const fallbackData = fallback();
			return {
				success: true,
				data: fallbackData,
				error: `Using fallback: ${(error as Error).message}`,
			};
		} catch (fallbackError) {
			throw ErrorHandler.createUserFriendlyError(errorKey, error as Error, context);
		}
	}
}