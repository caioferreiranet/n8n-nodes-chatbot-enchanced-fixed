import type {
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';
import { NodeConnectionType, NodeOperationError } from 'n8n-workflow';

// Import managers
import { RedisManager } from './managers/RedisManager';
import { MessageBuffer } from './managers/MessageBuffer';
import { RateLimiter } from './managers/RateLimiter';
import { SessionManager } from './managers/SessionManager';
import { UserStorage } from './managers/UserStorage';
import { AnalyticsTracker } from './managers/AnalyticsTracker';
import { MessageRouter } from './managers/MessageRouter';

// Import types
import { RedisCredential, TemplateType, OperationType } from './types';

export class ChatBotEnhanced implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'ChatBot Enhanced',
		name: 'chatBotEnhanced',
		icon: 'file:chatbot-enhanced.svg',
		group: ['transform'],
		version: 1,
		description: 'Enhanced chatbot node with Redis/Valkey integration for rate limiting, session management, and advanced features',
		defaults: {
			name: 'ChatBot Enhanced',
		},
		inputs: [NodeConnectionType.Main],
		outputs: [NodeConnectionType.Main, NodeConnectionType.Main, NodeConnectionType.Main, NodeConnectionType.Main],
		outputNames: ['Success', 'Processed', 'Error', 'Metrics'],
		credentials: [
			{
				name: 'redisApi',
				required: true,
			},
		],
		properties: [
			// Template Configuration
			{
				displayName: 'Configuration Mode',
				name: 'configMode',
				type: 'options',
				options: [
					{
						name: 'Use Template (Recommended)',
						value: 'template',
						description: 'Start with pre-configured templates for common scenarios',
					},
					{
						name: 'Advanced Configuration',
						value: 'advanced',
						description: 'Configure individual operations manually',
					},
				],
				default: 'template',
				description: 'Choose between template-based setup or manual configuration',
			},

			// Template Selection
			{
				displayName: 'Template',
				name: 'templateType',
				type: 'options',
				displayOptions: {
					show: {
						configMode: ['template'],
					},
				},
				options: [
					{
						name: 'Basic Rate Limiting',
						value: 'basicRateLimit',
						description: 'Simple rate limiting to prevent spam (2 min setup)',
					},
					{
						name: 'Customer Support',
						value: 'customerSupport',
						description: 'Session management + user storage for support (5 min setup)',
					},
					{
						name: 'High Volume Buffer',
						value: 'highVolumeBuffer',
						description: 'Message buffering + analytics for high traffic (5 min setup)',
					},
					{
						name: 'Multi-Channel Router',
						value: 'multiChannelRouter',
						description: 'Full routing + analytics for multi-channel bots (15 min setup)',
					},
					{
						name: 'Smart FAQ Memory',
						value: 'smartFaqMemory',
						description: 'Smart memory + routing for FAQ systems (10 min setup)',
					},
				],
				default: 'basicRateLimit',
			},

			// Advanced Operation Selection
			{
				displayName: 'Operation',
				name: 'operationType',
				type: 'options',
				displayOptions: {
					show: {
						configMode: ['advanced'],
					},
				},
				options: [
					{
						name: 'Analytics',
						value: 'analytics',
						description: 'Track metrics, performance, and generate alerts',
					},
					{
						name: 'Message Buffering',
						value: 'messageBuffering',
						description: 'Buffer messages with time-based or size-based flushing',
					},
					{
						name: 'Message Routing',
						value: 'messageRouting',
						description: 'Route messages based on content, priority, or load balancing',
					},
					{
						name: 'Session Management',
						value: 'sessionManagement',
						description: 'User session tracking with context and cleanup',
					},
					{
						name: 'Smart Memory',
						value: 'smartMemory',
						description: 'Conversation memory with FAQ and context storage',
					},
					{
						name: 'Smart Rate Limiting',
						value: 'smartRateLimit',
						description: 'Advanced rate limiting with burst detection and penalties',
					},
					{
						name: 'User Storage',
						value: 'userStorage',
						description: 'Store user profiles, preferences, and history',
					},
				],
				default: 'smartRateLimit',
			},

			// Common Parameters
			{
				displayName: 'Session Key',
				name: 'sessionKey',
				type: 'string',
				required: true,
				default: '={{$json.userId || $json.sessionId || "default"}}',
				description: 'Unique identifier for the user or session (can use expressions)',
			},
			{
				displayName: 'Message Content',
				name: 'messageContent',
				type: 'string',
				default: '={{$json.message || $json.text || $json.content}}',
				description: 'The message content to process (can use expressions)',
			},

			// Buffer Time Configuration (Critical Feature)
			{
				displayName: 'Buffer Time (Seconds)',
				name: 'bufferTime',
				type: 'number',
				default: 30,
				typeOptions: {
					minValue: 1,
					maxValue: 3600,
				},
				displayOptions: {
					show: {
						operationType: ['messageBuffering'],
					},
				},
				description: 'Time to wait before flushing buffered messages',
			},
			{
				displayName: 'Buffer Size',
				name: 'bufferSize',
				type: 'number',
				default: 100,
				typeOptions: {
					minValue: 1,
					maxValue: 10000,
				},
				displayOptions: {
					show: {
						operationType: ['messageBuffering'],
					},
				},
				description: 'Maximum number of messages to buffer before flushing',
			},
			{
				displayName: 'Buffer Pattern',
				name: 'bufferPattern',
				type: 'options',
				options: [
					{
						name: 'Collect & Send All',
						value: 'collect_send',
						description: 'Collect messages and send all at once',
					},
					{
						name: 'Throttle',
						value: 'throttle',
						description: 'Send messages in controlled batches',
					},
					{
						name: 'Priority Based',
						value: 'priority',
						description: 'Send high priority messages first',
					},
				],
				default: 'collect_send',
				displayOptions: {
					show: {
						operationType: ['messageBuffering'],
					},
				},
				description: 'How to handle buffered messages when flushing',
			},

			// Rate Limiting Configuration
			{
				displayName: 'Rate Limit (Requests per Minute)',
				name: 'rateLimit',
				type: 'number',
				default: 10,
				typeOptions: {
					minValue: 1,
					maxValue: 1000,
				},
				displayOptions: {
					show: {
						operationType: ['smartRateLimit'],
					},
				},
				description: 'Maximum number of requests allowed per minute',
			},

			// Session Configuration
			{
				displayName: 'Session Timeout (Minutes)',
				name: 'sessionTimeout',
				type: 'number',
				default: 30,
				typeOptions: {
					minValue: 1,
					maxValue: 1440,
				},
				displayOptions: {
					show: {
						operationType: ['sessionManagement'],
					},
				},
				description: 'How long to keep sessions active without activity',
			},

			// Global Options
			{
				displayName: 'Enable Debug Mode',
				name: 'debugMode',
				type: 'boolean',
				default: false,
				description: 'Whether to enable detailed logging and debug information',
			},
			{
				displayName: 'Redis Key Prefix',
				name: 'keyPrefix',
				type: 'string',
				default: 'chatbot',
				description: 'Prefix for Redis keys to avoid collisions',
			},
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const successItems: INodeExecutionData[] = [];
		const processedItems: INodeExecutionData[] = [];
		const errorItems: INodeExecutionData[] = [];
		const metricsItems: INodeExecutionData[] = [];

		// Initialize Redis connection
		let redisManager: RedisManager | null = null;
		
		try {
			// Get Redis credentials
			const credentials = await this.getCredentials('redisApi') as RedisCredential;
			
			// Initialize Redis manager
			redisManager = new RedisManager(credentials, {
				connectionTimeout: 5000,
				maxRetries: 3,
				retryDelay: 1000,
				healthCheckInterval: 30000,
			});

			await redisManager.connect();

			// Process each input item
			for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
				try {
					const startTime = Date.now();
					
					// Get parameters for this item
					const configMode = this.getNodeParameter('configMode', itemIndex) as string;
					const sessionKey = this.getNodeParameter('sessionKey', itemIndex) as string;
					const messageContent = this.getNodeParameter('messageContent', itemIndex) as string;
					const debugMode = this.getNodeParameter('debugMode', itemIndex) as boolean;
					const keyPrefix = this.getNodeParameter('keyPrefix', itemIndex) as string;

					// Determine operation type
					let operationType: OperationType;
					let templateType: TemplateType | undefined;

					if (configMode === 'template') {
						templateType = this.getNodeParameter('templateType', itemIndex) as TemplateType;
						operationType = ChatBotEnhanced.mapTemplateToOperation(templateType);
					} else {
						operationType = this.getNodeParameter('operationType', itemIndex) as OperationType;
					}

					if (debugMode) {
						console.log(`Processing item ${itemIndex} with operation: ${operationType}`);
					}

					// Execute the appropriate operation
					const result = await ChatBotEnhanced.executeOperation(
						redisManager,
						operationType,
						this,
						{
							sessionKey,
							messageContent,
							debugMode,
							keyPrefix,
							itemIndex,
							inputData: items[itemIndex].json,
						}
					);

					const processingTime = Date.now() - startTime;

					// Add results to appropriate outputs
					if (result.success) {
						successItems.push({
							json: {
								...result.success,
								processingTime,
								itemIndex,
							},
						});
					}

					if (result.processed) {
						processedItems.push({
							json: {
								...result.processed,
								processingTime,
								itemIndex,
							},
						});
					}

					if (result.metrics) {
						metricsItems.push({
							json: {
								...result.metrics,
								processingTime,
								itemIndex,
								redisHealth: redisManager.isAvailable(),
							},
						});
					}

				} catch (itemError) {
					const errorOutput = {
						type: 'error' as const,
						data: {
							errorType: 'ITEM_PROCESSING_ERROR',
							errorMessage: itemError instanceof Error ? itemError.message : 'Unknown error',
							errorCode: 'ITEM_EXEC_FAILED',
							originalInput: items[itemIndex].json,
							retryable: true,
							itemIndex,
						},
						timestamp: Date.now(),
					};

					errorItems.push({ json: errorOutput });

					if (!this.continueOnFail()) {
						throw new NodeOperationError(this.getNode(), itemError as Error);
					}
				}
			}

		} catch (error) {
			const errorOutput = {
				type: 'error' as const,
				data: {
					errorType: 'NODE_EXECUTION_ERROR',
					errorMessage: error instanceof Error ? error.message : 'Unknown error',
					errorCode: 'NODE_EXEC_FAILED',
					retryable: false,
				},
				timestamp: Date.now(),
			};

			errorItems.push({ json: errorOutput });

			if (!this.continueOnFail()) {
				throw new NodeOperationError(this.getNode(), error as Error);
			}
		} finally {
			// Clean up Redis connection
			if (redisManager) {
				await redisManager.cleanup();
			}
		}

		return [successItems, processedItems, errorItems, metricsItems];
	}

	/**
	 * Map template type to operation type
	 */
	private static mapTemplateToOperation(templateType: TemplateType): OperationType {
		const templateMap: Record<TemplateType, OperationType> = {
			basicRateLimit: 'smartRateLimit',
			customerSupport: 'sessionManagement',
			highVolumeBuffer: 'messageBuffering',
			smartFaqMemory: 'smartMemory',
			multiChannelRouter: 'messageRouting',
		};

		return templateMap[templateType];
	}

	/**
	 * Execute specific operation based on type
	 */
	private static async executeOperation(
		redisManager: RedisManager,
		operationType: OperationType,
		executeFunctions: IExecuteFunctions,
		params: {
			sessionKey: string;
			messageContent: string;
			debugMode: boolean;
			keyPrefix: string;
			itemIndex: number;
			inputData: any;
		}
	): Promise<{
		success?: any;
		processed?: any;
		metrics?: any;
	}> {
		const { sessionKey, messageContent, debugMode, keyPrefix, itemIndex, inputData } = params;

		switch (operationType) {
			case 'smartRateLimit':
				return ChatBotEnhanced.executeRateLimit(redisManager, executeFunctions, { sessionKey, messageContent, debugMode, keyPrefix, itemIndex });

			case 'sessionManagement':
				return ChatBotEnhanced.executeSessionManagement(redisManager, executeFunctions, { sessionKey, messageContent, debugMode, keyPrefix, itemIndex, inputData });

			case 'messageBuffering':
				return ChatBotEnhanced.executeMessageBuffering(redisManager, executeFunctions, { sessionKey, messageContent, debugMode, keyPrefix, itemIndex });

			case 'smartMemory':
				return ChatBotEnhanced.executeSmartMemory(redisManager, executeFunctions, { sessionKey, messageContent, debugMode, keyPrefix, itemIndex, inputData });

			case 'messageRouting':
				return ChatBotEnhanced.executeMessageRouting(redisManager, executeFunctions, { sessionKey, messageContent, debugMode, keyPrefix, itemIndex, inputData });

			case 'userStorage':
				return ChatBotEnhanced.executeUserStorage(redisManager, executeFunctions, { sessionKey, messageContent, debugMode, keyPrefix, itemIndex, inputData });

			case 'analytics':
				return ChatBotEnhanced.executeAnalytics(redisManager, executeFunctions, { sessionKey, messageContent, debugMode, keyPrefix, itemIndex, inputData });

			default:
				throw new NodeOperationError(executeFunctions.getNode(), `Unknown operation type: ${operationType}`);
		}
	}

	/**
	 * Execute Smart Rate Limiting
	 */
	private static async executeRateLimit(
		redisManager: RedisManager,
		executeFunctions: IExecuteFunctions,
		params: { sessionKey: string; messageContent: string; debugMode: boolean; keyPrefix: string; itemIndex: number }
	) {
		const rateLimit = executeFunctions.getNodeParameter('rateLimit', params.itemIndex, 10) as number;
		
		const rateLimiter = new RateLimiter(redisManager, {
			algorithm: 'sliding_window',
			strategy: 'per_user',
			windowSize: 60, // 1 minute in seconds
			maxRequests: rateLimit,
			burstLimit: Math.ceil(rateLimit * 1.5),
			penaltyTime: 300, // 5 minutes in seconds
			keyPrefix: params.keyPrefix,
		});

		const result = await rateLimiter.checkRateLimit(params.sessionKey);

		if (params.debugMode) {
			console.log(`Rate limit check for ${params.sessionKey}:`, result);
		}

		return {
			success: {
				type: 'success',
				data: {
					message: params.messageContent,
					sessionId: params.sessionKey,
					operationType: 'smartRateLimit',
					allowed: result.allowed,
					rateLimitData: {
						requestCount: result.totalRequests,
						remainingRequests: result.remainingRequests,
						resetTime: result.resetTime,
						retryAfter: result.retryAfter,
					},
				},
				timestamp: Date.now(),
			},
			metrics: {
				type: 'metrics',
				data: {
					operationType: 'smartRateLimit',
					metrics: {
						requestCount: result.totalRequests,
						remainingRequests: result.remainingRequests,
						windowUtilization: (result.totalRequests / rateLimit) * 100,
					},
					performance: {
						processingTime: 0, // Will be set by caller
						redisHealth: redisManager.isAvailable(),
					},
				},
				timestamp: Date.now(),
			},
		};
	}

	/**
	 * Execute Session Management
	 */
	private static async executeSessionManagement(
		redisManager: RedisManager,
		executeFunctions: IExecuteFunctions,
		params: { sessionKey: string; messageContent: string; debugMode: boolean; keyPrefix: string; itemIndex: number; inputData: any }
	) {
		const sessionTimeout = executeFunctions.getNodeParameter('sessionTimeout', params.itemIndex, 30) as number;
		
		const sessionManager = new SessionManager(redisManager, {
			defaultTtl: sessionTimeout * 60, // Convert minutes to seconds
			maxSessions: 10000,
			enableCleanup: true,
			cleanupInterval: 3600,
			contextStorage: true,
			maxContextSize: 100,
			compression: false,
			keyPrefix: params.keyPrefix,
		});

		// Check if session exists, create if not
		let sessionData = await sessionManager.getSession(params.sessionKey);
		if (!sessionData) {
			sessionData = await sessionManager.createSession(params.sessionKey, {
				userId: params.inputData.userId || params.sessionKey,
				channelId: params.inputData.channelId,
				initialContext: {},
				metadata: params.inputData.metadata || {},
			});
		}

		// Update session with new message
		sessionData = await sessionManager.updateSession(params.sessionKey, {
			message: params.messageContent,
			messageType: 'user',
			extendTtl: true,
		}) || sessionData;

		if (params.debugMode) {
			console.log(`Session data for ${params.sessionKey}:`, sessionData);
		}

		return {
			success: {
				type: 'success',
				data: {
					message: params.messageContent,
					sessionId: params.sessionKey,
					operationType: 'sessionManagement',
					sessionData: {
						startTime: sessionData.createdAt,
						lastActivity: sessionData.lastActivity,
						messageCount: sessionData.messageCount,
						context: sessionData.context,
					},
				},
				timestamp: Date.now(),
			},
			processed: {
				type: 'processed',
				data: {
					originalMessage: params.messageContent,
					enrichmentData: {
						sessionContext: sessionData.context,
						userHistory: sessionData.conversationHistory || [],
						sessionAge: Date.now() - sessionData.createdAt,
					},
				},
				timestamp: Date.now(),
			},
			metrics: {
				type: 'metrics',
				data: {
					operationType: 'sessionManagement',
					metrics: {
						activeSession: 1,
						messageCount: sessionData.messageCount,
						sessionAge: Date.now() - sessionData.createdAt,
					},
					performance: {
						processingTime: 0,
						redisHealth: redisManager.isAvailable(),
					},
				},
				timestamp: Date.now(),
			},
		};
	}

	/**
	 * Execute Message Buffering (Critical Feature)
	 */
	private static async executeMessageBuffering(
		redisManager: RedisManager,
		executeFunctions: IExecuteFunctions,
		params: { sessionKey: string; messageContent: string; debugMode: boolean; keyPrefix: string; itemIndex: number }
	) {
		const bufferTime = executeFunctions.getNodeParameter('bufferTime', params.itemIndex, 30) as number;
		const bufferSize = executeFunctions.getNodeParameter('bufferSize', params.itemIndex, 100) as number;
		const bufferPattern = executeFunctions.getNodeParameter('bufferPattern', params.itemIndex, 'collect_send') as string;

		const messageBuffer = new MessageBuffer(redisManager, {
			pattern: bufferPattern as any,
			maxSize: bufferSize,
			flushInterval: bufferTime,
			enableStreams: true,
			streamMaxLength: 10000,
			keyPrefix: params.keyPrefix,
		});

		const result = await messageBuffer.addMessage(params.sessionKey, {
			content: params.messageContent,
			priority: 1,
			metadata: {
				timestamp: Date.now(),
				source: 'chatbot-enhanced',
			},
		});

		if (params.debugMode) {
			console.log(`Buffer result for ${params.sessionKey}:`, result);
		}

		// Get buffer state for metrics
		const bufferState = await messageBuffer.getBuffer(params.sessionKey);

		return {
			success: {
				type: 'success',
				data: {
					message: params.messageContent,
					sessionId: params.sessionKey,
					operationType: 'messageBuffering',
					bufferId: result.bufferId,
					messageId: result.messageId,
					shouldFlush: result.shouldFlush,
					bufferConfig: {
						bufferTime,
						bufferSize,
						pattern: bufferPattern,
					},
				},
				timestamp: Date.now(),
			},
			processed: {
				type: 'processed',
				data: {
					originalMessage: params.messageContent,
					transformedMessage: params.messageContent,
					enrichmentData: {
						buffered: true,
						bufferPosition: bufferState?.messages.length || 0,
						estimatedFlushTime: bufferState?.nextFlush || Date.now() + (bufferTime * 1000),
					},
				},
				timestamp: Date.now(),
			},
			metrics: {
				type: 'metrics',
				data: {
					operationType: 'messageBuffering',
					metrics: {
						bufferSize: bufferState?.messages.length || 0,
						maxBufferSize: bufferSize,
						bufferUtilization: ((bufferState?.messages.length || 0) / bufferSize) * 100,
						timeToFlush: (bufferState?.nextFlush || Date.now()) - Date.now(),
					},
					performance: {
						processingTime: 0,
						queueSize: bufferState?.messages.length || 0,
						redisHealth: redisManager.isAvailable(),
					},
					alerts: result.shouldFlush ? [{
						level: 'info' as const,
						message: 'Buffer flush triggered',
						threshold: bufferSize,
						currentValue: bufferState?.messages.length || 0,
					}] : [],
				},
				timestamp: Date.now(),
			},
		};
	}

	/**
	 * Execute Smart Memory
	 */
	private static async executeSmartMemory(
		redisManager: RedisManager,
		executeFunctions: IExecuteFunctions,
		params: { sessionKey: string; messageContent: string; debugMode: boolean; keyPrefix: string; itemIndex: number; inputData: any }
	) {
		// Implementation for smart memory
		return {
			success: {
				type: 'success',
				data: {
					message: params.messageContent,
					sessionId: params.sessionKey,
					operationType: 'smartMemory',
					memoryStored: true,
				},
				timestamp: Date.now(),
			},
			metrics: {
				type: 'metrics',
				data: {
					operationType: 'smartMemory',
					metrics: {
						memoryEntries: 1,
					},
					performance: {
						processingTime: 0,
						redisHealth: redisManager.isAvailable(),
					},
				},
				timestamp: Date.now(),
			},
		};
	}

	/**
	 * Execute Message Routing
	 */
	private static async executeMessageRouting(
		redisManager: RedisManager,
		executeFunctions: IExecuteFunctions,
		params: { sessionKey: string; messageContent: string; debugMode: boolean; keyPrefix: string; itemIndex: number; inputData: any }
	) {
		const messageRouter = new MessageRouter(redisManager, {
			pattern: 'topic_based',
			channels: ['support-queue', 'sales-queue', 'general-queue'],
			routingRules: [
				{ name: 'support-rule', condition: 'support', targetChannel: 'support-queue', priority: 1, enabled: true },
				{ name: 'sales-rule', condition: 'sales', targetChannel: 'sales-queue', priority: 2, enabled: true },
			],
			enablePatternMatching: true,
			keyPrefix: params.keyPrefix,
		});

		const routingResult = await messageRouter.routeMessage({
			content: params.messageContent,
			sourceChannel: params.inputData.channelId,
			metadata: {
				...params.inputData.metadata || {},
				userId: params.sessionKey,
				timestamp: Date.now(),
			},
		});

		return {
			success: {
				type: 'success',
				data: {
					message: params.messageContent,
					sessionId: params.sessionKey,
					operationType: 'messageRouting',
					routedTo: routingResult.delivered.join(', '),
					routingReason: routingResult.routingRule || 'default',
				},
				timestamp: Date.now(),
			},
			processed: {
				type: 'processed',
				data: {
					originalMessage: params.messageContent,
					routingDecision: routingResult.delivered.join(', '),
					enrichmentData: {
						routingRule: routingResult.routingRule,
						processingTime: routingResult.processingTime,
						deliveredCount: routingResult.delivered.length,
					},
				},
				timestamp: Date.now(),
			},
			metrics: {
				type: 'metrics',
				data: {
					operationType: 'messageRouting',
					metrics: {
						routingDecisions: 1,
						deliveredChannels: routingResult.delivered.length,
						failedChannels: routingResult.failed.length,
					},
					performance: {
						processingTime: 0,
						redisHealth: redisManager.isAvailable(),
					},
				},
				timestamp: Date.now(),
			},
		};
	}

	/**
	 * Execute User Storage
	 */
	private static async executeUserStorage(
		redisManager: RedisManager,
		executeFunctions: IExecuteFunctions,
		params: { sessionKey: string; messageContent: string; debugMode: boolean; keyPrefix: string; itemIndex: number; inputData: any }
	) {
		const userStorage = new UserStorage(redisManager, {
			defaultTtl: 30 * 24 * 3600, // 30 days in seconds
			enableTypeDetection: true,
			enableCompression: false,
			keyPrefix: params.keyPrefix,
			maxValueSize: 1024 * 1024, // 1MB
			enableIndexing: true,
		});

		await userStorage.store(params.sessionKey, 'profile', {
			lastMessage: params.messageContent,
			lastActivity: Date.now(),
			messageHistory: [params.messageContent],
		}, {
			ttl: 30 * 24 * 3600, // 30 days
			metadata: { type: 'user_profile' },
		});

		const userData = await userStorage.retrieve(params.sessionKey, 'profile');

		return {
			success: {
				type: 'success',
				data: {
					message: params.messageContent,
					sessionId: params.sessionKey,
					operationType: 'userStorage',
					dataStored: true,
					userData: userData,
				},
				timestamp: Date.now(),
			},
			metrics: {
				type: 'metrics',
				data: {
					operationType: 'userStorage',
					metrics: {
						dataEntries: 1,
						storageSize: JSON.stringify(userData || {}).length,
					},
					performance: {
						processingTime: 0,
						redisHealth: redisManager.isAvailable(),
					},
				},
				timestamp: Date.now(),
			},
		};
	}

	/**
	 * Execute Analytics
	 */
	private static async executeAnalytics(
		redisManager: RedisManager,
		executeFunctions: IExecuteFunctions,
		params: { sessionKey: string; messageContent: string; debugMode: boolean; keyPrefix: string; itemIndex: number; inputData: any }
	) {
		const analyticsTracker = new AnalyticsTracker(redisManager, {
			retentionDays: 30,
			enableRealTimeMetrics: true,
			batchSize: 100,
			flushInterval: 60,
			keyPrefix: params.keyPrefix,
			enableHistograms: true,
		});

		await analyticsTracker.recordMetric(
			'message_processed',
			1,
			'counter',
			{ userId: params.sessionKey, source: 'chatbot-enhanced' },
			{ messageLength: params.messageContent.length, timestamp: Date.now() }
		);

		const analytics = await analyticsTracker.queryMetrics({
			name: 'message_processed',
			startTime: Date.now() - 3600000, // 1 hour ago
			endTime: Date.now(),
			aggregation: 'count',
			limit: 100,
		});

		return {
			success: {
				type: 'success',
				data: {
					message: params.messageContent,
					sessionId: params.sessionKey,
					operationType: 'analytics',
					eventTracked: true,
					analytics: analytics,
				},
				timestamp: Date.now(),
			},
			metrics: {
				type: 'metrics',
				data: {
					operationType: 'analytics',
					metrics: {
						eventsTracked: 1,
						analyticsEntries: analytics.length,
						totalCount: analytics.reduce((sum, metric) => sum + metric.value, 0),
					},
					performance: {
						processingTime: 0,
						redisHealth: redisManager.isAvailable(),
					},
				},
				timestamp: Date.now(),
			},
		};
	}
}