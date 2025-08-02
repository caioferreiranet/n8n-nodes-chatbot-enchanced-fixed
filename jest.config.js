module.exports = {
	preset: 'ts-jest',
	testEnvironment: 'node',
	roots: ['<rootDir>/nodes', '<rootDir>/credentials'],
	testMatch: [
		'**/__tests__/**/*.ts',
		'**/__tests__/**/*.test.ts',
		'**/?(*.)+(spec|test).ts'
	],
	transform: {
		'^.+\\.ts$': 'ts-jest',
	},
	collectCoverageFrom: [
		'nodes/**/*.ts',
		'credentials/**/*.ts',
		'!**/*.d.ts',
		'!**/node_modules/**',
		'!**/__tests__/**',
		'!**/test/**',
	],
	coverageDirectory: 'coverage',
	coverageReporters: ['text', 'lcov', 'html'],
	coverageThreshold: {
		global: {
			branches: 95,
			functions: 95,
			lines: 95,
			statements: 95,
		},
	},
	testTimeout: 30000, // 30 seconds for performance tests
	setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
};