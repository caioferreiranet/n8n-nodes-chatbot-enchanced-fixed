// Removed unused import
import { NodeOperationError } from 'n8n-workflow';
import { RedisManager } from './RedisManager';

export type RoutingPattern = 'one_to_many' | 'many_to_one' | 'load_balance' | 'topic_based';

export interface RouterConfig {
	pattern: RoutingPattern;
	channels: string[];
	routingRules?: RoutingRule[];
	enablePatternMatching: boolean;
	keyPrefix?: string;
	retryAttempts?: number;
	retryDelay?: number; // in milliseconds
}

export interface RoutingRule {
	name: string;
	condition: string; // Pattern or condition to match
	targetChannel: string;
	priority: number;
	enabled: boolean;
}

export interface MessageRoute {
	messageId: string;
	content: string;
	sourceChannel: string;
	targetChannels: string[];
	timestamp: number;
	metadata?: Record<string, any>;
	routingRule?: string;
}

export interface RoutingResult {
	messageId: string;
	delivered: string[];
	failed: string[];
	processingTime: number;
	routingRule?: string;
}

export interface RouterStats {
	totalMessages: number;
	totalChannels: number;
	messagesPerChannel: Record<string, number>;
	failureRate: number;
	averageProcessingTime: number;
}

export class MessageRouter {
	private redisManager: RedisManager;
	private config: RouterConfig;
	private keyPrefix: string;
	private subscribers: Map<string, any> = new Map();
	private isRunning: boolean = false;

	constructor(redisManager: RedisManager, config: Partial<RouterConfig> = {}) {
		this.redisManager = redisManager;
		this.config = {
			pattern: 'one_to_many',
			channels: [],
			enablePatternMatching: true,
			keyPrefix: 'router',
			retryAttempts: 3,
			retryDelay: 1000,
			...config,
		};
		this.keyPrefix = this.config.keyPrefix!;
	}

	/**
	 * Route a message to appropriate channels
	 */
	async routeMessage(message: {
		content: string;
		sourceChannel?: string;
		metadata?: Record<string, any>;
	}): Promise<RoutingResult> {
		const messageId = this.generateMessageId();
		const startTime = Date.now();

		try {
			const targetChannels = await this.determineTargetChannels(
				message.content,
				message.sourceChannel,
				message.metadata
			);

			const route: MessageRoute = {
				messageId,
				content: message.content,
				sourceChannel: message.sourceChannel || 'default',
				targetChannels,
				timestamp: startTime,
				metadata: message.metadata,
			};

			const deliveryResults = await this.deliverMessage(route);

			// Log routing event
			await this.logRoutingEvent(route, deliveryResults);

			return {
				messageId,
				delivered: deliveryResults.delivered,
				failed: deliveryResults.failed,
				processingTime: Date.now() - startTime,
				routingRule: route.routingRule,
			};

		} catch (error) {
			throw new NodeOperationError(
				null as any,
				`Message routing failed: ${error instanceof Error ? error.message : 'Unknown error'}`
			);
		}
	}

	/**
	 * Subscribe to a channel for incoming messages
	 */
	async subscribe(
		channel: string,
		callback: (message: string, channel: string) => void
	): Promise<void> {
		return this.redisManager.executeOperation(async (client) => {
			// Create subscriber client (Redis pub/sub requires separate connection)
			const subscriber = client.duplicate();
			await subscriber.connect();

			await subscriber.subscribe(
				this.generateChannelKey(channel),
				(message, channelKey) => {
					const originalChannel = this.extractChannelFromKey(channelKey);
					callback(message, originalChannel);
				}
			);

			this.subscribers.set(channel, subscriber);
		});
	}

	/**
	 * Unsubscribe from a channel
	 */
	async unsubscribe(channel: string): Promise<void> {
		const subscriber = this.subscribers.get(channel);
		if (subscriber) {
			await subscriber.unsubscribe(this.generateChannelKey(channel));
			await subscriber.quit();
			this.subscribers.delete(channel);
		}
	}

	/**
	 * Publish message to a specific channel
	 */
	async publish(channel: string, message: string): Promise<number> {
		return this.redisManager.executeOperation(async (client) => {
			const channelKey = this.generateChannelKey(channel);
			return client.publish(channelKey, message);
		});
	}

	/**
	 * Start the router (for continuous processing)
	 */
	async start(): Promise<void> {
		if (this.isRunning) {
			return;
		}

		this.isRunning = true;

		// Subscribe to input channels based on pattern
		if (this.config.pattern === 'many_to_one') {
			for (const channel of this.config.channels) {
				await this.subscribe(channel, async (message, sourceChannel) => {
					await this.handleIncomingMessage(message, sourceChannel);
				});
			}
		}
	}

	/**
	 * Stop the router
	 */
	async stop(): Promise<void> {
		this.isRunning = false;

		// Unsubscribe from all channels
		for (const channel of this.subscribers.keys()) {
			await this.unsubscribe(channel);
		}
	}

	/**
	 * Get routing statistics
	 */
	async getStats(): Promise<RouterStats> {
		return this.redisManager.executeOperation(async (client) => {
			const statsKey = `${this.keyPrefix}:stats`;
			const statsData = await client.hGetAll(statsKey);

			const messagesPerChannel: Record<string, number> = {};
			let totalMessages = 0;
			let totalFailures = 0;
			let totalProcessingTime = 0;

			// Parse channel-specific stats
			for (const [key, value] of Object.entries(statsData)) {
				if (key.startsWith('channel:')) {
					const channel = key.replace('channel:', '');
					messagesPerChannel[channel] = parseInt(value) || 0;
					totalMessages += messagesPerChannel[channel];
				} else if (key === 'failures') {
					totalFailures = parseInt(value) || 0;
				} else if (key === 'processing_time') {
					totalProcessingTime = parseInt(value) || 0;
				}
			}

			return {
				totalMessages,
				totalChannels: this.config.channels.length,
				messagesPerChannel,
				failureRate: totalMessages > 0 ? totalFailures / totalMessages : 0,
				averageProcessingTime: totalMessages > 0 ? totalProcessingTime / totalMessages : 0,
			};
		});
	}

	/**
	 * Add or update routing rule
	 */
	async addRoutingRule(rule: RoutingRule): Promise<void> {
		return this.redisManager.executeOperation(async (client) => {
			const rulesKey = `${this.keyPrefix}:rules`;
			await client.hSet(rulesKey, rule.name, JSON.stringify(rule));
		});
	}

	/**
	 * Remove routing rule
	 */
	async removeRoutingRule(ruleName: string): Promise<void> {
		return this.redisManager.executeOperation(async (client) => {
			const rulesKey = `${this.keyPrefix}:rules`;
			await client.hDel(rulesKey, ruleName);
		});
	}

	/**
	 * Get all routing rules
	 */
	async getRoutingRules(): Promise<RoutingRule[]> {
		return this.redisManager.executeOperation(async (client) => {
			const rulesKey = `${this.keyPrefix}:rules`;
			const rulesData = await client.hGetAll(rulesKey);

			const rules: RoutingRule[] = [];
			for (const ruleJson of Object.values(rulesData)) {
				try {
					const rule = JSON.parse(ruleJson);
					rules.push(rule);
				} catch (error) {
					
				}
			}

			return rules.sort((a, b) => b.priority - a.priority);
		});
	}

	/**
	 * Determine target channels based on routing pattern and rules
	 */
	private async determineTargetChannels(
		content: string,
		sourceChannel?: string,
		metadata?: Record<string, any>
	): Promise<string[]> {
		switch (this.config.pattern) {
			case 'one_to_many':
				return this.config.channels;

			case 'many_to_one':
				return [this.config.channels[0] || 'default'];

			case 'load_balance':
				return [this.selectChannelByLoad()];

			case 'topic_based':
				return this.selectChannelsByTopic(content, metadata);

			default:
				return this.config.channels;
		}
	}

	/**
	 * Select channel based on current load (round-robin for simplicity)
	 */
	private selectChannelByLoad(): string {
		if (this.config.channels.length === 0) {
			return 'default';
		}

		// Simple round-robin for now
		// In a real implementation, you'd check actual load metrics
		const index = Date.now() % this.config.channels.length;
		return this.config.channels[index];
	}

	/**
	 * Select channels based on topic/content matching
	 */
	private async selectChannelsByTopic(
		content: string,
		metadata?: Record<string, any>
	): Promise<string[]> {
		const rules = await this.getRoutingRules();
		const matchedChannels: string[] = [];

		for (const rule of rules) {
			if (!rule.enabled) continue;

			if (this.matchesRule(content, rule, metadata)) {
				matchedChannels.push(rule.targetChannel);
			}
		}

		// If no rules match, use default channels
		return matchedChannels.length > 0 ? matchedChannels : this.config.channels;
	}

	/**
	 * Check if content matches a routing rule
	 */
	private matchesRule(
		content: string,
		rule: RoutingRule,
		metadata?: Record<string, any>
	): boolean {
		try {
			// Simple pattern matching for now
			// In a real implementation, you might use more sophisticated matching
			const condition = rule.condition.toLowerCase();
			const contentLower = content.toLowerCase();

			// Support basic patterns
			if (condition.startsWith('contains:')) {
				const pattern = condition.replace('contains:', '').trim();
				return contentLower.includes(pattern);
			}

			if (condition.startsWith('starts_with:')) {
				const pattern = condition.replace('starts_with:', '').trim();
				return contentLower.startsWith(pattern);
			}

			if (condition.startsWith('ends_with:')) {
				const pattern = condition.replace('ends_with:', '').trim();
				return contentLower.endsWith(pattern);
			}

			if (condition.startsWith('regex:')) {
				const pattern = condition.replace('regex:', '').trim();
				const regex = new RegExp(pattern, 'i');
				return regex.test(content);
			}

			// Check metadata conditions
			if (condition.startsWith('metadata:') && metadata) {
				const metaCondition = condition.replace('metadata:', '').trim();
				const [key, value] = metaCondition.split('=');
				return metadata[key?.trim()] === value?.trim();
			}

			// Default: exact match
			return contentLower === condition;

		} catch (error) {
			
			return false;
		}
	}

	/**
	 * Deliver message to target channels
	 */
	private async deliverMessage(route: MessageRoute): Promise<{
		delivered: string[];
		failed: string[];
	}> {
		const delivered: string[] = [];
		const failed: string[] = [];

		for (const channel of route.targetChannels) {
			let attempts = 0;
			let success = false;

			while (attempts < (this.config.retryAttempts || 3) && !success) {
				try {
					const subscribers = await this.publish(channel, JSON.stringify({
						messageId: route.messageId,
						content: route.content,
						sourceChannel: route.sourceChannel,
						timestamp: route.timestamp,
						metadata: route.metadata,
					}));

					if (subscribers > 0) {
						delivered.push(channel);
						success = true;
					} else {
						// No subscribers, but message was published successfully
						delivered.push(channel);
						success = true;
					}

				} catch (error) {
					attempts++;
					if (attempts < (this.config.retryAttempts || 3)) {
						await new Promise(resolve => 
							setTimeout(resolve, this.config.retryDelay || 1000)
						);
					} else {
						failed.push(channel);
						
					}
				}
			}
		}

		return { delivered, failed };
	}

	/**
	 * Handle incoming message (for many-to-one pattern)
	 */
	private async handleIncomingMessage(message: string, sourceChannel: string): Promise<void> {
		try {
			const parsedMessage = JSON.parse(message);
			
			// Route to output channel(s)
			await this.routeMessage({
				content: parsedMessage.content || message,
				sourceChannel,
				metadata: {
					...parsedMessage.metadata,
					routedAt: Date.now(),
				},
			});

		} catch (error) {
			
		}
	}

	/**
	 * Log routing event for analytics
	 */
	private async logRoutingEvent(
		route: MessageRoute,
		results: { delivered: string[]; failed: string[] }
	): Promise<void> {
		return this.redisManager.executeOperation(async (client) => {
			const statsKey = `${this.keyPrefix}:stats`;
			const pipeline = client.multi();

			// Update channel-specific stats
			for (const channel of results.delivered) {
				pipeline.hIncrBy(statsKey, `channel:${channel}`, 1);
			}

			// Update failure stats
			const failedCount = results.failed?.length || 0;
			if (failedCount > 0) {
				pipeline.hIncrBy(statsKey, 'failures', failedCount);
			}

			// Update processing time stats
			const processingTime = Math.max(0, Date.now() - route.timestamp);
			pipeline.hIncrBy(statsKey, 'processing_time', Math.floor(processingTime));

			await pipeline.exec();
		});
	}

	/**
	 * Generate unique message ID
	 */
	private generateMessageId(): string {
		return `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
	}

	/**
	 * Generate Redis channel key
	 */
	private generateChannelKey(channel: string): string {
		return `${this.keyPrefix}:channel:${channel}`;
	}

	/**
	 * Extract channel name from Redis key
	 */
	private extractChannelFromKey(channelKey: string): string {
		const prefix = `${this.keyPrefix}:channel:`;
		return channelKey.startsWith(prefix) ? channelKey.slice(prefix.length) : channelKey;
	}

	/**
	 * Get configuration
	 */
	getConfig(): RouterConfig {
		return { ...this.config };
	}

	/**
	 * Update configuration
	 */
	updateConfig(newConfig: Partial<RouterConfig>): void {
		this.config = { ...this.config, ...newConfig };
	}

	/**
	 * Check if router is running
	 */
	isActive(): boolean {
		return this.isRunning;
	}
}