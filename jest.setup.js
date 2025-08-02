// Jest setup file for n8n Chatbot Enhanced Node tests

// Increase timeout for performance tests
jest.setTimeout(30000);

// Mock console methods to reduce noise in tests
global.console = {
	...console,
	// Uncomment below to silence console logs during testing
	// log: jest.fn(),
	// warn: jest.fn(),
	// error: jest.fn(),
	// info: jest.fn(),
};

// Setup global test utilities
global.performance = global.performance || {
	now: () => Date.now(),
};

// Mock process.memoryUsage for performance tests
if (!process.memoryUsage.mockReturnValue) {
	const originalMemoryUsage = process.memoryUsage;
	process.memoryUsage = jest.fn().mockReturnValue({
		rss: 100 * 1024 * 1024, // 100MB
		heapTotal: 50 * 1024 * 1024, // 50MB
		heapUsed: 30 * 1024 * 1024, // 30MB
		external: 10 * 1024 * 1024, // 10MB
		arrayBuffers: 5 * 1024 * 1024, // 5MB
	});
	
	// Restore original for when we need real memory usage
	process.memoryUsage.original = originalMemoryUsage;
}

// Setup fake timers configuration
global.beforeEach(() => {
	// Reset all mocks before each test
	jest.clearAllMocks();
});

// Add custom matchers for better testing
expect.extend({
	toBeWithinRange(received, floor, ceiling) {
		const pass = received >= floor && received <= ceiling;
		if (pass) {
			return {
				message: () => `expected ${received} not to be within range ${floor} - ${ceiling}`,
				pass: true,
			};
		} else {
			return {
				message: () => `expected ${received} to be within range ${floor} - ${ceiling}`,
				pass: false,
			};
		}
	},
});