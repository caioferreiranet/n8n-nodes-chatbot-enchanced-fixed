import type {
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';
import { NodeConnectionType, NodeOperationError } from 'n8n-workflow';

// Import managers
import { RedisManager } from './managers/RedisManager';

// Import types
import { RedisCredential, BufferState, BufferedMessage } from './types';

export class ChatBotEnhanced implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'ChatBot Enhanced',
		name: 'chatBotEnhanced',
		icon: 'file:chatbot-enhanced.svg',
		group: ['transform'],
		version: 1,
		subtitle: '={{$parameter["operation"] + ": " + $parameter["resource"]}}',
		description: 'Advanced chatbot functionality with smart rate limiting, message buffering, session management, and Redis integration for scalable conversation automation',
		codex: {
			categories: ['AI', 'Communication', 'Data & Storage'],
			subcategories: {
				'AI': ['Memory', 'Context Management', 'Conversation AI'],
				'Communication': ['Chatbots', 'Messaging', 'User Interaction'],
				'Data & Storage': ['Redis', 'Session Management', 'Cache']
			},
			resources: {
				primaryDocumentation: [
					{
						url: 'https://docs.n8n.io/integrations/community-nodes/'
					},
					{
						url: 'https://github.com/n8n-io/n8n/blob/master/packages/nodes-base/CONTRIBUTING.md'
					}
				],
				credentialDocumentation: [
					{
						url: 'https://redis.io/docs/getting-started/'
					},
					{
						url: 'https://redis.io/docs/manual/security/'
					}
				]
			},
			alias: [
				'chat bot', 'conversation bot', 'redis cache', 'rate limiter', 
				'spam filter', 'message queue', 'session store', 'conversation memory',
				'chatbot automation', 'messaging automation'
			]
		},
		defaults: {
			name: 'ChatBot Enhanced',
		},
		inputs: [NodeConnectionType.Main],
		outputs: [NodeConnectionType.Main, NodeConnectionType.Main, NodeConnectionType.Main],
		outputNames: ['Success', 'Spam', 'Process'],
		credentials: [
			{
				name: 'redis',
				required: true,
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
						name: 'Message',
						value: 'message',
						description: 'Message buffering and routing for human-like responses',
					},
				],
				default: 'message',
				description: 'Choose the category of operations you want to perform',
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



			// Common Parameters (hidden for connection test)
			{
				displayName: 'Session Key',
				name: 'sessionKey',
				type: 'string',
				required: true,
				default: '={{$json.userId || $json.sessionId || "test-connection"}}',
				description: 'Unique identifier for the user or session (can use expressions)',
			},
			{
				displayName: 'Message Content',
				name: 'messageContent',
				type: 'json',
				required: true,
				default: '{}',
				description: 'The message content as JSON object (can use expressions)',
				typeOptions: {
					alwaysOpenEditWindow: true,
				},
			},

			// Buffer Time Configuration - Message Buffering
			{
				displayName: 'Buffer Time (Seconds)',
				name: 'bufferTime',
				type: 'number',
				required: true,
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
				required: true,
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



			// Global Options
			{
				displayName: 'Redis Key Prefix',
				name: 'keyPrefix',
				type: 'string',
				required: true,
				default: 'chatbot',
				description: 'Prefix for Redis keys to avoid collisions',
			},
		],
	};


	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const successOutput: INodeExecutionData[] = [];
		const spamOutput: INodeExecutionData[] = [];
		const processOutput: INodeExecutionData[] = [];

		// Initialize Redis connection
		let redisManager: RedisManager | null = null;
		
		try {
			// Get Redis credentials
			const credentials = await this.getCredentials('redis') as RedisCredential;
			
			// Initialize Redis manager
			redisManager = new RedisManager(credentials, {
				connectionTimeout: 5000,
			});

			// Ensure Redis connection is established before proceeding
			const redisClient = redisManager.getClient();
			if (!redisClient.isOpen) {
				await redisClient.connect();
			}

			// Process only first item (TimedBuffer pattern)
			const itemIndex = 0;
			
			try {
				const sessionKey = this.getNodeParameter('sessionKey', itemIndex) as string;
				const messageContentJson = this.getNodeParameter('messageContent', itemIndex) as Record<string, unknown>;
				const messageContent = typeof messageContentJson === 'string' ? messageContentJson : JSON.stringify(messageContentJson);
				const keyPrefix = this.getNodeParameter('keyPrefix', itemIndex) as string;

				// Buffer configuration
				const bufferTime = this.getNodeParameter('bufferTime', itemIndex, 30) as number;
				const bufferSize = this.getNodeParameter('bufferSize', itemIndex, 100) as number;
				
				// Anti-spam parameters (will be used during buffer flush)
				const antiSpamType = this.getNodeParameter('antiSpamType', itemIndex, 'disabled') as string;

				// BufferKey with collision avoidance
				const { id } = this.getWorkflow();
				const bufferKey = `${keyPrefix}_buffer_${id}_${sessionKey}`;
				const waitAmount = bufferTime * 1000; // Convert to milliseconds

				// Get buffer state from Redis
				const getBufferState = async (): Promise<BufferState | null> => {
					try {
						const val = await redisManager!.read(bufferKey);
						if (!val) return null;
						return JSON.parse(val) as BufferState;
					} catch (error) {
						return null;
					}
				};

				// Setup cancellation handler
				this.onExecutionCancellation(async () => {
					await redisManager!.delete(bufferKey);
				});

				const existingBuffer = await getBufferState();
				const newMessage: BufferedMessage = {
					content: messageContent,
					userId: sessionKey,
					timestamp: Date.now(),
					metadata: items[itemIndex].json,
				};

				if (!existingBuffer) {
					// FIRST MESSAGE - Create buffer and wait
					const bufferState: BufferState = {
						exp: Date.now() + waitAmount,
						data: [newMessage],
						sessionId: sessionKey,
						totalCount: 1,
					};

					await redisManager!.write(bufferKey, JSON.stringify(bufferState));

					// Check if buffer size reached immediately
					if (bufferState.totalCount >= bufferSize) {
						// Size trigger - flush immediately
						const buffer = await getBufferState();
						
						// Analyze buffer for spam
						const spamAnalysis = await ChatBotEnhanced.analyzeBufferForSpam(
							this, redisManager!, buffer!, antiSpamType, itemIndex
						);
						
						// Send spam report if any spam detected
						if (spamAnalysis.spamDetected && spamAnalysis.spamMessages.length > 0) {
							spamOutput.push({
								json: {
									type: 'spam_analysis',
									totalMessages: buffer!.totalCount,
									spamMessages: spamAnalysis.spamMessages,
									cleanMessages: spamAnalysis.cleanMessages,
									spamCount: spamAnalysis.spamMessages.length,
									spamTypes: spamAnalysis.spamTypes,
									sessionId: sessionKey,
									timestamp: Date.now(),
								},
								pairedItem: { item: itemIndex },
							});
						}
						
						successOutput.push({
							json: {
								type: 'buffer_flush',
								messages: buffer!.data.map(msg => msg.content),
								totalMessages: buffer!.totalCount,
								trigger: 'size',
								spamAnalysis: {
									spamDetected: spamAnalysis.spamDetected,
									spamCount: spamAnalysis.spamMessages.length,
									cleanCount: spamAnalysis.cleanMessages.length,
								},
								sessionId: sessionKey,
								timestamp: Date.now(),
							},
							pairedItem: { item: itemIndex },
						});
						await redisManager!.delete(bufferKey);
						return [successOutput, spamOutput, processOutput];
					}

					// BLOCKING WAIT for timer (TimedBuffer pattern)
					let resume = false;
					while (!resume) {
						const refreshBuffer = await getBufferState();
						if (!refreshBuffer) {
							throw new NodeOperationError(this.getNode(), `Buffer state lost from Redis. Key: "${bufferKey}"`);
						}

						// Check if buffer size reached during wait
						if (refreshBuffer.totalCount >= bufferSize) {
							resume = true;
							break;
						}

						const remainingTime = Math.max(0, refreshBuffer.exp - Date.now());
						resume = remainingTime === 0;
						
						if (!resume) {
							await new Promise((resolve) => {
								const timer = setTimeout(resolve, Math.min(remainingTime, 1000)); // Check every 1s
								this.onExecutionCancellation(() => clearTimeout(timer));
							});
						}
					}

					// Timer completed or size reached - flush buffer
					const finalBuffer = await getBufferState();
					if (finalBuffer) {
						const trigger = finalBuffer.totalCount >= bufferSize ? 'size' : 'time';
						
						// Analyze buffer for spam BEFORE flushing
						const spamAnalysis = await ChatBotEnhanced.analyzeBufferForSpam(
							this, redisManager!, finalBuffer, antiSpamType, itemIndex
						);
						
						// Send spam report if any spam detected
						if (spamAnalysis.spamDetected && spamAnalysis.spamMessages.length > 0) {
							spamOutput.push({
								json: {
									type: 'spam_analysis',
									totalMessages: finalBuffer.totalCount,
									spamMessages: spamAnalysis.spamMessages,
									cleanMessages: spamAnalysis.cleanMessages,
									spamCount: spamAnalysis.spamMessages.length,
									spamTypes: spamAnalysis.spamTypes,
									sessionId: sessionKey,
									timestamp: Date.now(),
								},
								pairedItem: { item: itemIndex },
							});
						}
						
						// Always send buffer flush to Success (regardless of spam)
						successOutput.push({
							json: {
								type: 'buffer_flush',
								messages: finalBuffer.data.map(msg => msg.content),
								totalMessages: finalBuffer.totalCount,
								trigger,
								spamAnalysis: {
									spamDetected: spamAnalysis.spamDetected,
									spamCount: spamAnalysis.spamMessages.length,
									cleanCount: spamAnalysis.cleanMessages.length,
								},
								sessionId: sessionKey,
								timestamp: Date.now(),
							},
							pairedItem: { item: itemIndex },
						});
						await redisManager!.delete(bufferKey);
					}

				} else {
					// SUBSEQUENT MESSAGE - Add to existing buffer
					const updatedData = [...existingBuffer.data, newMessage];
					const bufferState: BufferState = {
						exp: Date.now() + waitAmount, // Reset timer
						data: updatedData,
						sessionId: sessionKey,
						totalCount: updatedData.length,
					};

					await redisManager!.write(bufferKey, JSON.stringify(bufferState));

					// Check if buffer size reached
					if (bufferState.totalCount >= bufferSize) {
						// Size trigger - flush immediately
						// Analyze buffer for spam
						const spamAnalysis = await ChatBotEnhanced.analyzeBufferForSpam(
							this, redisManager!, bufferState, antiSpamType, itemIndex
						);
						
						// Send spam report if any spam detected
						if (spamAnalysis.spamDetected && spamAnalysis.spamMessages.length > 0) {
							spamOutput.push({
								json: {
									type: 'spam_analysis',
									totalMessages: bufferState.totalCount,
									spamMessages: spamAnalysis.spamMessages,
									cleanMessages: spamAnalysis.cleanMessages,
									spamCount: spamAnalysis.spamMessages.length,
									spamTypes: spamAnalysis.spamTypes,
									sessionId: sessionKey,
									timestamp: Date.now(),
								},
								pairedItem: { item: itemIndex },
							});
						}
						
						successOutput.push({
							json: {
								type: 'buffer_flush',
								messages: bufferState.data.map(msg => msg.content),
								totalMessages: bufferState.totalCount,
								trigger: 'size',
								spamAnalysis: {
									spamDetected: spamAnalysis.spamDetected,
									spamCount: spamAnalysis.spamMessages.length,
									cleanCount: spamAnalysis.cleanMessages.length,
								},
								sessionId: sessionKey,
								timestamp: Date.now(),
							},
							pairedItem: { item: itemIndex },
						});
						await redisManager!.delete(bufferKey);
					} else {
						// Message added to buffer - return skipped (Process output)
						processOutput.push({
							json: {
								status: 'buffered',
								message: messageContent,
								sessionId: sessionKey,
								totalInBuffer: bufferState.totalCount,
								operationType: 'messageBuffering',
								timestamp: Date.now(),
							},
							pairedItem: { item: itemIndex },
						});
					}
				}

			} catch (itemError) {
				const errorOutput = {
					status: 'error',
					errorMessage: itemError instanceof Error ? itemError.message : 'Unknown error',
					sessionId: this.getNodeParameter('sessionKey', itemIndex) as string,
					operationType: 'messageBuffering',
					timestamp: Date.now(),
				};

				processOutput.push({
					json: errorOutput,
					pairedItem: { item: itemIndex },
				});

				if (!this.continueOnFail()) {
					throw new NodeOperationError(this.getNode(), itemError as Error);
				}
			}

		} catch (error) {
			const errorOutput = {
				status: 'error',
				errorMessage: error instanceof Error ? error.message : 'Unknown error',
				operationType: 'messageBuffering',
				sessionId: 'node_level_error',
				timestamp: Date.now(),
			};

			processOutput.push({
				json: errorOutput,
				pairedItem: { item: 0 },
			});

			if (!this.continueOnFail()) {
				throw new NodeOperationError(this.getNode(), error as Error);
			}
		} finally {
			// Clean up Redis connection
			if (redisManager) {
				await redisManager.cleanup();
			}
		}

		// Return 3 output arrays: Success, Spam, Process
		return [successOutput, spamOutput, processOutput];
	}

	/**
	 * Analyze buffer for spam patterns
	 */
	private static async analyzeBufferForSpam(
		executeFunctions: IExecuteFunctions,
		redisManager: RedisManager,
		bufferState: BufferState,
		antiSpamType: string,
		itemIndex: number
	): Promise<{
		spamDetected: boolean;
		spamMessages: Array<{ content: string; reason: string; confidence: number }>;
		cleanMessages: string[];
		spamTypes: string[];
	}> {
		const spamMessages: Array<{ content: string; reason: string; confidence: number }> = [];
		const cleanMessages: string[] = [];
		const spamTypes: string[] = [];

		if (antiSpamType === 'disabled') {
			return {
				spamDetected: false,
				spamMessages: [],
				cleanMessages: bufferState.data.map(msg => msg.content),
				spamTypes: [],
			};
		}

		// Analyze buffer for spam patterns
		switch (antiSpamType) {
			case 'repeated':
				const similarityThreshold = executeFunctions.getNodeParameter('similarityThreshold', itemIndex, 80) as number;
				const spamAnalysisResult = ChatBotEnhanced.analyzeRepeatedContent(bufferState.data, similarityThreshold);
				spamMessages.push(...spamAnalysisResult.spamMessages);
				cleanMessages.push(...spamAnalysisResult.cleanMessages);
				if (spamAnalysisResult.spamMessages.length > 0) {
					spamTypes.push('repeated_content');
				}
				break;
				
			case 'flood':
				// For flood protection, check if buffer size reached too quickly
				const bufferCreationTime = Math.min(...bufferState.data.map(msg => msg.timestamp));
				const bufferDuration = Date.now() - bufferCreationTime;
				const floodMaxMessages = executeFunctions.getNodeParameter('floodMaxMessages', itemIndex, 5) as number;
				const floodTimeWindow = executeFunctions.getNodeParameter('floodTimeWindow', itemIndex, 30) as number;
				
				if (bufferState.data.length >= floodMaxMessages && bufferDuration < (floodTimeWindow * 1000)) {
					// All messages are considered spam due to flooding
					for (const message of bufferState.data) {
						spamMessages.push({
							content: message.content,
							reason: 'flooding',
							confidence: 95,
						});
					}
					spamTypes.push('flooding');
				} else {
					cleanMessages.push(...bufferState.data.map(msg => msg.content));
				}
				break;
				
			case 'pattern':
				// Check each message for spam patterns
				for (const message of bufferState.data) {
					const hasSpamPattern = ChatBotEnhanced.checkSpamPatterns(message.content);
					if (hasSpamPattern.isSpam) {
						spamMessages.push({
							content: message.content,
							reason: hasSpamPattern.reason,
							confidence: 90,
						});
						if (!spamTypes.includes(hasSpamPattern.reason)) {
							spamTypes.push(hasSpamPattern.reason);
						}
					} else {
						cleanMessages.push(message.content);
					}
				}
				break;
		}

		return {
			spamDetected: spamMessages.length > 0,
			spamMessages,
			cleanMessages,
			spamTypes,
		};
	}

	/**
	 * Analyze repeated content within buffered messages
	 */
	private static analyzeRepeatedContent(
		messages: BufferedMessage[], 
		similarityThreshold: number
	): {
		spamMessages: Array<{ content: string; reason: string; confidence: number }>;
		cleanMessages: string[];
	} {
		const spamMessages: Array<{ content: string; reason: string; confidence: number }> = [];
		const cleanMessages: string[] = [];
		const processedMessages: Set<string> = new Set();

		for (let i = 0; i < messages.length; i++) {
			const currentMsg = messages[i];
			let isSpam = false;
			let maxSimilarity = 0;

			// Skip if already processed as spam
			if (processedMessages.has(currentMsg.content)) {
				continue;
			}

			// Compare with other messages in buffer
			for (let j = 0; j < messages.length; j++) {
				if (i === j) continue;
				
				const otherMsg = messages[j];
				const similarity = ChatBotEnhanced.calculateStringSimilarity(
					currentMsg.content, 
					otherMsg.content
				);

				if (similarity >= similarityThreshold) {
					maxSimilarity = Math.max(maxSimilarity, similarity);
					isSpam = true;
					
					// Mark both messages as spam (if not already processed)
					if (!processedMessages.has(otherMsg.content)) {
						spamMessages.push({
							content: otherMsg.content,
							reason: 'repeated_content',
							confidence: similarity,
						});
						processedMessages.add(otherMsg.content);
					}
				}
			}

			if (isSpam) {
				spamMessages.push({
					content: currentMsg.content,
					reason: 'repeated_content',
					confidence: maxSimilarity,
				});
				processedMessages.add(currentMsg.content);
			} else {
				cleanMessages.push(currentMsg.content);
			}
		}

		return { spamMessages, cleanMessages };
	}



	/**
	 * Check for spam patterns
	 */
	private static checkSpamPatterns(messageContent: string): { isSpam: boolean; reason: string } {
		// URL pattern
		const urlPattern = /(https?:\/\/[^\s]+)/gi;
		if (urlPattern.test(messageContent)) {
			return { isSpam: true, reason: 'contains_url' };
		}
		
		// Phone pattern
		const phonePattern = /(\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g;
		if (phonePattern.test(messageContent)) {
			return { isSpam: true, reason: 'contains_phone' };
		}
		
		// Email pattern
		const emailPattern = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
		if (emailPattern.test(messageContent)) {
			return { isSpam: true, reason: 'contains_email' };
		}
		
		return { isSpam: false, reason: '' };
	}

	/**
	 * Calculate string similarity (simple Levenshtein-based)
	 */
	private static calculateStringSimilarity(str1: string, str2: string): number {
		if (str1 === str2) return 100;
		if (str1.length === 0 || str2.length === 0) return 0;
		
		const longer = str1.length > str2.length ? str1 : str2;
		const shorter = str1.length > str2.length ? str2 : str1;
		
		if (longer.length === 0) return 100;
		
		const distance = ChatBotEnhanced.levenshteinDistance(longer, shorter);
		return Math.round(((longer.length - distance) / longer.length) * 100);
	}

	/**
	 * Calculate Levenshtein distance
	 */
	private static levenshteinDistance(str1: string, str2: string): number {
		const matrix = [];
		
		for (let i = 0; i <= str2.length; i++) {
			matrix[i] = [i];
		}
		
		for (let j = 0; j <= str1.length; j++) {
			matrix[0][j] = j;
		}
		
		for (let i = 1; i <= str2.length; i++) {
			for (let j = 1; j <= str1.length; j++) {
				if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
					matrix[i][j] = matrix[i - 1][j - 1];
				} else {
					matrix[i][j] = Math.min(
						matrix[i - 1][j - 1] + 1,
						matrix[i][j - 1] + 1,
						matrix[i - 1][j] + 1
					);
				}
			}
		}
		
		return matrix[str2.length][str1.length];
	}







}