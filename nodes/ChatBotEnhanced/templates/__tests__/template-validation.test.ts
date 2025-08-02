import { templateManager } from '../ChatbotTemplates';
import { RedisManager } from '../../managers/RedisManager';
import { RateLimiter } from '../../managers/RateLimiter';
import { SessionManager } from '../../managers/SessionManager';
import { MessageBuffer } from '../../managers/MessageBuffer';
import { MessageRouter } from '../../managers/MessageRouter';

// Mock managers for template testing
const createMockManagers = () => ({
	redisManager: {
		connect: jest.fn().mockResolvedValue(undefined),
		isAvailable: jest.fn().mockReturnValue(true),
		executeOperation: jest.fn().mockImplementation(async (operation) => 
			operation({
				get: jest.fn().mockResolvedValue('{}'),
				set: jest.fn().mockResolvedValue('OK'),
				hSet: jest.fn().mockResolvedValue(1),
				hGetAll: jest.fn().mockResolvedValue({}),
				multi: jest.fn().mockReturnValue({
					exec: jest.fn().mockResolvedValue([]),
					hSet: jest.fn().mockReturnThis(),
					expire: jest.fn().mockReturnThis(),
				}),
			})
		),
	} as unknown as RedisManager,

	rateLimiter: {
		checkRateLimit: jest.fn().mockResolvedValue({
			allowed: true,
			remainingRequests: 99,
			resetTime: Date.now() + 60000,
			totalRequests: 1,
			algorithm: 'sliding_window',
			strategy: 'per_user',
		}),
	} as unknown as RateLimiter,

	sessionManager: {
		createSession: jest.fn().mockResolvedValue({
			sessionId: 'test-session',
			userId: 'test-user',
			createdAt: Date.now(),
			lastActivity: Date.now(),
			messageCount: 0,
			context: {},
			metadata: {},
		}),
		getSession: jest.fn().mockResolvedValue(null),
		updateSession: jest.fn().mockResolvedValue({
			sessionId: 'test-session',
			userId: 'test-user',
			messageCount: 1,
			context: {},
			metadata: {},
			createdAt: Date.now(),
			lastActivity: Date.now(),
		}),
	} as unknown as SessionManager,

	messageBuffer: {
		addMessage: jest.fn().mockResolvedValue({
			bufferId: 'test-buffer',
			messageId: 'msg-123',
			shouldFlush: false,
		}),
		flush: jest.fn().mockResolvedValue({
			flushedMessages: [],
			remainingMessages: [],
			trigger: 'manual',
			flushTime: Date.now(),
			processingTime: 10,
		}),
	} as unknown as MessageBuffer,

	messageRouter: {
		routeMessage: jest.fn().mockResolvedValue({
			messageId: 'route-123',
			delivered: ['channel-1'],
			failed: [],
			processingTime: 5,
		}),
		addRoutingRule: jest.fn().mockResolvedValue(undefined),
	} as unknown as MessageRouter,
});

describe('Template Validation Tests', () => {
	let mockManagers: ReturnType<typeof createMockManagers>;

	beforeEach(() => {
		mockManagers = createMockManagers();
	});

	describe('Template Structure Validation', () => {
		it('should have all 5 required templates', () => {
			const templateList = templateManager.getAllTemplates();
			
			expect(templateList).toHaveLength(5);
			expect(templateList.map(t => t.id)).toContain('smart_rate_limiter');
			expect(templateList.map(t => t.id)).toContain('session_context_manager');
			expect(templateList.map(t => t.id)).toContain('intelligent_message_buffer');
			expect(templateList.map(t => t.id)).toContain('smart_message_router');
			expect(templateList.map(t => t.id)).toContain('hybrid_operation');
		});

		it('should have proper template metadata', () => {
			const templateList = templates.getAvailableTemplates();

			templateList.forEach(template => {
				expect(template).toHaveProperty('id');
				expect(template).toHaveProperty('name');
				expect(template).toHaveProperty('description');
				expect(template).toHaveProperty('category');
				expect(template).toHaveProperty('difficulty');
				expect(template).toHaveProperty('estimatedSetupTime');
				expect(template).toHaveProperty('configuration');
				expect(template).toHaveProperty('useCase');

				// Validate required fields are not empty
				expect(template.id).toBeTruthy();
				expect(template.name).toBeTruthy();
				expect(template.description).toBeTruthy();
				expect(template.configuration).toBeDefined();
			});
		});

		it('should have valid difficulty levels', () => {
			const templateList = templates.getAvailableTemplates();
			const validDifficulties = ['beginner', 'intermediate', 'advanced'];

			templateList.forEach(template => {
				expect(validDifficulties).toContain(template.difficulty);
			});
		});

		it('should have reasonable setup time estimates', () => {
			const templateList = templates.getAvailableTemplates();

			templateList.forEach(template => {
				expect(template.estimatedSetupTime).toMatch(/^\d+\s+(minutes?|mins?)$/);
				
				// Extract minutes from string like "3 minutes"
				const minutes = parseInt(template.estimatedSetupTime.match(/\d+/)?.[0] || '0');
				expect(minutes).toBeGreaterThan(0);
				expect(minutes).toBeLessThanOrEqual(5); // Should meet 5-minute requirement
			});
		});
	});

	describe('Smart Rate Limiter Template', () => {
		it('should have valid configuration', () => {
			const template = templates.getTemplate('smart_rate_limiter');
			
			expect(template).toBeDefined();
			expect(template!.configuration).toMatchObject({
				operation: 'rate_limit',
				rateLimitConfig: expect.objectContaining({
					algorithm: expect.any(String),
					strategy: expect.any(String),
					maxRequests: expect.any(Number),
					windowSize: expect.any(Number),
				}),
			});

			// Validate algorithm and strategy are valid
			const validAlgorithms = ['token_bucket', 'sliding_window', 'fixed_window'];
			const validStrategies = ['per_user', 'per_ip', 'per_session', 'global'];
			
			expect(validAlgorithms).toContain(template!.configuration.rateLimitConfig.algorithm);
			expect(validStrategies).toContain(template!.configuration.rateLimitConfig.strategy);
		});

		it('should apply configuration correctly', async () => {
			const template = templates.getTemplate('smart_rate_limiter');
			const config = templates.applyTemplate('smart_rate_limiter', {
				userId: 'test-user',
				customMaxRequests: 50,
			});

			expect(config).toMatchObject({
				operation: 'rate_limit',
				rateLimitConfig: expect.objectContaining({
					maxRequests: 50, // Should apply custom value
				}),
			});
		});

		it('should execute successfully', async () => {
			const template = templates.getTemplate('smart_rate_limiter');
			const success = await templates.executeTemplate(
				'smart_rate_limiter',
				{ userId: 'test-user', message: 'Hello' },
				mockManagers
			);

			expect(success).toBe(true);
			expect(mockManagers.rateLimiter.checkRateLimit).toHaveBeenCalledWith('test-user', 1);
		});

		it('should handle rate limit exceeded scenario', async () => {
			mockManagers.rateLimiter.checkRateLimit = jest.fn().mockResolvedValue({
				allowed: false,
				remainingRequests: 0,
				resetTime: Date.now() + 60000,
				totalRequests: 100,
				retryAfter: 60,
			});

			const success = await templates.executeTemplate(
				'smart_rate_limiter',
				{ userId: 'test-user', message: 'Hello' },
				mockManagers
			);

			expect(success).toBe(false); // Should indicate rate limit exceeded
		});
	});

	describe('Session Context Manager Template', () => {
		it('should have valid configuration', () => {
			const template = templates.getTemplate('session_context_manager');
			
			expect(template).toBeDefined();
			expect(template!.configuration).toMatchObject({
				operation: 'session_manage',
				sessionConfig: expect.objectContaining({
					defaultTtl: expect.any(Number),
					contextStorage: expect.any(Boolean),
					maxContextSize: expect.any(Number),
				}),
			});
		});

		it('should create new session for new users', async () => {
			const success = await templates.executeTemplate(
				'session_context_manager',
				{ userId: 'new-user', sessionId: 'new-session', message: 'Hello' },
				mockManagers
			);

			expect(success).toBe(true);
			expect(mockManagers.sessionManager.getSession).toHaveBeenCalledWith('new-session');
		});

		it('should update existing session', async () => {
			mockManagers.sessionManager.getSession = jest.fn().mockResolvedValue({
				sessionId: 'existing-session',
				userId: 'existing-user',
				messageCount: 5,
				context: { previousTopic: 'weather' },
				metadata: {},
				createdAt: Date.now() - 60000,
				lastActivity: Date.now() - 30000,
			});

			const success = await templates.executeTemplate(
				'session_context_manager',
				{ userId: 'existing-user', sessionId: 'existing-session', message: 'How about sports?' },
				mockManagers
			);

			expect(success).toBe(true);
			expect(mockManagers.sessionManager.updateSession).toHaveBeenCalledWith(
				'existing-session',
				expect.objectContaining({
					message: 'How about sports?',
					messageType: 'user',
				})
			);
		});

		it('should handle session configuration customization', () => {
			const config = templates.applyTemplate('session_context_manager', {
				customTtl: 3600,
				maxContextSize: 200,
			});

			expect(config.sessionConfig.defaultTtl).toBe(3600);
			expect(config.sessionConfig.maxContextSize).toBe(200);
		});
	});

	describe('Intelligent Message Buffer Template', () => {
		it('should have valid configuration', () => {
			const template = templates.getTemplate('intelligent_message_buffer');
			
			expect(template).toBeDefined();
			expect(template!.configuration).toMatchObject({
				operation: 'buffer_message',
				bufferConfig: expect.objectContaining({
					pattern: expect.any(String),
					maxSize: expect.any(Number),
					flushInterval: expect.any(Number),
				}),
			});

			const validPatterns = ['collect_send', 'throttle', 'batch', 'priority'];
			expect(validPatterns).toContain(template!.configuration.bufferConfig.pattern);
		});

		it('should buffer messages correctly', async () => {
			const success = await templates.executeTemplate(
				'intelligent_message_buffer',
				{ userId: 'test-user', message: 'Buffered message', priority: 5 },
				mockManagers
			);

			expect(success).toBe(true);
			expect(mockManagers.messageBuffer.addMessage).toHaveBeenCalledWith(
				'test-user',
				expect.objectContaining({
					content: 'Buffered message',
					priority: 5,
					userId: 'test-user',
				})
			);
		});

		it('should handle flush trigger', async () => {
			mockManagers.messageBuffer.addMessage = jest.fn().mockResolvedValue({
				bufferId: 'test-buffer',
				messageId: 'msg-123',
				shouldFlush: true, // Trigger flush
			});

			const success = await templates.executeTemplate(
				'intelligent_message_buffer',
				{ userId: 'test-user', message: 'Trigger flush', flushTrigger: true },
				mockManagers
			);

			expect(success).toBe(true);
			expect(mockManagers.messageBuffer.flush).toHaveBeenCalledWith('test-user', 'size');
		});

		it('should support different buffer patterns', () => {
			const patterns = ['collect_send', 'throttle', 'batch', 'priority'];
			
			patterns.forEach(pattern => {
				const config = templates.applyTemplate('intelligent_message_buffer', {
					bufferPattern: pattern,
				});

				expect(config.bufferConfig.pattern).toBe(pattern);
			});
		});
	});

	describe('Smart Message Router Template', () => {
		it('should have valid configuration', () => {
			const template = templates.getTemplate('smart_message_router');
			
			expect(template).toBeDefined();
			expect(template!.configuration).toMatchObject({
				operation: 'route_message',
				routerConfig: expect.objectContaining({
					pattern: expect.any(String),
					channels: expect.any(Array),
					enablePatternMatching: expect.any(Boolean),
				}),
			});

			const validPatterns = ['one_to_many', 'many_to_one', 'load_balance', 'topic_based'];
			expect(validPatterns).toContain(template!.configuration.routerConfig.pattern);
		});

		it('should route messages correctly', async () => {
			const success = await templates.executeTemplate(
				'smart_message_router',
				{ 
					userId: 'test-user', 
					message: 'Route this message',
					sourceChannel: 'input-channel',
				},
				mockManagers
			);

			expect(success).toBe(true);
			expect(mockManagers.messageRouter.routeMessage).toHaveBeenCalledWith(
				expect.objectContaining({
					content: 'Route this message',
					sourceChannel: 'input-channel',
				})
			);
		});

		it('should set up routing rules for topic-based routing', async () => {
			const config = templates.applyTemplate('smart_message_router', {
				routingPattern: 'topic_based',
				routingRules: [
					{
						name: 'error-routing',
						condition: 'contains:error',
						targetChannel: 'error-channel',
						priority: 10,
						enabled: true,
					},
				],
			});

			expect(config.routerConfig.pattern).toBe('topic_based');
			expect(config.routerConfig.routingRules).toHaveLength(1);
		});

		it('should handle different routing patterns', () => {
			const patterns = ['one_to_many', 'many_to_one', 'load_balance', 'topic_based'];
			
			patterns.forEach(pattern => {
				const config = templates.applyTemplate('smart_message_router', {
					routingPattern: pattern,
				});

				expect(config.routerConfig.pattern).toBe(pattern);
			});
		});
	});

	describe('Hybrid Operation Template', () => {
		it('should have valid configuration combining multiple operations', () => {
			const template = templates.getTemplate('hybrid_operation');
			
			expect(template).toBeDefined();
			expect(template!.configuration).toMatchObject({
				operations: expect.arrayContaining([
					expect.objectContaining({ type: 'rate_limit' }),
					expect.objectContaining({ type: 'session_manage' }),
					expect.objectContaining({ type: 'buffer_message' }),
				]),
			});
		});

		it('should execute multiple operations in sequence', async () => {
			const success = await templates.executeTemplate(
				'hybrid_operation',
				{ 
					userId: 'test-user',
					sessionId: 'test-session', 
					message: 'Hybrid operation test',
				},
				mockManagers
			);

			expect(success).toBe(true);
			
			// Should execute all operations
			expect(mockManagers.rateLimiter.checkRateLimit).toHaveBeenCalled();
			expect(mockManagers.sessionManager.updateSession).toHaveBeenCalled();
			expect(mockManagers.messageBuffer.addMessage).toHaveBeenCalled();
		});

		it('should stop execution if rate limit is exceeded', async () => {
			mockManagers.rateLimiter.checkRateLimit = jest.fn().mockResolvedValue({
				allowed: false,
				remainingRequests: 0,
				resetTime: Date.now() + 60000,
				totalRequests: 100,
				retryAfter: 60,
			});

			const success = await templates.executeTemplate(
				'hybrid_operation',
				{ userId: 'test-user', sessionId: 'test-session', message: 'Should be blocked' },
				mockManagers
			);

			expect(success).toBe(false);
			expect(mockManagers.rateLimiter.checkRateLimit).toHaveBeenCalled();
			// Should not proceed to other operations
			expect(mockManagers.sessionManager.updateSession).not.toHaveBeenCalled();
		});

		it('should handle partial failures gracefully', async () => {
			mockManagers.sessionManager.updateSession = jest.fn().mockRejectedValue(
				new Error('Session update failed')
			);

			const success = await templates.executeTemplate(
				'hybrid_operation',
				{ userId: 'test-user', sessionId: 'test-session', message: 'Partial failure test' },
				mockManagers
			);

			// Should still attempt all operations and handle failures
			expect(mockManagers.rateLimiter.checkRateLimit).toHaveBeenCalled();
			expect(mockManagers.sessionManager.updateSession).toHaveBeenCalled();
			expect(mockManagers.messageBuffer.addMessage).toHaveBeenCalled();
		});
	});

	describe('Template Customization', () => {
		it('should support parameter substitution', () => {
			const config = templates.applyTemplate('smart_rate_limiter', {
				userId: 'custom-user',
				customMaxRequests: 200,
				customWindowSize: 120,
			});

			expect(config.rateLimitConfig.maxRequests).toBe(200);
			expect(config.rateLimitConfig.windowSize).toBe(120);
		});

		it('should maintain default values for unspecified parameters', () => {
			const config = templates.applyTemplate('smart_rate_limiter', {
				userId: 'test-user',
			});

			// Should have default values
			expect(config.rateLimitConfig.maxRequests).toBeDefined();
			expect(config.rateLimitConfig.windowSize).toBeDefined();
			expect(config.rateLimitConfig.algorithm).toBeDefined();
		});

		it('should validate required parameters', () => {
			expect(() => {
				templates.applyTemplate('smart_rate_limiter', {}); // Missing userId
			}).toThrow();
		});

		it('should support nested parameter customization', () => {
			const config = templates.applyTemplate('session_context_manager', {
				userId: 'test-user',
				sessionConfig: {
					defaultTtl: 7200,
					contextStorage: false,
				},
			});

			expect(config.sessionConfig.defaultTtl).toBe(7200);
			expect(config.sessionConfig.contextStorage).toBe(false);
		});
	});

	describe('Error Handling', () => {
		it('should handle non-existent template requests', () => {
			const template = templates.getTemplate('non_existent_template');
			expect(template).toBeUndefined();
		});

		it('should handle template execution failures', async () => {
			mockManagers.rateLimiter.checkRateLimit = jest.fn().mockRejectedValue(
				new Error('Redis connection failed')
			);

			const success = await templates.executeTemplate(
				'smart_rate_limiter',
				{ userId: 'test-user', message: 'Test' },
				mockManagers
			);

			expect(success).toBe(false);
		});

		it('should validate template parameters before execution', async () => {
			await expect(
				templates.executeTemplate(
					'smart_rate_limiter',
					{}, // Missing required parameters
					mockManagers
				)
			).rejects.toThrow();
		});
	});

	describe('Performance Requirements', () => {
		it('should complete template setup within 5 minutes (simulated)', () => {
			const templateList = templates.getAvailableTemplates();

			templateList.forEach(template => {
				const setupTimeMinutes = parseInt(template.estimatedSetupTime.match(/\d+/)?.[0] || '0');
				expect(setupTimeMinutes).toBeLessThanOrEqual(5);
			});
		});

		it('should execute templates efficiently', async () => {
			const startTime = performance.now();

			const promises = templates.getAvailableTemplates().map(template =>
				templates.executeTemplate(
					template.id,
					{ userId: 'perf-test', sessionId: 'perf-session', message: 'Performance test' },
					mockManagers
				)
			);

			await Promise.all(promises);

			const endTime = performance.now();
			const totalTime = endTime - startTime;

			// All 5 templates should execute quickly
			expect(totalTime).toBeLessThan(1000); // 1 second for all templates
		});

		it('should have reasonable configuration complexity', () => {
			const templateList = templates.getAvailableTemplates();

			templateList.forEach(template => {
				const configString = JSON.stringify(template.configuration);
				
				// Configuration should not be overly complex
				expect(configString.length).toBeLessThan(5000);
				
				// Should be parseable JSON
				expect(() => JSON.parse(configString)).not.toThrow();
			});
		});
	});

	describe('Documentation and Examples', () => {
		it('should include usage examples for each template', () => {
			const templateList = templates.getAvailableTemplates();

			templateList.forEach(template => {
				expect(template.useCase).toBeDefined();
				expect(template.useCase.description).toBeTruthy();
				expect(template.useCase.scenario).toBeTruthy();
				expect(template.useCase.expectedResults).toBeDefined();
				expect(Array.isArray(template.useCase.expectedResults)).toBe(true);
			});
		});

		it('should provide clear template descriptions', () => {
			const templateList = templates.getAvailableTemplates();

			templateList.forEach(template => {
				expect(template.description.length).toBeGreaterThan(50);
				expect(template.description.length).toBeLessThan(500);
				
				// Should not contain placeholder text
				expect(template.description.toLowerCase()).not.toContain('todo');
				expect(template.description.toLowerCase()).not.toContain('placeholder');
			});
		});

		it('should categorize templates appropriately', () => {
			const templateList = templates.getAvailableTemplates();
			const validCategories = [
				'Rate Limiting',
				'Session Management', 
				'Message Processing',
				'Routing',
				'Hybrid Operations'
			];

			templateList.forEach(template => {
				expect(validCategories).toContain(template.category);
			});
		});
	});
});