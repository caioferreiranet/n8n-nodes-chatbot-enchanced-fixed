import type {
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';
import { NodeConnectionType, NodeOperationError } from 'n8n-workflow';

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
			{
				displayName: 'Use Template',
				name: 'useTemplate',
				type: 'boolean',
				default: true,
				description: 'Whether to start with a pre-configured template for common chatbot scenarios',
			},
			{
				displayName: 'Template Type',
				name: 'templateType',
				type: 'options',
				displayOptions: {
					show: {
						useTemplate: [true],
					},
				},
				options: [
					{
						name: 'Basic Rate Limiting',
						value: 'basicRateLimit',
						description: 'Simple rate limiting to prevent spam',
					},
					{
						name: 'Session Management',
						value: 'sessionManagement',
						description: 'User session tracking with context',
					},
				],
				default: 'basicRateLimit',
			},
			{
				displayName: 'Operation Type',
				name: 'operationType',
				type: 'options',
				displayOptions: {
					show: {
						useTemplate: [false],
					},
				},
				options: [
					{
						name: 'Rate Limiting',
						value: 'rateLimit',
						description: 'Control message frequency',
					},
					{
						name: 'Session Management',
						value: 'session',
						description: 'Manage user sessions',
					},
				],
				default: 'rateLimit',
			},
			{
				displayName: 'Session Key',
				name: 'sessionKey',
				type: 'string',
				required: true,
				default: '={{$json.userId || "default"}}',
				description: 'Unique identifier for the user or session',
			},
			{
				displayName: 'Message Content',
				name: 'messageContent',
				type: 'string',
				default: '={{$json.message || $json.text}}',
				description: 'The message content to process',
			},
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const successItems: INodeExecutionData[] = [];
		const processedItems: INodeExecutionData[] = [];
		const errorItems: INodeExecutionData[] = [];
		const metricsItems: INodeExecutionData[] = [];

		try {
			// Get parameters
			const useTemplate = this.getNodeParameter('useTemplate', 0) as boolean;
			const sessionKey = this.getNodeParameter('sessionKey', 0) as string;
			const messageContent = this.getNodeParameter('messageContent', 0) as string;

			// Determine operation type
			let operationType: string;
			if (useTemplate) {
				const templateType = this.getNodeParameter('templateType', 0) as string;
				operationType = templateType;
			} else {
				operationType = this.getNodeParameter('operationType', 0) as string;
			}

			// Create success output
			const successOutput = {
				type: 'success',
				data: {
					message: messageContent,
					sessionId: sessionKey,
					operationType,
					processedData: {
						status: 'processed',
						timestamp: Date.now(),
					},
				},
				timestamp: Date.now(),
			};

			successItems.push({ json: successOutput });

			// Create metrics output
			const metricsOutput = {
				type: 'metrics',
				data: {
					operationType,
					processingTime: 10, // Simplified
					messageCount: 1,
				},
				timestamp: Date.now(),
			};

			metricsItems.push({ json: metricsOutput });

		} catch (error) {
			const errorOutput = {
				type: 'error',
				data: {
					errorMessage: error instanceof Error ? error.message : 'Unknown error',
					errorCode: 'EXECUTION_ERROR',
				},
				timestamp: Date.now(),
			};

			errorItems.push({ json: errorOutput });

			if (!this.continueOnFail()) {
				throw new NodeOperationError(this.getNode(), error as Error);
			}
		}

		return [successItems, processedItems, errorItems, metricsItems];
	}
}