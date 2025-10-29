# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is an n8n community node package that provides advanced chatbot functionality with Redis integration. The package includes two main nodes:

1. **ChatBot Enhanced** (Regular Node): Message buffering, spam detection, and rate limiting
2. **ChatBot Enhanced - Trigger** (Trigger Node): Real-time Redis keyspace notification monitoring

**Key Technologies:**
- TypeScript with strict mode
- n8n node development framework
- Redis client library (v5.6.1+)
- Jest for testing
- Gulp for build tasks

## Development Commands

### Building
```bash
npm run build          # Full production build (clean + compile + icons)
npm run dev            # Watch mode for development
```

### Testing
```bash
npm test               # Run all Jest tests
npm run lint           # Lint code with ESLint
npm run lintfix        # Auto-fix linting issues
npm run format         # Format code with Prettier
```

### Publishing
```bash
npm run prepublishOnly # Pre-publish checks (build + strict lint)
```

**Note:** The build process uses `gulp build:icons` to copy SVG icons to the dist folder.

## Architecture Overview

### Core Components

The codebase follows a manager-based architecture where specialized managers handle different aspects of chatbot functionality:

#### 1. **RedisManager** (`managers/RedisManager.ts`)
- Base class for Redis connection management
- Handles connection lifecycle, health checks, and reconnection
- Implements anti-infinite-loop patterns with connection timeouts
- Provides simple get/set/delete operations with TTL support
- **Critical:** Uses `reconnectStrategy: false` to prevent hanging connections

#### 2. **SpamDetector** (`managers/SpamDetector.ts`)
- Hash-based message similarity detection using crypto module
- Three detection types: `repeated`, `flood`, `pattern`
- Configurable actions: `block`, `delay`, `mark`
- Predefined patterns: URLs, caps, repeated chars, phones, emails
- Stores message history in Redis with configurable time windows

#### 3. **RateLimiter** (`managers/RateLimiter.ts`)
- Three algorithms: `token_bucket`, `sliding_window`, `fixed_window`
- Four strategies: `per_user`, `per_ip`, `per_session`, `global`
- Token bucket supports burst limits
- Stores state in Redis with automatic cleanup

#### 4. **RedisTriggerManager** (`managers/RedisTriggerManager.ts`)
- Extends RedisManager for pub/sub functionality
- Creates dedicated subscriber client for keyspace notifications
- Implements token bucket rate limiting for events
- Maintains value cache for DEL events (1-minute TTL)
- Auto-reconnection with exponential backoff

### Node Structure

Both nodes follow n8n's node development patterns:

- **`ChatBotEnhanced.node.ts`**: Main node with three operations (Buffer Message, Spam Detection, Rate Limit)
- **`ChatBotEnhancedRedisTrigger.node.ts`**: Trigger node for Redis keyspace events
- **Three outputs**: Success (0), Spam (1), Process (2)

### Buffer Message Operation - TimedBuffer Pattern

The Buffer Message operation implements a "Master-Slave execution" pattern:

- **Master Execution**: First message creates buffer, waits for timer, collects all messages
- **Slave Executions**: Subsequent messages extend timer, add to buffer, return immediately
- Uses Redis to store buffer state with TTL
- Integrated anti-spam filtering: spam messages are blocked before reaching the buffer

**Redis Key Pattern:** `chatbot:buffer:{sessionId}`

### Redis Keyspace Notifications

The trigger node leverages Redis's native keyspace notifications:

- Requires `notify-keyspace-events KEA` configuration (auto-configured)
- Subscribes to `__keyspace@{db}__:{pattern}` channels
- Supports glob patterns (`*`, `?`, `**`) for flexible key monitoring
- Event types: SET, DEL, EXPIRED, EVICTED
- **Production Warning:** Never use `*` wildcard - always use specific patterns

## TypeScript Configuration

- Target: ES2019 with CommonJS modules
- Strict mode enabled with comprehensive checks
- Output: `./dist/` directory
- Includes: `credentials/**/*`, `nodes/**/*`
- Excludes: Test files and type checking scripts

## Testing Standards

Jest is configured with strict coverage requirements:

- **Coverage Threshold:** 95% for branches, functions, lines, and statements
- **Test Timeout:** 30 seconds (for performance tests)
- **Test Location:** `nodes/**/__tests__/**/*.test.ts`

Run specific tests:
```bash
npm test -- RateLimiter.test.ts
npm test -- --coverage
```

## Redis Credentials

The node uses n8n's built-in Redis credential system. Expected credential structure:

```typescript
{
  host: string;
  port: number;
  ssl?: boolean;
  database: number;
  user?: string;
  password?: string;
}
```

**Supported Providers:**
- Redis 6.0+ (open source)
- Valkey 7.2+ (recommended for self-hosted)
- Upstash (cloud, requires SSL)

## Common Patterns

### Creating a Manager Instance

```typescript
const redisManager = new RedisManager(credentials, { connectionTimeout: 5000 });
await redisManager.ensureConnected();
```

### Handling Buffer State

```typescript
interface BufferState {
  exp: number;           // Expiration timestamp
  data: BufferedMessage[];
  sessionId: string;
  totalCount: number;
}
```

### Rate Limiting Check

```typescript
const rateLimiter = new RateLimiter(redisManager, {
  algorithm: 'token_bucket',
  strategy: 'per_user',
  windowSize: 60,
  maxRequests: 10,
  burstLimit: 15
});

const result = await rateLimiter.checkLimit(identifier);
```

### Spam Detection

```typescript
const spamDetector = new SpamDetector(redisManager);
const result = await spamDetector.detectSpam(message, {
  detectionType: 'repeated',
  action: 'block',
  similarityThreshold: 80,
  userId: 'user123',
  sessionId: 'session123'
});
```

## Important Implementation Details

### Connection Management
- Always use `ensureConnected()` before Redis operations
- Connection timeouts prevent infinite loops
- Health checks run every 5 seconds
- No automatic reconnection in base RedisManager (by design)

### Error Handling
- Use `NodeOperationError` from n8n-workflow for user-facing errors
- Include context in error messages (operation, sessionId, etc.)
- Graceful degradation when Redis is unavailable

### Output Routing
The node has three outputs - use `outputIndex` to route data:
- `0`: Success output (clean messages, allowed requests)
- `1`: Spam output (detected spam, rate limit violations)
- `2`: Process output (buffer status, metadata)

### Memory Management
- Value cache in RedisTriggerManager limited to 1-minute TTL
- Regular cleanup of expired Redis keys via TTL
- Token bucket refills calculated dynamically

## n8n-Specific Considerations

### Node Properties
- Use `displayOptions` to conditionally show parameters
- Set `noDataExpression: true` for operation/resource selectors
- Always provide `description` and `default` values

### Credentials
- Reference credentials with `name: 'redis'` and `required: true`
- Credentials are accessed via `this.getCredentials('redis')`

### Execution Context
- Use `IExecuteFunctions` for node execution context
- Access input data with `this.getInputData()`
- Return data with proper output array structure

### Version Management
- Node version is currently `1` (see `version: 1` in node description)
- Version increments require careful migration planning

## Building for Production

The build process:
1. Cleans `dist/` directory with rimraf
2. Compiles TypeScript to CommonJS
3. Copies SVG icons via gulp
4. Runs strict ESLint checks before publishing

**Dist Structure:**
```
dist/
├── nodes/
│   └── ChatBotEnhanced/
│       ├── ChatBotEnhanced.node.js
│       ├── ChatBotEnhancedRedisTrigger.node.js
│       ├── managers/
│       ├── types.js
│       └── *.svg
```

## Performance Considerations

- **Target Throughput:** 100-200+ operations per second
- **Latency:** 10-50ms average (including Redis I/O)
- **Trigger Latency:** <100ms from Redis change to workflow activation
- **Memory:** ~5-15MB per active session buffer
- **Connections:** 2 Redis connections per trigger (main + subscriber)

## Debugging Tips

Enable verbose logging by setting `includeMetadata: true` in trigger configuration. Look for these log patterns:
- "🔥 REDIS EVENT RECEIVED" - Event processing
- "📝 PARSED EVENT DATA" - Event parsing
- "💾 Using cached value" - Cache hits
- "🚦 EVENT FILTERED" - Rate limiting active
