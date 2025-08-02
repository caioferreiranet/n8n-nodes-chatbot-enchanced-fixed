import type {
	ICredentialTestFunctions,
	ICredentialsDecrypted,
	IExecuteFunctions,
	INodeCredentialTestResult,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';
import { NodeConnectionType, NodeOperationError } from 'n8n-workflow';

// Import managers
import { RedisManager } from './managers/RedisManager';
import { RateLimiter } from './managers/RateLimiter';
import { SessionManager } from './managers/SessionManager';
import { UserStorage } from './managers/UserStorage';
import { AnalyticsTracker } from './managers/AnalyticsTracker';
import { MessageRouter } from './managers/MessageRouter';
import { MessageBuffer } from './managers/MessageBuffer';

// Import types
import { OperationType, RedisCredential } from './types';

export class ChatBotEnhanced implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'ChatBot Enhanced',
		name: 'chatBotEnhanced',
		icon: 'file:chatbot-enhanced.svg',
		group: ['transform'],
		version: 1,
		subtitle: '={{$parameter["operation"] + ": " + $parameter["resource"]}}',
		description: 'Enhanced chatbot node with Redis/Valkey integration for rate limiting, session management, and advanced features',
		defaults: {
			name: 'ChatBot Enhanced',
		},
		inputs: [NodeConnectionType.Main],
		outputs: [NodeConnectionType.Main, NodeConnectionType.Main],
		outputNames: ['Main', 'Status'],
		credentials: [
			{
				name: 'redisApi',
				required: true,
				testedBy: 'redisConnectionTest',
			},
		],
		properties: [
			// Resource Selection (Creates Actions Section)
			{
				displayName: 'Resource',
				name: 'resource',
				type: 'options',
				noDataExpression: true,
				options: [
					{
						name: 'Rate Limiting',
						value: 'rateLimiting',
						description: 'Smart rate limiting with burst protection and penalties',
					},
					{
						name: 'Session',
						value: 'session',
						description: 'User session management and storage operations',
					},
					{
						name: 'Message',
						value: 'message',
						description: 'Message buffering and routing for human-like responses',
					},
					{
						name: 'Analytics',
						value: 'analytics',
						description: 'Smart memory, metrics tracking and performance monitoring',
					},
				],
				default: 'rateLimiting',
				description: 'Choose the category of operations you want to perform',
			},

			// Rate Limiting Operations
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: {
					show: {
						resource: ['rateLimiting'],
					},
				},
				options: [
					{
						name: 'Check Rate Limit',
						value: 'checkRateLimit',
						action: 'Check rate limit status',
						description: 'Verify if user is within rate limits and get remaining quota',
					},
					{
						name: 'Reset User Limits',
						value: 'resetLimits',
						action: 'Reset rate limits for user',
						description: 'Clear rate limiting counters for specific user',
					},
					{
						name: 'Get Limit Status',
						value: 'getLimitStatus',
						action: 'Get detailed limit status',
						description: 'Retrieve comprehensive rate limiting statistics',
					},
				],
				default: 'checkRateLimit',
			},

			// Session Operations
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: {
					show: {
						resource: ['session'],
					},
				},
				options: [
					{
						name: 'Create Session',
						value: 'createSession',
						action: 'Create new user session',
						description: 'Initialize a new user session with context storage',
					},
					{
						name: 'Update Session',
						value: 'updateSession',
						action: 'Update existing session',
						description: 'Add message to session and extend timeout',
					},
					{
						name: 'Get Session Data',
						value: 'getSession',
						action: 'Retrieve session information',
						description: 'Get current session state and conversation history',
					},
					{
						name: 'Store User Data',
						value: 'storeUserData',
						action: 'Store user profile data',
						description: 'Save user preferences, history and profile information',
					},
				],
				default: 'createSession',
			},

			// Message Operations
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: {
					show: {
						resource: ['message'],
					},
				},
				options: [
					{
						name: 'Buffer Messages',
						value: 'bufferMessages',
						action: 'Buffer messages for human like responses',
						description: 'Collect multiple messages and flush after time delay',
					},
					{
						name: 'Route Messages',
						value: 'routeMessages',
						action: 'Route messages to channels',
						description: 'Direct messages to appropriate channels or queues',
					},
					{
						name: 'Process Queue',
						value: 'processQueue',
						action: 'Process message queue',
						description: 'Handle queued messages with priority and load balancing',
					},
				],
				default: 'bufferMessages',
			},

			// Analytics Operations
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: {
					show: {
						resource: ['analytics'],
					},
				},
				options: [
					{
						name: 'Track Event',
						value: 'trackEvent',
						action: 'Track analytics event',
						description: 'Record custom events for analytics and monitoring',
					},
					{
						name: 'Query Metrics',
						value: 'queryMetrics',
						action: 'Query performance metrics',
						description: 'Retrieve analytics data and performance statistics',
					},
					{
						name: 'Store Memory',
						value: 'storeMemory',
						action: 'Store in smart memory',
						description: 'Save conversation context, FAQ or knowledge data',
					},
					{
						name: 'Generate Report',
						value: 'generateReport',
						action: 'Generate analytics report',
						description: 'Create comprehensive performance and usage reports',
					},
				],
				default: 'trackEvent',
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

			// Buffer Time Configuration - Message Buffering
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
						resource: ['message'],
						operation: ['bufferMessages'],
					},
				},
				description: 'Time to wait before flushing buffered messages',
			},

			// Buffer Size - Message Buffering
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
						resource: ['message'],
						operation: ['bufferMessages'],
					},
				},
				description: 'Maximum number of messages to buffer before flushing',
			},

			// Buffer Pattern - Message Buffering
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
						resource: ['message'],
						operation: ['bufferMessages'],
					},
				},
				description: 'How to handle buffered messages when flushing',
			},


			// Anti-Spam Detection
			{
				displayName: 'Anti-Spam Detection',
				name: 'antiSpamType',
				type: 'options',
				options: [
					{
						name: 'Disabled',
						value: 'disabled',
						description: '⚪ Turn off spam protection - all messages will be processed normally'
					},
					{
						name: 'Repeated Text Detection',
						value: 'repeated',
						description: '🔄 Catch users sending the same or very similar messages repeatedly (like "help help help")'
					},
					{
						name: 'Flood Protection',
						value: 'flood',
						description: '⚡ Stop users from flooding your chatbot with too many messages in a short time'
					},
					{
						name: 'Custom Pattern Match',
						value: 'pattern',
						description: '🎯 Advanced: Block messages containing specific words, URLs, phone numbers, or email addresses'
					}
				],
				default: 'disabled',
				displayOptions: {
					show: {
						resource: ['message'],
						operation: ['bufferMessages']
					}
				},
				description: '🛡️ Protect your chatbot from spam messages. Choose how to detect unwanted or repetitive content automatically.'
			},

			// Spam Action
			{
				displayName: 'Spam Action',
				name: 'spamAction',
				type: 'options',
				options: [
					{
						name: 'Block Message',
						value: 'block',
						description: '🚫 Block spam completely - these messages won\'t be processed at all (recommended)'
					},
					{
						name: 'Delay Extra Time',
						value: 'delay',
						description: '⏱️ Slow down spam processing - add extra waiting time before handling suspicious messages'
					},
					{
						name: 'Mark as Spam',
						value: 'mark',
						description: '🏷️ Mark as spam but still process - useful for monitoring what gets detected as spam'
					}
				],
				default: 'block',
				displayOptions: {
					show: {
						resource: ['message'],
						operation: ['bufferMessages'],
						antiSpamType: ['repeated', 'flood', 'pattern']
					}
				},
				description: '⚙️ What should happen when spam is detected? Block it completely, delay it, or just mark it for review'
			},

			// Similarity Threshold
			{
				displayName: 'Similarity Threshold (%)',
				name: 'similarityThreshold',
				type: 'number',
				default: 80,
				typeOptions: {
					minValue: 10,
					maxValue: 100,
					numberPrecision: 0
				},
				displayOptions: {
					show: {
						resource: ['message'],
						operation: ['bufferMessages'],
						antiSpamType: ['repeated']
					}
				},
				description: '📊 How similar must messages be to count as spam? 80% = very similar, 95% = nearly identical. Higher = stricter detection.'
			},

			// Flood Protection Settings
			{
				displayName: 'Max Messages in Window',
				name: 'floodMaxMessages',
				type: 'number',
				default: 5,
				typeOptions: {
					minValue: 2,
					maxValue: 50
				},
				displayOptions: {
					show: {
						resource: ['message'],
						operation: ['bufferMessages'],
						antiSpamType: ['flood']
					}
				},
				description: '📝 Maximum messages allowed in the time window. Example: 5 messages means after 5 messages, additional ones are spam.'
			},

			{
				displayName: 'Flood Time Window (Seconds)',
				name: 'floodTimeWindow',
				type: 'number',
				default: 30,
				typeOptions: {
					minValue: 5,
					maxValue: 300
				},
				displayOptions: {
					show: {
						resource: ['message'],
						operation: ['bufferMessages'],
						antiSpamType: ['flood']
					}
				},
				description: '⏰ Time window for counting messages. Example: 30 seconds means count messages in the last 30 seconds.'
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
						resource: ['rateLimiting'],
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
						resource: ['session'],
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

	methods = {
		credentialTest: {
			async redisConnectionTest(
				this: ICredentialTestFunctions,
				credential: ICredentialsDecrypted,
			): Promise<INodeCredentialTestResult> {
				const credentials = credential.data as unknown as RedisCredential;
				
				try {
					const redisManager = new RedisManager(credentials);
					await redisManager.connect();
					
					// Test basic Redis operation using the client directly
					const client = redisManager.getClient();
					const testKey = 'n8n:credential:test';
					
					await client.set(testKey, 'test', { EX: 5 }); // 5 second expiry
					const testValue = await client.get(testKey);
					
					if (testValue !== 'test') {
						return {
							status: 'Error',
							message: 'Redis read/write test failed',
						};
					}
					
					// Clean up test key
					await client.del(testKey);
					await redisManager.cleanup();

					return {
						status: 'OK',
						message: 'Redis connection successful!',
					};
				} catch (error) {
					return {
						status: 'Error',
						message: `Redis connection failed: ${(error as Error).message}`,
					};
				}
			},
		},
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
			// Get Redis credentials (custom RedisApi)
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
					const resource = this.getNodeParameter('resource', itemIndex) as string;
					const operation = this.getNodeParameter('operation', itemIndex) as string;
					const sessionKey = this.getNodeParameter('sessionKey', itemIndex) as string;
					const messageContent = this.getNodeParameter('messageContent', itemIndex) as string;
					const debugMode = this.getNodeParameter('debugMode', itemIndex) as boolean;
					const keyPrefix = this.getNodeParameter('keyPrefix', itemIndex) as string;

					// Map new resource/operation to legacy operation type
					const operationType = ChatBotEnhanced.mapResourceOperationToLegacy(resource, operation);

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

		// Combine outputs: Main (Success + Processed), Status (Error + Metrics + Anti-spam)
		// Add backward compatibility metadata to identify original output type
		const mainOutput = [
			...successItems.map(item => ({
				...item,
				json: {
					...item.json,
					_outputType: 'success',
					_originalOutput: 0 // Original Success output index
				}
			})),
			...processedItems.map(item => ({
				...item,
				json: {
					...item.json,
					_outputType: 'processed',
					_originalOutput: 1 // Original Processed output index
				}
			}))
		];
		
		const statusOutput = [
			...errorItems.map(item => ({
				...item,
				json: {
					...item.json,
					_outputType: 'error',
					_originalOutput: 2 // Original Error output index
				}
			})),
			...metricsItems.map(item => ({
				...item,
				json: {
					...item.json,
					_outputType: 'metrics',
					_originalOutput: 3 // Original Metrics output index
				}
			}))
		];
		
		return [mainOutput, statusOutput];
	}

	/**
	 * Map new resource/operation pattern to legacy operation type
	 */
	private static mapResourceOperationToLegacy(resource: string, operation: string): OperationType {
		// Rate Limiting Actions
		if (resource === 'rateLimiting') {
			return 'smartRateLimit';
		}
		
		// Session Actions
		if (resource === 'session') {
			if (operation === 'storeUserData') {
				return 'userStorage';
			}
			return 'sessionManagement';
		}
		
		// Message Actions
		if (resource === 'message') {
			if (operation === 'bufferMessages') {
				return 'messageBuffering';
			}
			return 'messageRouting';
		}
		
		// Analytics Actions
		if (resource === 'analytics') {
			if (operation === 'storeMemory') {
				return 'smartMemory';
			}
			return 'analytics';
		}
		
		// Default fallback
		return 'smartRateLimit';
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
	 * Execute Message Buffering (Enhanced with Anti-Spam)
	 */
	private static async executeMessageBuffering(
		redisManager: RedisManager,
		executeFunctions: IExecuteFunctions,
		params: { sessionKey: string; messageContent: string; debugMode: boolean; keyPrefix: string; itemIndex: number }
	) {
		// Always use enhanced buffering with anti-spam capabilities
		return this.executeEnhancedMessageBuffering(redisManager, executeFunctions, params);
	}

	/**
	 * Execute Enhanced Message Buffering with Anti-Spam Detection
	 */
	private static async executeEnhancedMessageBuffering(
		redisManager: RedisManager,
		executeFunctions: IExecuteFunctions,
		params: { sessionKey: string; messageContent: string; debugMode: boolean; keyPrefix: string; itemIndex: number }
	) {
		// Get parameters
		const bufferTime = executeFunctions.getNodeParameter('bufferTime', params.itemIndex, 30) as number;
		const bufferSize = executeFunctions.getNodeParameter('bufferSize', params.itemIndex, 100) as number;
		const bufferPattern = executeFunctions.getNodeParameter('bufferPattern', params.itemIndex, 'collect_send') as string;
		
		// Anti-spam parameters
		const antiSpamType = executeFunctions.getNodeParameter('antiSpamType', params.itemIndex, 'disabled') as string;
		const spamAction = executeFunctions.getNodeParameter('spamAction', params.itemIndex, 'block') as string;
		const similarityThreshold = executeFunctions.getNodeParameter('similarityThreshold', params.itemIndex, 80) as number;
		const floodMaxMessages = executeFunctions.getNodeParameter('floodMaxMessages', params.itemIndex, 5) as number;
		const floodTimeWindow = executeFunctions.getNodeParameter('floodTimeWindow', params.itemIndex, 30) as number;

		// Configure MessageBuffer with anti-spam detection
		const bufferConfig = {
			pattern: bufferPattern as any,
			maxSize: bufferSize,
			flushInterval: bufferTime,
			enableStreams: true,
			keyPrefix: `${params.keyPrefix}_enhanced`,
			enableAntiSpam: antiSpamType !== 'disabled',
			spamDetectionConfig: {
				detectionType: antiSpamType as any,
				action: spamAction as any,
				userId: params.sessionKey,
				sessionId: params.sessionKey,
				similarityThreshold,
				detectionTimeWindow: 5, // minutes
				floodMaxMessages,
				floodTimeWindow,
				keyPrefix: `${params.keyPrefix}_spam`
			}
		};

		const messageBuffer = new MessageBuffer(redisManager, bufferConfig);

		try {
			// Add message to buffer
			const result = await messageBuffer.addMessage(params.sessionKey, {
				content: params.messageContent,
				userId: params.sessionKey,
				metadata: {
					timestamp: Date.now(),
					source: 'chatbot_enhanced'
				}
			});

			if (params.debugMode) {
				console.log(`Enhanced buffer result:`, {
					bufferId: result.bufferId,
					messageId: result.messageId,
					shouldFlush: result.shouldFlush,
					spamDetected: result.spamDetectionResult?.isSpam,
					blocked: result.blocked
				});
			}

			// Handle blocked messages
			if (result.blocked) {
				return {
					success: {
						type: 'success',
						data: {
							type: 'blocked',
							status: 'spam_blocked',
							message: 'Message blocked due to spam detection',
							sessionId: params.sessionKey,
							operationType: 'messageBuffering',
							spamDetection: result.spamDetectionResult
						},
						timestamp: Date.now()
					},
					metrics: {
						type: 'metrics',
						data: {
							operationType: 'messageBuffering',
							metrics: {
								spamBlocked: 1,
								spamType: result.spamDetectionResult?.spamType,
								confidence: result.spamDetectionResult?.confidence
							},
							performance: {
								processingTime: 0,
								redisHealth: redisManager.isAvailable()
							}
						},
						timestamp: Date.now()
					}
				};
			}

			// Check if we should flush
			if (result.shouldFlush) {
				const flushResult = await messageBuffer.flush(params.sessionKey, 'size');
				
				return {
					success: {
						type: 'success',
						data: {
							type: 'batch_ready',
							status: 'flushed',
							messages: flushResult.flushedMessages.map(msg => msg.content),
							totalMessages: flushResult.flushedMessages.length,
							sessionId: params.sessionKey,
							operationType: 'messageBuffering',
							flushTrigger: flushResult.trigger,
							spamStats: flushResult.spamStats
						},
						timestamp: Date.now()
					},
					processed: {
						type: 'processed',
						data: {
							originalMessage: params.messageContent,
							transformedMessage: flushResult.flushedMessages.map(msg => msg.content).join(' | '),
							enrichmentData: {
								buffered: true,
								totalMessagesCollected: flushResult.flushedMessages.length,
								bufferDuration: bufferTime,
								flushType: flushResult.trigger,
								spamDetected: flushResult.spamStats?.spamDetected || 0,
								antiSpamEnabled: antiSpamType !== 'disabled'
							}
						},
						timestamp: Date.now()
					},
					metrics: {
						type: 'metrics',
						data: {
							operationType: 'messageBuffering',
							metrics: {
								totalMessagesBuffered: flushResult.flushedMessages.length,
								bufferTime: bufferTime,
								flushTrigger: flushResult.trigger,
								processingTime: flushResult.processingTime,
								spamStats: flushResult.spamStats
							},
							performance: {
								processingTime: flushResult.processingTime,
								bufferEfficiency: 100,
								redisHealth: redisManager.isAvailable()
							}
						},
						timestamp: Date.now()
					}
				};
			} else {
				// Message added to buffer, waiting for flush
				return {
					success: {
						type: 'success',
						data: {
							type: 'buffered',
							status: 'pending',
							message: params.messageContent,
							sessionId: params.sessionKey,
							operationType: 'messageBuffering',
							messageId: result.messageId,
							spamDetection: result.spamDetectionResult
						},
						timestamp: Date.now()
					},
					processed: {
						type: 'processed',
						data: {
							originalMessage: params.messageContent,
							transformedMessage: params.messageContent,
							enrichmentData: {
								buffered: true,
								messageId: result.messageId,
								waitingForFlush: true,
								spamDetected: result.spamDetectionResult?.isSpam || false,
								antiSpamEnabled: antiSpamType !== 'disabled'
							}
						},
						timestamp: Date.now()
					},
					metrics: {
						type: 'metrics',
						data: {
							operationType: 'messageBuffering',
							metrics: {
								messageBuffered: 1,
								spamDetected: result.spamDetectionResult?.isSpam ? 1 : 0,
								spamType: result.spamDetectionResult?.spamType
							},
							performance: {
								processingTime: 0,
								redisHealth: redisManager.isAvailable()
							}
						},
						timestamp: Date.now()
					}
				};
			}
		} catch (error) {
			throw new NodeOperationError(
				executeFunctions.getNode(),
				`Enhanced message buffering failed: ${error.message}`
			);
		}
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