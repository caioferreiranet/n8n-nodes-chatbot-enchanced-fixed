import { AnalyticsTracker, AnalyticsConfig, MetricType, MetricQuery, PerformanceMetrics } from '../managers/AnalyticsTracker';
import { RedisManager } from '../managers/RedisManager';

// Mock RedisManager
const mockRedisManager = {
	executeOperation: jest.fn(),
} as unknown as RedisManager;

// Mock Redis client
const mockClient = {
	hSet: jest.fn(),
	hGetAll: jest.fn(),
	hDel: jest.fn(),
	hLen: jest.fn(),
	del: jest.fn(),
	keys: jest.fn(),
	expire: jest.fn(),
	multi: jest.fn(),
};

describe('AnalyticsTracker', () => {
	let analyticsTracker: AnalyticsTracker;
	let config: Partial<AnalyticsConfig>;

	beforeEach(() => {
		jest.clearAllMocks();
		jest.useFakeTimers();
		jest.setSystemTime(new Date('2024-01-01T00:00:00Z'));

		config = {
			retentionDays: 7,
			enableRealTimeMetrics: false, // Disable for most tests
			batchSize: 10,
			flushInterval: 60,
			keyPrefix: 'test_analytics',
			enableHistograms: true,
			histogramBuckets: [0.1, 0.5, 1, 5, 10, 50, 100],
		};

		// Setup default mock responses
		mockClient.hSet.mockResolvedValue(1);
		mockClient.hGetAll.mockResolvedValue({});
		mockClient.hDel.mockResolvedValue(1);
		mockClient.hLen.mockResolvedValue(0);
		mockClient.del.mockResolvedValue(1);
		mockClient.keys.mockResolvedValue([]);
		mockClient.expire.mockResolvedValue(1);
		mockClient.multi.mockReturnValue({
			del: jest.fn().mockReturnThis(),
			exec: jest.fn().mockResolvedValue([['OK']])
		});

		analyticsTracker = new AnalyticsTracker(mockRedisManager, config);

		// Default mock implementation
		(mockRedisManager.executeOperation as jest.Mock).mockImplementation(
			async (operation) => operation(mockClient)
		);
	});

	afterEach(() => {
		analyticsTracker.stopBatchProcessor();
		jest.useRealTimers();
	});

	describe('Metric Recording', () => {
		it('should record simple counter metric', async () => {
			await analyticsTracker.recordMetric('requests', 1, 'counter');

			expect(mockClient.hSet).toHaveBeenCalledWith(
				expect.stringMatching(/test_analytics:metrics:\d{10}/), // Hour-based key pattern
				expect.stringContaining('requests:counter'),
				expect.stringContaining('"name":"requests"')
			);

			expect(mockClient.expire).toHaveBeenCalledWith(
				expect.stringMatching(/test_analytics:metrics:\d{10}/),
				8 * 24 * 60 * 60 // retentionDays + 1 day
			);
		});

		it('should record gauge metric with tags', async () => {
			const tags = { service: 'api', version: '1.0' };
			await analyticsTracker.recordMetric('memory_usage', 256, 'gauge', tags);

			expect(mockClient.hSet).toHaveBeenCalledWith(
				expect.any(String),
				expect.stringContaining('service=api,version=1.0'),
				expect.stringContaining('"tags":{"service":"api","version":"1.0"}')
			);
		});

		it('should record timer with histogram when enabled', async () => {
			const duration = 2.5;
			await analyticsTracker.timing('response_time', duration);

			// Should record the timer
			expect(mockClient.hSet).toHaveBeenCalledWith(
				expect.any(String),
				expect.stringContaining('response_time:timer'),
				expect.any(String)
			);

			// Should record histogram buckets (5 and 10 should be incremented)
			expect(mockClient.hSet).toHaveBeenCalledWith(
				expect.any(String),
				expect.stringContaining('response_time.histogram.5'),
				expect.any(String)
			);

			expect(mockClient.hSet).toHaveBeenCalledWith(
				expect.any(String),
				expect.stringContaining('response_time.histogram.count'),
				expect.any(String)
			);
		});

		it('should record multiple metrics at once', async () => {
			const metrics = [
				{ name: 'metric1', value: 10, type: 'counter' as MetricType },
				{ name: 'metric2', value: 20, type: 'gauge' as MetricType },
				{ name: 'metric3', value: 30, type: 'timer' as MetricType },
			];

			await analyticsTracker.recordMetrics(metrics);

			expect(mockClient.hSet).toHaveBeenCalledTimes(3); // One for each metric
		});

		it('should use convenience methods for common metrics', async () => {
			await analyticsTracker.increment('page_views', 5);
			await analyticsTracker.gauge('active_users', 100);

			expect(mockClient.hSet).toHaveBeenCalledWith(
				expect.any(String),
				expect.stringContaining('page_views:counter'),
				expect.stringContaining('"value":5')
			);

			expect(mockClient.hSet).toHaveBeenCalledWith(
				expect.any(String),
				expect.stringContaining('active_users:gauge'),
				expect.stringContaining('"value":100')
			);
		});

		it('should record performance metrics', async () => {
			const perfMetrics: PerformanceMetrics = {
				processingTime: 150,
				memoryUsage: 512,
				redisLatency: 5,
				queueSize: 10,
				errorRate: 0.01,
				throughput: 1000,
			};

			await analyticsTracker.recordPerformance(perfMetrics);

			// Should record 6 performance metrics
			expect(mockClient.hSet).toHaveBeenCalledTimes(6);
			
			expect(mockClient.hSet).toHaveBeenCalledWith(
				expect.any(String),
				expect.stringContaining('performance.processing_time:timer'),
				expect.stringContaining('"value":150')
			);

			expect(mockClient.hSet).toHaveBeenCalledWith(
				expect.any(String),
				expect.stringContaining('performance.throughput:gauge'),
				expect.stringContaining('"value":1000')
			);
		});
	});

	describe('Batch Processing', () => {
		beforeEach(() => {
			config.enableRealTimeMetrics = true;
			analyticsTracker = new AnalyticsTracker(mockRedisManager, config);
		});

		it('should buffer metrics in real-time mode', async () => {
			await analyticsTracker.recordMetric('test', 1);

			// Should not immediately store to Redis
			expect(mockClient.hSet).not.toHaveBeenCalled();
		});

		it('should flush buffer when batch size is reached', async () => {
			const mockPipeline = {
				hSet: jest.fn().mockReturnThis(),
				expire: jest.fn().mockReturnThis(),
				exec: jest.fn().mockResolvedValue([]),
			};
			mockClient.multi.mockReturnValue(mockPipeline);

			// Record batchSize number of metrics
			for (let i = 0; i < 10; i++) {
				await analyticsTracker.recordMetric(`metric${i}`, i);
			}

			expect(mockClient.multi).toHaveBeenCalled();
			expect(mockPipeline.exec).toHaveBeenCalled();
		});

		it('should flush buffer periodically', async () => {
			const mockPipeline = {
				hSet: jest.fn().mockReturnThis(),
				expire: jest.fn().mockReturnThis(),
				exec: jest.fn().mockResolvedValue([]),
			};
			mockClient.multi.mockReturnValue(mockPipeline);

			await analyticsTracker.recordMetric('test', 1);

			// Advance time to trigger periodic flush
			jest.advanceTimersByTime(60000); // flushInterval in ms

			expect(mockClient.multi).toHaveBeenCalled();
		});

		it('should handle flush errors gracefully', async () => {
			const mockPipeline = {
				hSet: jest.fn().mockReturnThis(),
				expire: jest.fn().mockReturnThis(),
				exec: jest.fn().mockRejectedValue(new Error('Redis error')),
			};
			mockClient.multi.mockReturnValue(mockPipeline);

			await analyticsTracker.recordMetric('test', 1);
			
			// Trigger flush
			jest.advanceTimersByTime(60000);

			// Should not throw error, metrics should be put back in buffer
			// Next flush attempt should include the failed metrics
		});

		it('should stop batch processor and flush remaining metrics', async () => {
			const mockPipeline = {
				hSet: jest.fn().mockReturnThis(),
				expire: jest.fn().mockReturnThis(),
				exec: jest.fn().mockResolvedValue([]),
			};
			mockClient.multi.mockReturnValue(mockPipeline);

			await analyticsTracker.recordMetric('test', 1);
			await analyticsTracker.stopBatchProcessor();

			expect(mockClient.multi).toHaveBeenCalled();
			expect(analyticsTracker.isActive()).toBe(false);
		});
	});

	describe('Metric Querying', () => {
		const sampleMetrics: Record<string, Record<string, string>> = {
			'test_analytics:metrics:2024010100': {
				'requests:counter::1704063600000': JSON.stringify({
					name: 'requests',
					type: 'counter',
					value: 10,
					timestamp: 1704063600000,
				}),
				'memory:gauge:service=api:1704063600000': JSON.stringify({
					name: 'memory',
					type: 'gauge',
					value: 256,
					timestamp: 1704063600000,
					tags: { service: 'api' },
				}),
			},
			'test_analytics:metrics:2024010101': {
				'requests:counter::1704067200000': JSON.stringify({
					name: 'requests',
					type: 'counter',
					value: 15,
					timestamp: 1704067200000,
				}),
			},
		};

		beforeEach(() => {
			mockClient.keys.mockResolvedValue([
				'test_analytics:metrics:2024010100',
				'test_analytics:metrics:2024010101',
			]);

			mockClient.hGetAll.mockImplementation((key: string) => {
				return Promise.resolve(sampleMetrics[key] || {});
			});
		});

		it('should query all metrics within time range', async () => {
			const query: MetricQuery = {
				startTime: 1704063600000,
				endTime: 1704070800000,
			};

			const results = await analyticsTracker.queryMetrics(query);

			expect(results).toHaveLength(3);
			expect(results[0].name).toBe('requests');
			expect(results[0].value).toBe(10);
		});

		it('should filter metrics by name', async () => {
			const query: MetricQuery = {
				name: 'requests',
			};

			const results = await analyticsTracker.queryMetrics(query);

			expect(results).toHaveLength(2);
			expect(results.every(r => r.name === 'requests')).toBe(true);
		});

		it('should filter metrics by type', async () => {
			const query: MetricQuery = {
				type: 'gauge',
			};

			const results = await analyticsTracker.queryMetrics(query);

			expect(results).toHaveLength(1);
			expect(results[0].type).toBe('gauge');
		});

		it('should filter metrics by tags', async () => {
			const query: MetricQuery = {
				tags: { service: 'api' },
			};

			const results = await analyticsTracker.queryMetrics(query);

			expect(results).toHaveLength(1);
			expect(results[0].tags).toEqual({ service: 'api' });
		});

		it('should limit results', async () => {
			const query: MetricQuery = {
				limit: 2,
			};

			const results = await analyticsTracker.queryMetrics(query);

			expect(results).toHaveLength(2);
		});

		it('should aggregate results without interval', async () => {
			const query: MetricQuery = {
				name: 'requests',
				aggregation: 'sum',
			};

			const results = await analyticsTracker.queryMetrics(query);

			expect(results).toHaveLength(1);
			expect(results[0].value).toBe(25); // 10 + 15
		});

		it('should aggregate results with time intervals', async () => {
			const query: MetricQuery = {
				name: 'requests',
				aggregation: 'avg',
				interval: 3600, // 1 hour
			};

			const results = await analyticsTracker.queryMetrics(query);

			expect(results).toHaveLength(2); // Two different hours
			expect(results[0].value).toBe(10); // First hour average
			expect(results[1].value).toBe(15); // Second hour average
		});

		it('should handle corrupted metric data gracefully', async () => {
			mockClient.hGetAll
				.mockResolvedValueOnce({
					'valid:counter::123': JSON.stringify({ name: 'valid', type: 'counter', value: 1, timestamp: 123 }),
					'invalid:counter::456': 'invalid-json-data',
				});

			const results = await analyticsTracker.queryMetrics();

			expect(results).toHaveLength(1);
			expect(results[0].name).toBe('valid');
		});
	});

	describe('Statistics and Analytics', () => {
		it('should calculate analytics statistics', async () => {
			const metricsData = {
				'metric1': JSON.stringify({
					name: 'metric1',
					type: 'counter',
					value: 10,
					timestamp: Date.now() - 1000,
				}),
				'metric2': JSON.stringify({
					name: 'metric2',
					type: 'gauge',
					value: 20,
					timestamp: Date.now() - 2000,
				}),
				'metric3': JSON.stringify({
					name: 'metric3',
					type: 'timer',
					value: 30,
					timestamp: Date.now() - 100000, // Old metric
				}),
			};

			mockClient.keys.mockResolvedValue(['test_analytics:metrics:2024010100']);
			mockClient.hGetAll.mockResolvedValue(metricsData);

			const stats = await analyticsTracker.getStats();

			expect(stats).toMatchObject({
				totalMetrics: 3,
				metricsPerType: {
					counter: 1,
					gauge: 1,
					histogram: 0,
					timer: 1,
				},
				oldestMetric: expect.any(Number),
				newestMetric: expect.any(Number),
				storageSize: expect.any(Number),
				retentionRate: expect.any(Number),
			});
		});

		it('should handle empty analytics data', async () => {
			mockClient.keys.mockResolvedValue([]);

			const stats = await analyticsTracker.getStats();

			expect(stats).toMatchObject({
				totalMetrics: 0,
				oldestMetric: 0,
				newestMetric: 0,
				storageSize: 0,
				retentionRate: 0,
			});
		});
	});

	describe('Data Cleanup', () => {
		it('should clean up old metrics', async () => {
			const cutoffTime = Date.now() - (7 * 24 * 60 * 60 * 1000);
			
			const metricsData = {
				'old_metric': JSON.stringify({
					name: 'old',
					type: 'counter',
					value: 1,
					timestamp: cutoffTime - 1000, // Older than cutoff
				}),
				'new_metric': JSON.stringify({
					name: 'new',
					type: 'counter',
					value: 1,
					timestamp: cutoffTime + 1000, // Newer than cutoff
				}),
				'corrupted_metric': 'invalid-json',
			};

			mockClient.keys.mockResolvedValue(['test_analytics:metrics:2024010100']);
			mockClient.hGetAll.mockResolvedValue(metricsData);
			mockClient.hLen.mockResolvedValue(1); // One metric remains

			const deletedCount = await analyticsTracker.cleanup();

			expect(deletedCount).toBe(2); // old_metric + corrupted_metric
			expect(mockClient.hDel).toHaveBeenCalledWith(
				'test_analytics:metrics:2024010100',
				'old_metric',
				'corrupted_metric'
			);
		});

		it('should delete empty metric keys after cleanup', async () => {
			const metricsData = {
				'old_metric': JSON.stringify({
					name: 'old',
					type: 'counter',
					value: 1,
					timestamp: Date.now() - (8 * 24 * 60 * 60 * 1000), // Very old
				}),
			};

			mockClient.keys.mockResolvedValue(['test_analytics:metrics:2024010100']);
			mockClient.hGetAll.mockResolvedValue(metricsData);
			mockClient.hLen.mockResolvedValue(0); // No metrics remain

			await analyticsTracker.cleanup();

			expect(mockClient.del).toHaveBeenCalledWith('test_analytics:metrics:2024010100');
		});
	});

	describe('Data Export', () => {
		it('should export metrics to JSON', async () => {
			const metricsData = {
				'metric1': JSON.stringify({
					name: 'requests',
					type: 'counter',
					value: 10,
					timestamp: 1704063600000,
				}),
			};

			mockClient.keys.mockResolvedValue(['test_analytics:metrics:2024010100']);
			mockClient.hGetAll.mockResolvedValue(metricsData);

			const exported = await analyticsTracker.exportMetrics();

			expect(exported).toHaveLength(1);
			expect(exported[0]).toMatchObject({
				name: 'requests',
				type: 'counter',
				value: 10,
				timestamp: 1704063600000,
			});
		});

		it('should export metrics with query filters', async () => {
			const metricsData = {
				'counter1': JSON.stringify({
					name: 'requests',
					type: 'counter',
					value: 10,
					timestamp: 1704063600000,
				}),
				'gauge1': JSON.stringify({
					name: 'memory',
					type: 'gauge',
					value: 256,
					timestamp: 1704063600000,
				}),
			};

			mockClient.keys.mockResolvedValue(['test_analytics:metrics:2024010100']);
			mockClient.hGetAll.mockResolvedValue(metricsData);

			const exported = await analyticsTracker.exportMetrics({
				type: 'counter',
			});

			expect(exported).toHaveLength(1);
			expect(exported[0].type).toBe('counter');
		});
	});

	describe('Configuration Management', () => {
		it('should get current configuration', () => {
			const currentConfig = analyticsTracker.getConfig();

			expect(currentConfig).toEqual(expect.objectContaining({
				retentionDays: 7,
				enableRealTimeMetrics: false,
				batchSize: 10,
				flushInterval: 60,
			}));
		});

		it('should update configuration', () => {
			const newConfig = {
				retentionDays: 14,
				batchSize: 50,
				enableHistograms: false,
			};

			analyticsTracker.updateConfig(newConfig);

			const updatedConfig = analyticsTracker.getConfig();
			expect(updatedConfig.retentionDays).toBe(14);
			expect(updatedConfig.batchSize).toBe(50);
			expect(updatedConfig.enableHistograms).toBe(false);
		});

		it('should restart batch processor when real-time settings change', () => {
			const tracker = new AnalyticsTracker(mockRedisManager, {
				enableRealTimeMetrics: true,
			});

			expect(tracker.isActive()).toBe(true);

			// Disable real-time metrics
			tracker.updateConfig({ enableRealTimeMetrics: false });

			expect(tracker.isActive()).toBe(false);

			// Re-enable real-time metrics
			tracker.updateConfig({ enableRealTimeMetrics: true });

			expect(tracker.isActive()).toBe(true);

			tracker.stopBatchProcessor();
		});
	});

	describe('Time Key Generation', () => {
		it('should generate correct time keys', () => {
			const timestamp = new Date('2024-01-15T14:30:45Z').getTime();
			const timeKey = (analyticsTracker as any).generateTimeKey(timestamp);

			expect(timeKey).toBe('2024011514'); // YYYYMMDDHH format
		});

		it('should generate time key ranges', () => {
			const startTime = new Date('2024-01-15T14:30:00Z').getTime();
			const endTime = new Date('2024-01-15T16:15:00Z').getTime();
			
			const timeKeys = (analyticsTracker as any).generateTimeKeys(startTime, endTime);

			expect(timeKeys).toEqual([
				'2024011514',
				'2024011515',
				'2024011516',
			]);
		});

		it('should generate unique metric keys', () => {
			const metric1 = {
				name: 'test',
				type: 'counter',
				value: 1,
				timestamp: 1234567890,
				tags: { service: 'api', version: '1.0' },
			};

			const metric2 = {
				name: 'test',
				type: 'counter',
				value: 1,
				timestamp: 1234567890,
				tags: { version: '1.0', service: 'api' }, // Different order
			};

			const key1 = (analyticsTracker as any).generateMetricKey(metric1);
			const key2 = (analyticsTracker as any).generateMetricKey(metric2);

			expect(key1).toBe(key2); // Should be same due to tag sorting
			expect(key1).toContain('service=api,version=1.0');
		});
	});

	describe('Aggregation Functions', () => {
		const testValues = [1, 2, 3, 4, 5];

		it('should calculate sum aggregation', () => {
			const result = (analyticsTracker as any).calculateAggregation(testValues, 'sum');
			expect(result).toBe(15);
		});

		it('should calculate average aggregation', () => {
			const result = (analyticsTracker as any).calculateAggregation(testValues, 'avg');
			expect(result).toBe(3);
		});

		it('should calculate min aggregation', () => {
			const result = (analyticsTracker as any).calculateAggregation(testValues, 'min');
			expect(result).toBe(1);
		});

		it('should calculate max aggregation', () => {
			const result = (analyticsTracker as any).calculateAggregation(testValues, 'max');
			expect(result).toBe(5);
		});

		it('should calculate count aggregation', () => {
			const result = (analyticsTracker as any).calculateAggregation(testValues, 'count');
			expect(result).toBe(5);
		});

		it('should handle empty values array', () => {
			const result = (analyticsTracker as any).calculateAggregation([], 'sum');
			expect(result).toBe(0);
		});
	});

	describe('Histogram Recording', () => {
		it('should record histogram buckets correctly', async () => {
			const value = 2.5;
			await (analyticsTracker as any).recordHistogram('test_metric', value);

			// Should increment buckets 5, 10, 50, 100 (all >= 2.5)
			expect(mockClient.hSet).toHaveBeenCalledWith(
				expect.any(String),
				expect.stringContaining('test_metric.histogram.5'),
				expect.any(String)
			);

			expect(mockClient.hSet).toHaveBeenCalledWith(
				expect.any(String),
				expect.stringContaining('test_metric.histogram.count'),
				expect.any(String)
			);

			expect(mockClient.hSet).toHaveBeenCalledWith(
				expect.any(String),
				expect.stringContaining('test_metric.histogram.sum'),
				expect.stringContaining('"value":2.5')
			);
		});
	});

	describe('Error Handling', () => {
		it('should handle Redis operation failures', async () => {
			(mockRedisManager.executeOperation as jest.Mock).mockRejectedValueOnce(
				new Error('Redis connection failed')
			);

			await expect(analyticsTracker.recordMetric('test', 1)).rejects.toThrow();
		});

		it('should handle query failures gracefully', async () => {
			mockClient.keys.mockRejectedValueOnce(new Error('Keys operation failed'));

			await expect(analyticsTracker.queryMetrics()).rejects.toThrow();
		});

		it('should handle cleanup failures gracefully', async () => {
			mockClient.keys.mockResolvedValue(['test_key']);
			mockClient.hGetAll.mockRejectedValueOnce(new Error('hGetAll failed'));

			const deletedCount = await analyticsTracker.cleanup();

			// Should complete without throwing, but with 0 deleted
			expect(deletedCount).toBe(0);
		});
	});

	describe('Performance Considerations', () => {
		it('should handle large metric datasets efficiently', async () => {
			// Mock a large dataset
			const largeMetricsData: Record<string, string> = {};
			for (let i = 0; i < 1000; i++) {
				largeMetricsData[`metric${i}`] = JSON.stringify({
					name: `metric${i}`,
					type: 'counter',
					value: i,
					timestamp: Date.now() - i * 1000,
				});
			}

			mockClient.keys.mockResolvedValue(['test_analytics:metrics:2024010100']);
			mockClient.hGetAll.mockResolvedValue(largeMetricsData);

			const startTime = Date.now();
			const results = await analyticsTracker.queryMetrics();
			const endTime = Date.now();

			expect(results).toHaveLength(1000);
			expect(endTime - startTime).toBeLessThan(1000); // Should complete reasonably quickly
		});

		it('should group metrics efficiently by time', () => {
			const metrics = [
				{ name: 'test1', type: 'counter' as MetricType, value: 1, timestamp: 1704063600000 }, // Hour 0
				{ name: 'test2', type: 'counter' as MetricType, value: 2, timestamp: 1704063900000 }, // Hour 0
				{ name: 'test3', type: 'counter' as MetricType, value: 3, timestamp: 1704067200000 }, // Hour 1
			];

			const grouped = (analyticsTracker as any).groupMetricsByTime(metrics);

			expect(grouped.size).toBe(2);
			expect(grouped.get('2024010100')).toHaveLength(2);
			expect(grouped.get('2024010101')).toHaveLength(1);
		});
	});
});