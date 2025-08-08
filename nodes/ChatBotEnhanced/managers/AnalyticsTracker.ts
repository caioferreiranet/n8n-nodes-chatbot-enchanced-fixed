// Removed unused imports
import { RedisManager } from './RedisManager';

export type MetricType = 'counter' | 'gauge' | 'histogram' | 'timer';
export type AggregationType = 'sum' | 'avg' | 'min' | 'max' | 'count';

export interface AnalyticsConfig {
	retentionDays: number;
	enableRealTimeMetrics: boolean;
	batchSize: number;
	flushInterval: number; // in seconds
	keyPrefix?: string;
	enableHistograms: boolean;
	histogramBuckets?: number[];
}

export interface Metric {
	name: string;
	type: MetricType;
	value: number;
	timestamp: number;
	tags?: Record<string, string>;
	metadata?: Record<string, any>;
}

export interface MetricQuery {
	name?: string;
	type?: MetricType;
	startTime?: number;
	endTime?: number;
	tags?: Record<string, string>;
	aggregation?: AggregationType;
	interval?: number; // in seconds
	limit?: number;
}

export interface MetricResult {
	name: string;
	type: MetricType;
	value: number;
	timestamp: number;
	tags?: Record<string, string>;
}

export interface AnalyticsStats {
	totalMetrics: number;
	metricsPerType: Record<MetricType, number>;
	oldestMetric: number;
	newestMetric: number;
	storageSize: number; // approximate bytes
	retentionRate: number; // percentage of metrics within retention period
}

export interface PerformanceMetrics {
	processingTime: number;
	memoryUsage: number;
	redisLatency: number;
	queueSize: number;
	errorRate: number;
	throughput: number; // requests per second
}

export class AnalyticsTracker {
	private redisManager: RedisManager;
	private config: AnalyticsConfig;
	private keyPrefix: string;
	private metricBuffer: Metric[] = [];
	private flushTimer: NodeJS.Timeout | null = null;
	private isRunning: boolean = false;

	constructor(redisManager: RedisManager, config: Partial<AnalyticsConfig> = {}) {
		this.redisManager = redisManager;
		this.config = {
			retentionDays: 30,
			enableRealTimeMetrics: true,
			batchSize: 100,
			flushInterval: 60, // 1 minute
			keyPrefix: 'analytics',
			enableHistograms: true,
			histogramBuckets: [0.1, 0.5, 1, 2.5, 5, 10, 25, 50, 100, 250, 500, 1000],
			...config,
		};
		this.keyPrefix = this.config.keyPrefix!;

		if (this.config.enableRealTimeMetrics) {
			this.startBatchProcessor();
		}
	}

	/**
	 * Record a metric
	 */
	async recordMetric(
		name: string,
		value: number,
		type: MetricType = 'counter',
		tags?: Record<string, string>,
		metadata?: Record<string, any>
	): Promise<void> {
		const metric: Metric = {
			name,
			type,
			value,
			timestamp: Date.now(),
			tags,
			metadata,
		};

		if (this.config.enableRealTimeMetrics) {
			// Add to buffer for batch processing
			this.metricBuffer.push(metric);
			
			if (this.metricBuffer.length >= this.config.batchSize) {
				await this.flushBuffer();
			}
		} else {
			// Store immediately
			await this.storeMetric(metric);
		}
	}

	/**
	 * Record multiple metrics at once
	 */
	async recordMetrics(metrics: Omit<Metric, 'timestamp'>[]): Promise<void> {
		const timestampedMetrics = metrics.map(metric => ({
			...metric,
			timestamp: Date.now(),
		}));

		if (this.config.enableRealTimeMetrics) {
			this.metricBuffer.push(...timestampedMetrics);
			
			if (this.metricBuffer.length >= this.config.batchSize) {
				await this.flushBuffer();
			}
		} else {
			for (const metric of timestampedMetrics) {
				await this.storeMetric(metric);
			}
		}
	}

	/**
	 * Increment a counter
	 */
	async increment(
		name: string,
		value: number = 1,
		tags?: Record<string, string>
	): Promise<void> {
		await this.recordMetric(name, value, 'counter', tags);
	}

	/**
	 * Set a gauge value
	 */
	async gauge(
		name: string,
		value: number,
		tags?: Record<string, string>
	): Promise<void> {
		await this.recordMetric(name, value, 'gauge', tags);
	}

	/**
	 * Record a timer/duration
	 */
	async timing(
		name: string,
		duration: number,
		tags?: Record<string, string>
	): Promise<void> {
		await this.recordMetric(name, duration, 'timer', tags);
		
		// Also record histogram if enabled
		if (this.config.enableHistograms) {
			await this.recordHistogram(name, duration, tags);
		}
	}

	/**
	 * Record performance metrics
	 */
	async recordPerformance(metrics: PerformanceMetrics, tags?: Record<string, string>): Promise<void> {
		const performanceMetrics = [
			{ name: 'performance.processing_time', value: metrics.processingTime, type: 'timer' as MetricType },
			{ name: 'performance.memory_usage', value: metrics.memoryUsage, type: 'gauge' as MetricType },
			{ name: 'performance.redis_latency', value: metrics.redisLatency, type: 'gauge' as MetricType },
			{ name: 'performance.queue_size', value: metrics.queueSize, type: 'gauge' as MetricType },
			{ name: 'performance.error_rate', value: metrics.errorRate, type: 'gauge' as MetricType },
			{ name: 'performance.throughput', value: metrics.throughput, type: 'gauge' as MetricType },
		];

		for (const metric of performanceMetrics) {
			await this.recordMetric(metric.name, metric.value, metric.type, tags);
		}
	}

	/**
	 * Query metrics
	 */
	async queryMetrics(query: MetricQuery = {}): Promise<MetricResult[]> {
		return this.redisManager.executeOperation(async (client) => {
			const results: MetricResult[] = [];
			
			// Determine time range
			const endTime = query.endTime || Date.now();
			const startTime = query.startTime || (endTime - 24 * 60 * 60 * 1000); // Default: last 24 hours

			// Generate time-based keys to search
			const timeKeys = this.generateTimeKeys(startTime, endTime);
			
			for (const timeKey of timeKeys) {
				const metricsKey = `${this.keyPrefix}:metrics:${timeKey}`;
				const metrics = await client.hGetAll(metricsKey);
				
				for (const [, metricData] of Object.entries(metrics)) {
					try {
						const metric: Metric = JSON.parse(metricData);
						
						// Apply filters
						if (query.name && metric.name !== query.name) continue;
						if (query.type && metric.type !== query.type) continue;
						if (metric.timestamp < startTime || metric.timestamp > endTime) continue;
						
						// Check tag filters
						if (query.tags) {
							let tagMatch = true;
							for (const [tagKey, tagValue] of Object.entries(query.tags)) {
								if (!metric.tags || metric.tags[tagKey] !== tagValue) {
									tagMatch = false;
									break;
								}
							}
							if (!tagMatch) continue;
						}
						
						results.push({
							name: metric.name,
							type: metric.type,
							value: metric.value,
							timestamp: metric.timestamp,
							tags: metric.tags,
						});
						
					} catch (error) {
						
					}
				}
			}

			// Sort by timestamp
			results.sort((a, b) => a.timestamp - b.timestamp);

			// Apply aggregation if requested
			if (query.aggregation && results.length > 0) {
				return this.aggregateResults(results, query.aggregation, query.interval);
			}

			// Apply limit
			if (query.limit) {
				return results.slice(0, query.limit);
			}

			return results;
		});
	}

	/**
	 * Get analytics statistics
	 */
	async getStats(): Promise<AnalyticsStats> {
		return this.redisManager.executeOperation(async (client) => {
			const now = Date.now();
			const retentionMs = this.config.retentionDays * 24 * 60 * 60 * 1000;
			
			let totalMetrics = 0;
			const metricsPerType: Record<MetricType, number> = {
				counter: 0,
				gauge: 0,
				histogram: 0,
				timer: 0,
			};
			let oldestMetric = now;
			let newestMetric = 0;
			let storageSize = 0;
			let metricsInRetention = 0;

			// Scan through time-based keys
			const pattern = `${this.keyPrefix}:metrics:*`;
			const keys = await client.keys(pattern);

			for (const key of keys) {
				try {
					const metrics = await client.hGetAll(key);
					const keySize = JSON.stringify(metrics).length;
					storageSize += keySize;

					for (const metricData of Object.values(metrics)) {
						try {
							const metric: Metric = JSON.parse(metricData);
							totalMetrics++;
							metricsPerType[metric.type]++;

							oldestMetric = Math.min(oldestMetric, metric.timestamp);
							newestMetric = Math.max(newestMetric, metric.timestamp);

							if (now - metric.timestamp <= retentionMs) {
								metricsInRetention++;
							}
						} catch (error) {
							// Skip invalid metrics
						}
					}
				} catch (error) {
					
				}
			}

			return {
				totalMetrics,
				metricsPerType,
				oldestMetric: oldestMetric === now ? 0 : oldestMetric,
				newestMetric,
				storageSize,
				retentionRate: totalMetrics > 0 ? metricsInRetention / totalMetrics : 0,
			};
		});
	}

	/**
	 * Clean up old metrics based on retention policy
	 */
	async cleanup(): Promise<number> {
		return this.redisManager.executeOperation(async (client) => {
			const cutoffTime = Date.now() - (this.config.retentionDays * 24 * 60 * 60 * 1000);
			let deletedCount = 0;

			const pattern = `${this.keyPrefix}:metrics:*`;
			const keys = await client.keys(pattern);

			for (const key of keys) {
				try {
					const metrics = await client.hGetAll(key);
					const keysToDelete: string[] = [];

					for (const [metricKey, metricData] of Object.entries(metrics)) {
						try {
							const metric: Metric = JSON.parse(metricData);
							if (metric.timestamp < cutoffTime) {
								keysToDelete.push(metricKey);
							}
						} catch (error) {
							// Delete corrupted metrics
							keysToDelete.push(metricKey);
						}
					}

					if (keysToDelete.length > 0) {
						await client.hDel(key, keysToDelete);
						deletedCount += keysToDelete.length;
					}

					// Delete empty keys
					const remainingCount = await client.hLen(key);
					if (remainingCount === 0) {
						await client.del(key);
					}

				} catch (error) {
					
				}
			}

			return deletedCount;
		});
	}

	/**
	 * Export metrics to JSON
	 */
	async exportMetrics(query: MetricQuery = {}): Promise<Metric[]> {
		const results = await this.queryMetrics(query);
		return results.map(result => ({
			name: result.name,
			type: result.type,
			value: result.value,
			timestamp: result.timestamp,
			tags: result.tags,
		}));
	}

	/**
	 * Start batch processor for real-time metrics
	 */
	private startBatchProcessor(): void {
		if (this.flushTimer || !this.config.enableRealTimeMetrics) {
			return;
		}

		this.flushTimer = setInterval(async () => {
			if (this.metricBuffer.length > 0) {
				await this.flushBuffer();
			}
		}, this.config.flushInterval * 1000);

		this.isRunning = true;
	}

	/**
	 * Stop batch processor
	 */
	async stopBatchProcessor(): Promise<void> {
		if (this.flushTimer) {
			clearInterval(this.flushTimer);
			this.flushTimer = null;
		}

		// Flush remaining buffer
		if (this.metricBuffer.length > 0) {
			await this.flushBuffer();
		}

		this.isRunning = false;
	}

	/**
	 * Flush metric buffer to Redis
	 */
	private async flushBuffer(): Promise<void> {
		if (this.metricBuffer.length === 0) {
			return;
		}

		const metricsToFlush = [...this.metricBuffer];
		this.metricBuffer = [];

		try {
			await this.redisManager.executeOperation(async (client) => {
				// Group metrics by time bucket for efficient storage
				const groupedMetrics = this.groupMetricsByTime(metricsToFlush);

				const pipeline = client.multi();
				
				for (const [timeKey, metrics] of groupedMetrics.entries()) {
					const metricsKey = `${this.keyPrefix}:metrics:${timeKey}`;
					
					for (const metric of metrics) {
						const metricKey = this.generateMetricKey(metric);
						pipeline.hSet(metricsKey, metricKey, JSON.stringify(metric));
					}

					// Set TTL for time-based keys
					const ttl = (this.config.retentionDays + 1) * 24 * 60 * 60; // Slightly longer than retention
					pipeline.expire(metricsKey, ttl);
				}

				await pipeline.exec();
			});
		} catch (error) {
			
			// Put metrics back in buffer for retry
			this.metricBuffer.unshift(...metricsToFlush);
		}
	}

	/**
	 * Store a single metric
	 */
	private async storeMetric(metric: Metric): Promise<void> {
		return this.redisManager.executeOperation(async (client) => {
			const timeKey = this.generateTimeKey(metric.timestamp);
			const metricsKey = `${this.keyPrefix}:metrics:${timeKey}`;
			const metricKey = this.generateMetricKey(metric);

			await client.hSet(metricsKey, metricKey, JSON.stringify(metric));

			// Set TTL
			const ttl = (this.config.retentionDays + 1) * 24 * 60 * 60;
			await client.expire(metricsKey, ttl);
		});
	}

	/**
	 * Record histogram values
	 */
	private async recordHistogram(
		name: string,
		value: number,
		tags?: Record<string, string>
	): Promise<void> {
		const buckets = this.config.histogramBuckets || [];
		
		for (const bucket of buckets) {
			if (value <= bucket) {
				await this.recordMetric(
					`${name}.histogram.${bucket}`,
					1,
					'histogram',
					tags
				);
			}
		}

		// Record total count
		await this.recordMetric(`${name}.histogram.count`, 1, 'histogram', tags);
		
		// Record sum for average calculation
		await this.recordMetric(`${name}.histogram.sum`, value, 'histogram', tags);
	}

	/**
	 * Group metrics by time bucket
	 */
	private groupMetricsByTime(metrics: Metric[]): Map<string, Metric[]> {
		const grouped = new Map<string, Metric[]>();

		for (const metric of metrics) {
			const timeKey = this.generateTimeKey(metric.timestamp);
			
			if (!grouped.has(timeKey)) {
				grouped.set(timeKey, []);
			}
			
			grouped.get(timeKey)!.push(metric);
		}

		return grouped;
	}

	/**
	 * Generate time-based key for grouping metrics
	 */
	private generateTimeKey(timestamp: number): string {
		// Group by hour for efficient storage and querying
		const date = new Date(timestamp);
		const year = date.getFullYear();
		const month = String(date.getMonth() + 1).padStart(2, '0');
		const day = String(date.getDate()).padStart(2, '0');
		const hour = String(date.getHours()).padStart(2, '0');
		
		return `${year}${month}${day}${hour}`;
	}

	/**
	 * Generate time keys for a range
	 */
	private generateTimeKeys(startTime: number, endTime: number): string[] {
		const keys: string[] = [];
		const startHour = new Date(startTime);
		startHour.setMinutes(0, 0, 0);
		
		const endHour = new Date(endTime);
		endHour.setMinutes(59, 59, 999);

		const current = new Date(startHour);
		while (current <= endHour) {
			keys.push(this.generateTimeKey(current.getTime()));
			current.setHours(current.getHours() + 1);
		}

		return keys;
	}

	/**
	 * Generate unique metric key
	 */
	private generateMetricKey(metric: Metric): string {
		const tagString = metric.tags 
			? Object.entries(metric.tags)
				.sort(([a], [b]) => a.localeCompare(b))
				.map(([k, v]) => `${k}=${v}`)
				.join(',')
			: '';
		
		return `${metric.name}:${metric.type}:${tagString}:${metric.timestamp}`;
	}

	/**
	 * Aggregate query results
	 */
	private aggregateResults(
		results: MetricResult[],
		aggregation: AggregationType,
		interval?: number
	): MetricResult[] {
		if (!interval) {
			// Single aggregation across all results
			const value = this.calculateAggregation(results.map(r => r.value), aggregation);
			return [{
				name: results[0].name,
				type: results[0].type,
				value,
				timestamp: results[results.length - 1].timestamp,
			}];
		}

		// Time-bucketed aggregation
		const buckets = new Map<number, MetricResult[]>();
		
		for (const result of results) {
			const bucketTime = Math.floor(result.timestamp / (interval * 1000)) * (interval * 1000);
			
			if (!buckets.has(bucketTime)) {
				buckets.set(bucketTime, []);
			}
			
			buckets.get(bucketTime)!.push(result);
		}

		const aggregated: MetricResult[] = [];
		
		for (const [bucketTime, bucketResults] of buckets.entries()) {
			const value = this.calculateAggregation(
				bucketResults.map(r => r.value),
				aggregation
			);
			
			aggregated.push({
				name: bucketResults[0].name,
				type: bucketResults[0].type,
				value,
				timestamp: bucketTime,
			});
		}

		return aggregated.sort((a, b) => a.timestamp - b.timestamp);
	}

	/**
	 * Calculate aggregation value
	 */
	private calculateAggregation(values: number[], aggregation: AggregationType): number {
		if (values.length === 0) return 0;

		switch (aggregation) {
			case 'sum':
				return values.reduce((sum, val) => sum + val, 0);
			case 'avg':
				return values.reduce((sum, val) => sum + val, 0) / values.length;
			case 'min':
				return Math.min(...values);
			case 'max':
				return Math.max(...values);
			case 'count':
				return values.length;
			default:
				return values[values.length - 1]; // Last value
		}
	}

	/**
	 * Get configuration
	 */
	getConfig(): AnalyticsConfig {
		return { ...this.config };
	}

	/**
	 * Update configuration
	 */
	updateConfig(newConfig: Partial<AnalyticsConfig>): void {
		const oldConfig = { ...this.config };
		this.config = { ...this.config, ...newConfig };

		// Restart batch processor if real-time settings changed
		if (oldConfig.enableRealTimeMetrics !== this.config.enableRealTimeMetrics ||
			oldConfig.flushInterval !== this.config.flushInterval) {
			
			if (this.isRunning) {
				this.stopBatchProcessor();
			}
			
			if (this.config.enableRealTimeMetrics) {
				this.startBatchProcessor();
			}
		}
	}

	/**
	 * Check if analytics is running
	 */
	isActive(): boolean {
		return this.isRunning;
	}
}