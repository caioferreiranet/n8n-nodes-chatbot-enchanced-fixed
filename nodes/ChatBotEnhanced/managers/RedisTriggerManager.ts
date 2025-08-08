import { createClient, RedisClientType } from 'redis';
import { RedisManager, RedisConnectionConfig } from './RedisManager';
import { RedisCredential } from '../types';
import { EventProcessor } from '../trigger-utils';

export interface RedisTriggerConfig extends RedisConnectionConfig {
	reconnectAttempts: number;
	rateLimitEnabled: boolean;
	maxEventsPerSecond: number;
	includeMetadata: boolean;
}

export interface RedisEventData {
	eventType: string;
	key: string;
	value?: string;
	database: number;
	timestamp: number;
}

export type EventCallback = (eventData: RedisEventData) => void;

/**
 * Redis Trigger Manager - Extends RedisManager patterns for trigger functionality
 * Handles KEYSPACE notifications, pub/sub connections, and event processing
 */
export class RedisTriggerManager extends RedisManager {
	private subscriberClient: RedisClientType | null = null;
	private monitoringActive: boolean = false;
	private eventCallback: EventCallback | null = null;
	private rateLimiter: TokenBucket | null = null;
	private reconnectAttempts: number = 5;
	private currentReconnectAttempt: number = 0;
	private config: RedisTriggerConfig;
	private eventProcessor: EventProcessor | null = null;
	
	// Simple value cache for DEL events - stores last known values
	private valueCache: Map<string, { value: string; timestamp: number }> = new Map();
	private readonly CACHE_TTL_MS = 60000; // 1 minute cache TTL

	constructor(
		credentials: RedisCredential,
		config: Partial<RedisTriggerConfig> = {}
	) {
		super(credentials, config);
		
		this.config = {
			connectionTimeout: 5000,
			reconnectAttempts: 5,
			rateLimitEnabled: true,
			maxEventsPerSecond: 100,
			includeMetadata: true,
			...config,
		};

		this.reconnectAttempts = this.config.reconnectAttempts;

		// Initialize rate limiter if enabled
		if (this.config.rateLimitEnabled) {
			this.rateLimiter = new TokenBucket(this.config.maxEventsPerSecond);
		}
	}

	/**
	 * Create dedicated subscriber client for pub/sub operations
	 */
	private createSubscriberClient(): RedisClientType {
		const config: any = {
			database: this.credentials.database,
			username: this.credentials.user || undefined,
			password: this.credentials.password || undefined,
		};

		if (this.credentials.ssl) {
			config.socket = {
				host: this.credentials.host,
				port: this.credentials.port,
				tls: true,
			};
		} else {
			config.socket = {
				host: this.credentials.host,
				port: this.credentials.port,
			};
		}

		const client = createClient(config);

		// Set up error handling and reconnection
		client.on('error', (error) => {
			
			if (this.monitoringActive) {
				this.handleReconnection();
			}
		});

		client.on('connect', () => {
			
			this.currentReconnectAttempt = 0;
		});

		client.on('ready', () => {
			
		});

		client.on('end', () => {
			
			if (this.monitoringActive) {
				this.handleReconnection();
			}
		});

		return client as any;
	}

	/**
	 * Configure Redis KEYSPACE notifications
	 */
	private async configureKeyspaceNotifications(): Promise<void> {
		const client = this.getClient();
		
		try {
			// Connect if not already connected
			if (!client.isOpen) {
				await client.connect();
			}

			// Set keyspace notifications configuration
			// KEA = Keyspace events for all keys + Expired events + Evicted events
			await client.configSet('notify-keyspace-events', 'KEA');
			

		} catch (error) {
			throw new Error(`Failed to configure keyspace notifications: ${error instanceof Error ? error.message : 'Unknown error'}`);
		}
	}

	/**
	 * Start monitoring Redis key changes
	 */
	async startMonitoring(keyPattern: string, eventTypes: string[], callback: EventCallback): Promise<void> {
		if (this.monitoringActive) {
			throw new Error('Monitoring is already active');
		}

		this.eventCallback = callback;
		this.monitoringActive = true;

		try {
			// Initialize event processor
			this.eventProcessor = new EventProcessor(keyPattern, 1000);

			// Configure keyspace notifications
			await this.configureKeyspaceNotifications();

			// Create and connect subscriber client
			this.subscriberClient = this.createSubscriberClient();
			await this.subscriberClient.connect();

			// Generate subscription patterns
			const subscriptionPatterns = this.generateSubscriptionPatterns(keyPattern, eventTypes);

			// Set up message handler  
			// NOTE: Redis pSubscribe callback has parameters (message, channel) - NOT (channel, message)!
			const handleMessage = async (message: string, channel: string) => {
				if (!this.monitoringActive) return;

				

				try {
					// Apply rate limiting if enabled
					if (this.rateLimiter && !this.rateLimiter.consume()) {
						
						return;
					}

					// Parse the event - now with correct parameters
					const eventData = this.parseRedisEvent(channel, message);
					
					// Filter by event types selected by user  
					if (!eventTypes.includes(eventData.eventType)) {
						
						return;
					}
					
					// Handle value retrieval based on event type
					if (eventData.eventType === 'set') {
						// For SET events: get current value and cache it
						try {
							const client = this.getClient();
							const value = await client.get(eventData.key);
							eventData.value = value || undefined;
							
							// Cache the value for potential future DEL events
							if (value) {
								this.valueCache.set(eventData.key, {
									value: value,
									timestamp: Date.now()
								});
							}
						} catch (error) {
							
						}
					} else if (eventData.eventType === 'del') {
						// For DEL events: try to get cached value
						const cached = this.valueCache.get(eventData.key);
						if (cached && (Date.now() - cached.timestamp) < this.CACHE_TTL_MS) {
							eventData.value = cached.value;
							
						}
						// Clean up cache entry
						this.valueCache.delete(eventData.key);
					}
					
					
					
					// Process event using EventProcessor
					const processedEvent = this.eventProcessor?.processEvent(eventData);
					
					
					if (processedEvent) {
						// Invoke callback with processed event data
						if (this.eventCallback) {
							
							this.eventCallback({
								...processedEvent,
								value: processedEvent.value
							});
						} else {
							
						}
					} else {
						
					}
				} catch (error) {
					
				}
			};

			// Subscribe to patterns
			for (const pattern of subscriptionPatterns) {
				await this.subscriberClient.pSubscribe(pattern, handleMessage);
				
			}

			

		} catch (error) {
			this.monitoringActive = false;
			await this.cleanup();
			throw new Error(`Failed to start monitoring: ${error instanceof Error ? error.message : 'Unknown error'}`);
		}
	}

	/**
	 * Stop monitoring Redis key changes
	 */
	async stopMonitoring(): Promise<void> {
		if (!this.monitoringActive) {
			return;
		}

		this.monitoringActive = false;
		this.eventCallback = null;

		try {
			if (this.subscriberClient && this.subscriberClient.isOpen) {
				await this.subscriberClient.pUnsubscribe();
				
			}
		} catch (error) {
			
		}
	}

	/**
	 * Generate Redis subscription patterns based on key pattern and event types
	 */
	private generateSubscriptionPatterns(keyPattern: string, eventTypes: string[]): string[] {
		const database = this.credentials.database;
		const patterns: string[] = [];

		// Use only keyspace notifications to prevent duplicates
		// Keyspace notifications: channel = __keyspace@DB__:KEY, message = EVENT
		patterns.push(`__keyspace@${database}__:${keyPattern}`);

		return patterns;
	}


	/**
	 * Parse Redis keyspace notification into structured event data
	 */
	private parseRedisEvent(channel: string, message: string): RedisEventData {
		const database = this.credentials.database;
		
		// Parse channel to extract database and key/event info
		if (channel.startsWith(`__keyspace@${database}__:`)) {
			// Keyspace notification: channel contains key, message contains event
			const key = channel.substring(`__keyspace@${database}__:`.length);
			return {
				eventType: message,
				key,
				database,
				timestamp: Date.now(),
			};
		} else if (channel.startsWith(`__keyevent@${database}__:`)) {
			// Keyevent notification: channel contains event, message contains key
			const eventType = channel.substring(`__keyevent@${database}__:`.length);
			return {
				eventType,
				key: message,
				database,
				timestamp: Date.now(),
			};
		}

		// Fallback
		return {
			eventType: 'unknown',
			key: message,
			database,
			timestamp: Date.now(),
		};
	}


	/**
	 * Handle reconnection logic
	 */
	private async handleReconnection(): Promise<void> {
		if (!this.monitoringActive || this.currentReconnectAttempt >= this.reconnectAttempts) {
			
			this.monitoringActive = false;
			return;
		}

		this.currentReconnectAttempt++;
		const backoffDelay = Math.min(1000 * Math.pow(2, this.currentReconnectAttempt - 1), 30000);

		

		setTimeout(async () => {
			try {
				if (this.subscriberClient) {
					await this.subscriberClient.connect();
				}
			} catch (error) {
				
				this.handleReconnection();
			}
		}, backoffDelay);
	}

	/**
	 * Clean up connections and resources
	 */
	async cleanup(): Promise<void> {
		await this.stopMonitoring();
		
		// Clear value cache
		this.valueCache.clear();

		// Clean up subscriber client
		if (this.subscriberClient) {
			try {
				if (this.subscriberClient.isOpen) {
					await this.subscriberClient.quit();
				}
			} catch (error) {
				
				try {
					await this.subscriberClient.disconnect();
				} catch (disconnectError) {
					
				}
			} finally {
				this.subscriberClient = null;
			}
		}

		// Clean up parent Redis connection
		await super.cleanup();
	}

	/**
	 * Check if monitoring is currently active
	 */
	isMonitoring(): boolean {
		return this.monitoringActive;
	}

	/**
	 * Get current monitoring status and connection health
	 */
	getStatus(): {
		monitoring: boolean;
		connected: boolean;
		subscriberConnected: boolean;
		reconnectAttempts: number;
		rateLimitEnabled: boolean;
		eventProcessorMetrics?: ReturnType<EventProcessor['getStatusReport']>;
	} {
		return {
			monitoring: this.monitoringActive,
			connected: this.isAvailable(),
			subscriberConnected: this.subscriberClient?.isReady || false,
			reconnectAttempts: this.currentReconnectAttempt,
			rateLimitEnabled: this.config.rateLimitEnabled,
			eventProcessorMetrics: this.eventProcessor?.getStatusReport(),
		};
	}
}

/**
 * Token Bucket implementation for rate limiting
 */
class TokenBucket {
	private tokens: number;
	private maxTokens: number;
	private refillRate: number;
	private lastRefill: number;

	constructor(tokensPerSecond: number) {
		this.maxTokens = tokensPerSecond;
		this.tokens = tokensPerSecond;
		this.refillRate = tokensPerSecond;
		this.lastRefill = Date.now();
	}

	/**
	 * Try to consume a token
	 */
	consume(): boolean {
		this.refill();
		
		if (this.tokens >= 1) {
			this.tokens--;
			return true;
		}
		
		return false;
	}

	/**
	 * Refill tokens based on elapsed time
	 */
	private refill(): void {
		const now = Date.now();
		const elapsed = (now - this.lastRefill) / 1000;
		
		this.tokens = Math.min(
			this.maxTokens,
			this.tokens + (elapsed * this.refillRate)
		);
		
		this.lastRefill = now;
	}
}