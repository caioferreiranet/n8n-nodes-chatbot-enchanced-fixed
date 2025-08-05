import { createClient } from 'redis';

// Redis Client Type
export type RedisClient = ReturnType<typeof createClient>;

// Simplified Redis Credential Interface - matches n8n's built-in redis credential
export interface RedisCredential {
	host: string;
	port: number;
	ssl?: boolean;
	database: number;
	user?: string;
	password?: string;
}


// Operation Types
export type OperationType = 
	| 'messageBuffering'
	| 'messageRouting'
;

// Output Types
export type OutputType = 'success' | 'processed' | 'error' | 'metrics';











// Node Input/Output Interfaces
export interface ChatbotInput {
	message: string;
	userId?: string;
	sessionId?: string;
	channelId?: string;
	metadata?: Record<string, unknown>;
	timestamp?: number;
}

export interface ChatbotOutput {
	type: OutputType;
	data: Record<string, unknown>;
	metadata?: Record<string, unknown>;
	timestamp: number;
	processingTime?: number;
}

// Success Output
export interface SuccessOutput extends ChatbotOutput {
	type: 'success';
	data: {
		message: string;
		processedData: Record<string, unknown>;
		nextAction?: string;
	};
}

// Processed Output
export interface ProcessedOutput extends ChatbotOutput {
	type: 'processed';
	data: {
		originalMessage: string;
		transformedMessage?: string;
		enrichmentData?: Record<string, unknown>;
		routingDecision?: string;
	};
}

// Error Output
export interface ErrorOutput extends ChatbotOutput {
	type: 'error';
	data: {
		errorType: string;
		errorMessage: string;
		errorCode?: string;
		originalInput?: Record<string, unknown>;
		retryable?: boolean;
	};
}

// Metrics Output
export interface MetricsOutput extends ChatbotOutput {
	type: 'metrics';
	data: {
		operationType: OperationType;
		metrics: Record<string, number>;
		performance: {
			processingTime: number;
			queueSize?: number;
			memoryUsage?: number;
			redisHealth?: boolean;
		};
		alerts?: Array<{
			level: 'info' | 'warning' | 'error';
			message: string;
			threshold?: number;
			currentValue?: number;
		}>;
	};
}



// Error Types
export interface ChatbotError extends Error {
	type: 'BufferError' | 'MemoryError' | 'RoutingError' | 'StorageError' | 'ConfigurationError' | 'RedisError';
	code?: string;
	retryable: boolean;
	details?: Record<string, unknown>;
}

// Utility Types
export type DeepPartial<T> = {
	[P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P];
};

export type RequiredFields<T, K extends keyof T> = T & Required<Pick<T, K>>;


// Buffer State for Timed Buffer Logic
export interface BufferState {
	exp: number;
	data: BufferedMessage[];
	sessionId: string;
	totalCount: number;
}

export interface BufferedMessage {
	content: string;
	userId: string;
	timestamp: number;
	metadata?: Record<string, unknown>;
}

// Redis Key Patterns
export interface RedisKeyPattern {
	rateLimit: (userId: string, windowStart: number) => string;
	session: (sessionId: string) => string;
	buffer: (sessionId: string) => string;
	memory: (userId: string, memoryType: string) => string;
	routing: (channelId: string) => string;
}