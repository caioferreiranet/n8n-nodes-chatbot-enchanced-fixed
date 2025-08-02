import {
	TemplateDefinition,
	TemplateType,
	OperationType,
	OperationConfiguration,
	TemplateValidator,
	DeepPartial
} from '../types';

// Template Definitions
export const CHATBOT_TEMPLATES: Record<TemplateType, TemplateDefinition> = {
	basicRateLimit: {
		id: 'basicRateLimit',
		displayName: 'Basic Rate Limiting',
		description: 'Simple rate limiting to prevent spam and control message frequency',
		icon: 'shield',
		category: 'performance',
		difficulty: 'beginner',
		operations: ['smartRateLimit'],
		defaultConfiguration: {
			operationType: 'smartRateLimit',
			rateLimit: {
				windowSize: 1,
				windowUnit: 'minutes',
				maxRequests: 10,
				burstLimit: 15,
				penaltyTime: 5,
				penaltyUnit: 'minutes'
			}
		},
		configurationSchema: {
			rateLimit: {
				required: ['windowSize', 'windowUnit', 'maxRequests'],
				properties: {
					windowSize: { type: 'number', min: 1, max: 60 },
					windowUnit: { type: 'string', enum: ['seconds', 'minutes', 'hours'] },
					maxRequests: { type: 'number', min: 1, max: 1000 },
					burstLimit: { type: 'number', min: 1, max: 2000 },
					penaltyTime: { type: 'number', min: 1, max: 1440 },
					penaltyUnit: { type: 'string', enum: ['seconds', 'minutes', 'hours'] }
				}
			}
		},
		useCases: [
			'Prevent spam messages',
			'Control API usage costs',
			'Ensure fair resource usage',
			'Protect backend services'
		],
		estimatedSetupTime: '2-5 minutes'
	},

	customerSupport: {
		id: 'customerSupport',
		displayName: 'Customer Support Session',
		description: 'Comprehensive customer support with session management and context preservation',
		icon: 'headset',
		category: 'customer_service',
		difficulty: 'intermediate',
		operations: ['sessionManagement', 'smartMemory', 'userStorage'],
		defaultConfiguration: {
			operationType: 'sessionManagement',
			session: {
				sessionTimeout: 30,
				sessionTimeoutUnit: 'minutes',
				maxSessions: 100,
				sessionCleanup: true,
				cleanupInterval: 15,
				contextStorage: true
			},
			memory: {
				memoryType: 'conversation',
				maxMemorySize: 1000,
				memoryTtl: 24,
				memoryTtlUnit: 'hours',
				compressionEnabled: true,
				vectorSearch: false
			},
			userStorage: {
				storageType: 'profile',
				encryptData: true,
				dataRetention: 90,
				dataRetentionUnit: 'days',
				gdprCompliant: true
			}
		},
		configurationSchema: {
			session: {
				required: ['sessionTimeout', 'sessionTimeoutUnit'],
				properties: {
					sessionTimeout: { type: 'number', min: 1, max: 1440 },
					sessionTimeoutUnit: { type: 'string', enum: ['minutes', 'hours', 'days'] },
					maxSessions: { type: 'number', min: 1, max: 10000 },
					sessionCleanup: { type: 'boolean' },
					cleanupInterval: { type: 'number', min: 1, max: 1440 },
					contextStorage: { type: 'boolean' }
				}
			},
			memory: {
				required: ['memoryType', 'maxMemorySize', 'memoryTtl', 'memoryTtlUnit'],
				properties: {
					memoryType: { type: 'string', enum: ['conversation', 'faq', 'context', 'preference'] },
					maxMemorySize: { type: 'number', min: 10, max: 100000 },
					memoryTtl: { type: 'number', min: 1, max: 8760 },
					memoryTtlUnit: { type: 'string', enum: ['hours', 'days', 'weeks'] }
				}
			},
			userStorage: {
				required: ['storageType'],
				properties: {
					storageType: { type: 'string', enum: ['profile', 'preferences', 'history', 'analytics'] },
					dataRetention: { type: 'number', min: 1, max: 2555 },
					dataRetentionUnit: { type: 'string', enum: ['days', 'months', 'years'] }
				}
			}
		},
		useCases: [
			'Multi-turn customer conversations',
			'Context-aware support responses',
			'Customer profile management',
			'Support ticket tracking',
			'Agent handoff scenarios'
		],
		estimatedSetupTime: '10-15 minutes'
	},

	highVolumeBuffer: {
		id: 'highVolumeBuffer',
		displayName: 'High-Volume Buffer',
		description: 'Efficient message buffering and batch processing for high-traffic scenarios',
		icon: 'database',
		category: 'performance',
		difficulty: 'intermediate',
		operations: ['messageBuffering', 'smartRateLimit', 'analytics'],
		defaultConfiguration: {
			operationType: 'messageBuffering',
			buffer: {
				bufferSize: 100,
				flushInterval: 30,
				flushIntervalUnit: 'seconds',
				flushOnSize: true,
				maxBufferAge: 5,
				maxBufferAgeUnit: 'minutes'
			},
			rateLimit: {
				windowSize: 1,
				windowUnit: 'minutes',
				maxRequests: 1000,
				burstLimit: 1500,
				penaltyTime: 1,
				penaltyUnit: 'minutes'
			},
			analytics: {
				metricsToTrack: ['message_count', 'buffer_size', 'processing_time', 'error_rate'],
				aggregationLevel: 'global',
				retentionPeriod: 7,
				retentionUnit: 'days',
				realTimeAlerts: true,
				alertThresholds: {
					buffer_size: 80,
					error_rate: 5,
					processing_time: 1000
				}
			}
		},
		configurationSchema: {
			buffer: {
				required: ['bufferSize', 'flushInterval', 'flushIntervalUnit'],
				properties: {
					bufferSize: { type: 'number', min: 10, max: 10000 },
					flushInterval: { type: 'number', min: 1, max: 3600 },
					flushIntervalUnit: { type: 'string', enum: ['seconds', 'minutes'] },
					maxBufferAge: { type: 'number', min: 1, max: 1440 },
					maxBufferAgeUnit: { type: 'string', enum: ['minutes', 'hours'] }
				}
			},
			analytics: {
				required: ['metricsToTrack', 'aggregationLevel', 'retentionPeriod', 'retentionUnit'],
				properties: {
					aggregationLevel: { type: 'string', enum: ['user', 'session', 'channel', 'global'] },
					retentionPeriod: { type: 'number', min: 1, max: 365 },
					retentionUnit: { type: 'string', enum: ['days', 'weeks', 'months'] }
				}
			}
		},
		useCases: [
			'High-traffic chatbot scenarios',
			'Batch message processing',
			'Load balancing and optimization',
			'Performance monitoring',
			'Cost optimization for API calls'
		],
		estimatedSetupTime: '8-12 minutes'
	},

	smartFaqMemory: {
		id: 'smartFaqMemory',
		displayName: 'Smart FAQ Memory',
		description: 'Intelligent FAQ system with learning capabilities and context-aware responses',
		icon: 'brain',
		category: 'intelligence',
		difficulty: 'advanced',
		operations: ['smartMemory', 'messageRouting', 'analytics'],
		defaultConfiguration: {
			operationType: 'smartMemory',
			memory: {
				memoryType: 'faq',
				maxMemorySize: 5000,
				memoryTtl: 168,
				memoryTtlUnit: 'hours',
				compressionEnabled: true,
				vectorSearch: true
			},
			routing: {
				routingStrategy: 'content_based',
				routingRules: [
					{
						condition: 'contains_question_words',
						channel: 'faq_processor',
						priority: 1
					},
					{
						condition: 'high_confidence_match',
						channel: 'direct_answer',
						priority: 2
					},
					{
						condition: 'low_confidence_match',
						channel: 'human_handoff',
						priority: 3
					}
				],
				fallbackChannel: 'general_support',
				loadBalancing: false
			},
			analytics: {
				metricsToTrack: ['faq_hits', 'faq_misses', 'confidence_scores', 'learning_rate'],
				aggregationLevel: 'channel',
				retentionPeriod: 30,
				retentionUnit: 'days',
				realTimeAlerts: true,
				alertThresholds: {
					faq_hit_rate: 80,
					confidence_score: 0.7
				}
			}
		},
		configurationSchema: {
			memory: {
				required: ['memoryType', 'maxMemorySize', 'memoryTtl', 'memoryTtlUnit'],
				properties: {
					memoryType: { type: 'string', enum: ['conversation', 'faq', 'context', 'preference'] },
					maxMemorySize: { type: 'number', min: 100, max: 100000 },
					memoryTtl: { type: 'number', min: 1, max: 8760 },
					memoryTtlUnit: { type: 'string', enum: ['hours', 'days', 'weeks'] },
					vectorSearch: { type: 'boolean' }
				}
			},
			routing: {
				required: ['routingStrategy', 'routingRules'],
				properties: {
					routingStrategy: { type: 'string', enum: ['round_robin', 'weighted', 'priority', 'content_based'] },
					routingRules: { type: 'array', minItems: 1 }
				}
			}
		},
		useCases: [
			'Intelligent FAQ systems',
			'Self-learning chatbots',
			'Knowledge base integration',
			'Context-aware responses',
			'Automated customer education'
		],
		estimatedSetupTime: '15-25 minutes'
	},

	multiChannelRouter: {
		id: 'multiChannelRouter',
		displayName: 'Multi-Channel Router',
		description: 'Advanced message routing across multiple channels with load balancing',
		icon: 'shuffle',
		category: 'routing',
		difficulty: 'advanced',
		operations: ['messageRouting', 'sessionManagement', 'analytics'],
		defaultConfiguration: {
			operationType: 'messageRouting',
			routing: {
				routingStrategy: 'weighted',
				routingRules: [
					{
						condition: 'channel_priority_high',
						channel: 'premium_support',
						weight: 70,
						priority: 1
					},
					{
						condition: 'channel_priority_medium',
						channel: 'standard_support',
						weight: 20,
						priority: 2
					},
					{
						condition: 'channel_priority_low',
						channel: 'self_service',
						weight: 10,
						priority: 3
					}
				],
				fallbackChannel: 'overflow_queue',
				loadBalancing: true
			},
			session: {
				sessionTimeout: 60,
				sessionTimeoutUnit: 'minutes',
				maxSessions: 1000,
				sessionCleanup: true,
				cleanupInterval: 30,
				contextStorage: true
			},
			analytics: {
				metricsToTrack: ['routing_decisions', 'channel_load', 'response_times', 'success_rates'],
				aggregationLevel: 'channel',
				retentionPeriod: 14,
				retentionUnit: 'days',
				realTimeAlerts: true,
				alertThresholds: {
					channel_load: 90,
					response_time: 5000,
					success_rate: 95
				}
			}
		},
		configurationSchema: {
			routing: {
				required: ['routingStrategy', 'routingRules'],
				properties: {
					routingStrategy: { type: 'string', enum: ['round_robin', 'weighted', 'priority', 'content_based'] },
					routingRules: { type: 'array', minItems: 1 },
					loadBalancing: { type: 'boolean' }
				}
			},
			session: {
				required: ['sessionTimeout', 'sessionTimeoutUnit'],
				properties: {
					sessionTimeout: { type: 'number', min: 1, max: 1440 },
					sessionTimeoutUnit: { type: 'string', enum: ['minutes', 'hours', 'days'] },
					maxSessions: { type: 'number', min: 1, max: 100000 }
				}
			}
		},
		useCases: [
			'Multi-channel customer support',
			'Load balancing across agents',
			'Priority-based routing',
			'Channel overflow management',
			'Performance optimization'
		],
		estimatedSetupTime: '12-20 minutes'
	}
};

// Template Validator Implementation
export class ChatbotTemplateValidator implements TemplateValidator {
	validate(config: OperationConfiguration): boolean {
		return this.getErrors(config).length === 0;
	}

	getErrors(config: OperationConfiguration): string[] {
		const errors: string[] = [];
		
		// Validate operation type
		if (!config.operationType) {
			errors.push('Operation type is required');
			return errors;
		}

		// Validate based on operation type
		switch (config.operationType) {
			case 'smartRateLimit':
				errors.push(...this.validateRateLimit(config.rateLimit));
				break;
			case 'sessionManagement':
				errors.push(...this.validateSession(config.session));
				break;
			case 'messageBuffering':
				errors.push(...this.validateBuffer(config.buffer));
				break;
			case 'smartMemory':
				errors.push(...this.validateMemory(config.memory));
				break;
			case 'messageRouting':
				errors.push(...this.validateRouting(config.routing));
				break;
			case 'userStorage':
				errors.push(...this.validateUserStorage(config.userStorage));
				break;
			case 'analytics':
				errors.push(...this.validateAnalytics(config.analytics));
				break;
		}

		return errors;
	}

	getWarnings(config: OperationConfiguration): string[] {
		const warnings: string[] = [];
		
		// Add performance warnings
		if (config.memory?.maxMemorySize && config.memory.maxMemorySize > 50000) {
			warnings.push('Large memory size may impact performance');
		}
		
		if (config.buffer?.bufferSize && config.buffer.bufferSize > 5000) {
			warnings.push('Large buffer size may increase memory usage');
		}

		if (config.analytics?.retentionPeriod && config.analytics.retentionPeriod > 90) {
			warnings.push('Long retention period may increase storage costs');
		}

		return warnings;
	}

	private validateRateLimit(config?: any): string[] {
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

	private validateSession(config?: any): string[] {
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

	private validateBuffer(config?: any): string[] {
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

	private validateMemory(config?: any): string[] {
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

	private validateRouting(config?: any): string[] {
		const errors: string[] = [];
		if (!config) {
			errors.push('Routing configuration is required');
			return errors;
		}

		if (!config.routingStrategy) {
			errors.push('Routing strategy is required');
		}
		if (!config.routingRules || !Array.isArray(config.routingRules) || config.routingRules.length === 0) {
			errors.push('At least one routing rule is required');
		}

		return errors;
	}

	private validateUserStorage(config?: any): string[] {
		const errors: string[] = [];
		if (!config) {
			errors.push('User storage configuration is required');
			return errors;
		}

		if (!config.storageType) {
			errors.push('Storage type is required');
		}

		return errors;
	}

	private validateAnalytics(config?: any): string[] {
		const errors: string[] = [];
		if (!config) {
			errors.push('Analytics configuration is required');
			return errors;
		}

		if (!config.metricsToTrack || !Array.isArray(config.metricsToTrack) || config.metricsToTrack.length === 0) {
			errors.push('At least one metric to track is required');
		}
		if (!config.aggregationLevel) {
			errors.push('Aggregation level is required');
		}
		if (!config.retentionPeriod || config.retentionPeriod < 1) {
			errors.push('Retention period must be at least 1');
		}

		return errors;
	}
}

// Template Utility Functions
export class TemplateManager {
	private validator = new ChatbotTemplateValidator();

	getTemplate(templateType: TemplateType): TemplateDefinition {
		return CHATBOT_TEMPLATES[templateType];
	}

	getAllTemplates(): TemplateDefinition[] {
		return Object.values(CHATBOT_TEMPLATES);
	}

	getTemplatesByCategory(category: string): TemplateDefinition[] {
		return Object.values(CHATBOT_TEMPLATES).filter(template => template.category === category);
	}

	getTemplatesByDifficulty(difficulty: string): TemplateDefinition[] {
		return Object.values(CHATBOT_TEMPLATES).filter(template => template.difficulty === difficulty);
	}

	applyTemplate(templateType: TemplateType, customConfig?: DeepPartial<OperationConfiguration>): OperationConfiguration {
		const template = this.getTemplate(templateType);
		if (!template) {
			throw new Error(`Template not found: ${templateType}`);
		}

		// Deep merge template configuration with custom configuration
		const config = this.deepMerge(template.defaultConfiguration, customConfig || {});
		
		// Validate the final configuration
		if (!this.validator.validate(config)) {
			const errors = this.validator.getErrors(config);
			throw new Error(`Invalid configuration: ${errors.join(', ')}`);
		}

		return config;
	}

	validateTemplateConfiguration(templateType: TemplateType, config: OperationConfiguration): {
		isValid: boolean;
		errors: string[];
		warnings: string[];
	} {
		const template = this.getTemplate(templateType);
		if (!template) {
			return {
				isValid: false,
				errors: [`Template not found: ${templateType}`],
				warnings: []
			};
		}

		const errors = this.validator.getErrors(config);
		const warnings = this.validator.getWarnings(config);

		return {
			isValid: errors.length === 0,
			errors,
			warnings
		};
	}

	private deepMerge(target: any, source: any): any {
		const result = { ...target };
		
		for (const key in source) {
			if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
				result[key] = this.deepMerge(result[key] || {}, source[key]);
			} else {
				result[key] = source[key];
			}
		}
		
		return result;
	}
}

// Export singleton instance
export const templateManager = new TemplateManager();