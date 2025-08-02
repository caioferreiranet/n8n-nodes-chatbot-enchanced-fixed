import { createClient } from 'redis';

// Redis Client Type
export type RedisClient = ReturnType<typeof createClient>;

// Redis Credential Interface
export interface RedisCredential {
	connectionType: 'standard' | 'cluster' | 'sentinel';
	host?: string;
	port?: number;
	clusterHosts?: string;
	sentinelHosts?: string;
	masterName?: string;
	database?: number;
	authType: 'none' | 'password' | 'userpass';
	username?: string;
	password?: string;
	ssl?: boolean;
	sslOptions?: {
		rejectUnauthorized?: boolean;
		ca?: string;
		cert?: string;
		key?: string;
	};
}

// Template Types
export type TemplateType = 
	| 'basicRateLimit'
	| 'customerSupport'
	| 'highVolumeBuffer'
	| 'smartFaqMemory'
	| 'multiChannelRouter';

// Operation Types
export type OperationType = 
	| 'smartRateLimit'
	| 'sessionManagement'
	| 'messageBuffering'
	| 'smartMemory'
	| 'messageRouting'
	| 'userStorage'
	| 'analytics';

// Output Types
export type OutputType = 'success' | 'processed' | 'error' | 'metrics';

// Rate Limiting Configuration
export interface RateLimitConfig {
	windowSize: number;
	windowUnit: 'seconds' | 'minutes' | 'hours';
	maxRequests: number;
	burstLimit?: number;
	penaltyTime?: number;
	penaltyUnit?: 'seconds' | 'minutes' | 'hours';
}

// Session Management Configuration
export interface SessionConfig {
	sessionTimeout: number;
	sessionTimeoutUnit: 'minutes' | 'hours' | 'days';
	maxSessions?: number;
	sessionCleanup?: boolean;
	cleanupInterval?: number;
	contextStorage?: boolean;
}

// Message Buffering Configuration
export interface BufferConfig {
	bufferSize: number;
	flushInterval: number;
	flushIntervalUnit: 'seconds' | 'minutes';
	flushOnSize?: boolean;
	maxBufferAge?: number;
	maxBufferAgeUnit?: 'minutes' | 'hours';
}

// Smart Memory Configuration
export interface MemoryConfig {
	memoryType: 'conversation' | 'faq' | 'context' | 'preference';
	maxMemorySize: number;
	memoryTtl: number;
	memoryTtlUnit: 'hours' | 'days' | 'weeks';
	compressionEnabled?: boolean;
	vectorSearch?: boolean;
}

// Message Routing Configuration
export interface RoutingConfig {
	routingStrategy: 'round_robin' | 'weighted' | 'priority' | 'content_based';
	routingRules: RoutingRule[];
	fallbackChannel?: string;
	loadBalancing?: boolean;
}

export interface RoutingRule {
	condition: string;
	channel: string;
	weight?: number;
	priority?: number;
}

// User Storage Configuration
export interface UserStorageConfig {
	storageType: 'profile' | 'preferences' | 'history' | 'analytics';
	encryptData?: boolean;
	dataRetention?: number;
	dataRetentionUnit?: 'days' | 'months' | 'years';
	gdprCompliant?: boolean;
}

// Analytics Configuration
export interface AnalyticsConfig {
	metricsToTrack: string[];
	aggregationLevel: 'user' | 'session' | 'channel' | 'global';
	retentionPeriod: number;
	retentionUnit: 'days' | 'weeks' | 'months';
	realTimeAlerts?: boolean;
	alertThresholds?: Record<string, number>;
}

// Unified Operation Configuration
export interface OperationConfiguration {
	operationType: OperationType;
	rateLimit?: RateLimitConfig;
	session?: SessionConfig;
	buffer?: BufferConfig;
	memory?: MemoryConfig;
	routing?: RoutingConfig;
	userStorage?: UserStorageConfig;
	analytics?: AnalyticsConfig;
}

// Template Definition Interface
export interface TemplateDefinition {
	id: TemplateType;
	displayName: string;
	description: string;
	icon?: string;
	category: 'performance' | 'customer_service' | 'intelligence' | 'routing';
	difficulty: 'beginner' | 'intermediate' | 'advanced';
	operations: OperationType[];
	defaultConfiguration: OperationConfiguration;
	configurationSchema: Record<string, any>;
	useCases: string[];
	estimatedSetupTime: string;
}

// Chatbot State Management
export interface ChatbotState {
	sessionId: string;
	userId?: string;
	channelId?: string;
	timestamp: number;
	messageCount: number;
	context: Record<string, any>;
	metadata: Record<string, any>;
	rateLimitData?: {
		requestCount: number;
		windowStart: number;
		penaltyUntil?: number;
	};
	sessionData?: {
		startTime: number;
		lastActivity: number;
		conversationHistory?: any[];
	};
	bufferData?: {
		messages: any[];
		lastFlush: number;
		totalMessages: number;
	};
	memoryData?: {
		conversations: any[];
		faqs: any[];
		preferences: Record<string, any>;
		context: Record<string, any>;
	};
	userStorageData?: {
		profile: Record<string, any>;
		preferences: Record<string, any>;
		history: any[];
		analytics: Record<string, any>;
	};
}

// Node Input/Output Interfaces
export interface ChatbotInput {
	message: string;
	userId?: string;
	sessionId?: string;
	channelId?: string;
	metadata?: Record<string, any>;
	timestamp?: number;
}

export interface ChatbotOutput {
	type: OutputType;
	data: any;
	metadata?: Record<string, any>;
	timestamp: number;
	processingTime?: number;
}

// Success Output
export interface SuccessOutput extends ChatbotOutput {
	type: 'success';
	data: {
		message: string;
		processedData: any;
		nextAction?: string;
	};
}

// Processed Output
export interface ProcessedOutput extends ChatbotOutput {
	type: 'processed';
	data: {
		originalMessage: string;
		transformedMessage?: string;
		enrichmentData?: Record<string, any>;
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
		originalInput?: any;
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

// Node Parameter Types
export interface NodeParameters {
	useTemplate: boolean;
	templateType?: TemplateType;
	operationType?: OperationType;
	advancedMode?: boolean;
	configuration: OperationConfiguration;
	globalOptions?: {
		enableMetrics?: boolean;
		enableDebugMode?: boolean;
		keyPrefix?: string;
		avoidCollisions?: boolean;
	};
}

// Main Node Interface
export interface ChatbotEnhancerNode {
	execute(input: ChatbotInput, parameters: NodeParameters): Promise<{
		success: SuccessOutput[];
		processed: ProcessedOutput[];
		error: ErrorOutput[];
		metrics: MetricsOutput[];
	}>;
}

// Error Types
export interface ChatbotError extends Error {
	type: 'RateLimitError' | 'SessionError' | 'BufferError' | 'MemoryError' | 'RoutingError' | 'StorageError' | 'AnalyticsError' | 'ConfigurationError' | 'RedisError';
	code?: string;
	retryable: boolean;
	details?: Record<string, any>;
}

// Utility Types
export type DeepPartial<T> = {
	[P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P];
};

export type RequiredFields<T, K extends keyof T> = T & Required<Pick<T, K>>;

// Template Configuration Validators
export interface TemplateValidator {
	validate(config: OperationConfiguration): boolean;
	getErrors(config: OperationConfiguration): string[];
	getWarnings(config: OperationConfiguration): string[];
}

// Redis Key Patterns
export interface RedisKeyPattern {
	rateLimit: (userId: string, windowStart: number) => string;
	session: (sessionId: string) => string;
	buffer: (sessionId: string) => string;
	memory: (userId: string, memoryType: string) => string;
	routing: (channelId: string) => string;
	userStorage: (userId: string, storageType: string) => string;
	analytics: (level: string, date: string) => string;
}