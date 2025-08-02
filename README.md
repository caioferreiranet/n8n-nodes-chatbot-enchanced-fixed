# 🤖 n8n-nodes-chatbot-enhanced

[![npm version](https://badge.fury.io/js/@trigidigital%2Fn8n-nodes-chatbot-enchanced.svg)](https://www.npmjs.com/package/@trigidigital/n8n-nodes-chatbot-enchanced)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

🚀 **Production-ready chatbot enhancement node** for n8n workflows with Redis/Valkey integration.

⚡ **High-performance architecture** supporting **100-200+ operations per second** with enterprise-grade error handling, multi-output streams, and real-time analytics.

🔥 **Key Features:**
- 🛡️ **Smart Rate Limiting** with burst protection and penalty systems
- 💾 **Session Management** with context storage and automatic cleanup  
- ⏱️ **Message Buffering** with **configurable buffer time** (1-3600 seconds)
- 🧠 **Smart Memory** for conversation, FAQ, and context management
- 🔀 **Message Routing** with multi-channel support and load balancing
- 👤 **User Storage** for profiles, preferences, and history
- 📊 **Real-time Analytics** with performance monitoring and alerts

[Installation](#installation)  
[Operations](#operations)  
[Credentials](#credentials)  
[Compatibility](#compatibility)  
[Usage](#usage)  
[Resources](#resources)  
[Version history](#version-history)

## Installation

Follow the [installation guide](https://docs.n8n.io/integrations/community-nodes/installation/) in the n8n community nodes documentation.

Install the package in your n8n installation:

```bash
# In your n8n installation directory
npm install @trigidigital/n8n-nodes-chatbot-enchanced
```

Or install directly from npm registry:
```bash
npm install -g @trigidigital/n8n-nodes-chatbot-enchanced
```

## Operations

The ChatBot Enhanced node supports the following operations:

### 🎯 Template-Based Operations (Quick Setup)
- 🚀 **Basic Rate Limiting**: Simple spam protection (2-minute setup)
- 👥 **Customer Support**: Session management + user storage (5-minute setup)
- 📊 **High Volume Buffer**: Message buffering + analytics for high traffic (5-minute setup)
- 🔀 **Multi-Channel Router**: Full routing + analytics for multi-channel bots (15-minute setup)
- 🧠 **Smart FAQ Memory**: Smart memory + routing for FAQ systems (10-minute setup)

### ⚙️ Advanced Operations (Manual Configuration)
- 🛡️ **Smart Rate Limiting**: Advanced rate limiting with burst detection, penalties, and sliding window algorithms
- 💾 **Session Management**: Comprehensive user session tracking with timeout, cleanup, and conversation history
- ⏱️ **Message Buffering**: **CRITICAL FEATURE** - Time-based message buffering with configurable flush intervals (1-3600 seconds), size limits, and multiple buffer patterns (collect_send, throttle, priority)
- 🧠 **Smart Memory**: Intelligent conversation memory, FAQ storage, and context management with compression and TTL
- 🔀 **Message Routing**: Multi-channel routing with topic-based, priority-based, and load-balancing strategies
- 👤 **User Storage**: Secure user profile, preferences, and history storage with type detection and indexing
- 📊 **Analytics**: Real-time metrics tracking, performance monitoring, alerts, and histogram generation

### 🔄 Multiple Outputs (Enterprise Architecture)
The node provides **4 distinct outputs** for different data streams:
1. ✅ **Success**: Successfully processed messages and operation results
2. 🔄 **Processed**: Messages that have been transformed, enriched, or buffered
3. ❌ **Error**: Error handling, failed operations, and Redis connection issues
4. 📊 **Metrics**: Real-time performance metrics, analytics data, system health, and alerts

### 🚀 Performance Specifications
- **Throughput**: 100-200+ operations per second
- **Latency**: 3-10ms average response time
- **Reliability**: Enterprise-grade error handling and retry mechanisms
- **Scalability**: Supports Redis clusters and high-availability setups
- **Memory**: Efficient memory usage with compression and cleanup

## Credentials

To use this node, you need to set up Redis API credentials. The node supports multiple Redis connection types:

### Prerequisites
- A running Redis or Valkey server (version 6.0+ recommended)
- Network access to your Redis instance
- Appropriate authentication credentials if required

### Available Authentication Methods

1. **Standard Connection**: Direct connection to a single Redis instance
   - Host and port configuration
   - Optional database selection (0-15)

2. **Redis Cluster**: Connection to a Redis cluster setup
   - Multiple host:port pairs for cluster nodes
   - Automatic node discovery and failover

3. **Redis Sentinel**: Connection through Redis Sentinel for high availability
   - Sentinel host:port pairs
   - Master instance name configuration

### Authentication Options
- **None**: No authentication required
- **Password Only**: Redis AUTH command with password
- **Username & Password**: Redis 6.0+ ACL authentication

### Security Features
- **SSL/TLS encryption** support with certificate validation
- **Connection options** including timeouts, retry logic, and keep-alive
- **Advanced SSL configuration** with custom certificates and keys

### Connection Testing
The credential configuration includes automatic connection testing to validate your Redis setup before using the node.

## Compatibility

- **Minimum n8n version**: 1.0.0
- **Node.js version**: 20.15 or higher
- **Redis/Valkey version**: 6.0 or higher (recommended)
- **Tested against**: n8n versions 1.0.0+

### Known Compatibility Issues
- Redis versions below 6.0 may not support username/password authentication
- Some advanced features require Redis 6.2+ for optimal performance
- SSL/TLS features require proper certificate configuration

## 💡 Usage

### 🚀 Quick Start (Template Mode)

1. **Add Redis Credentials**: Configure your Redis connection in n8n credentials
2. **Add ChatBot Enhanced Node**: Drag the node into your workflow  
3. **Select Template**: Choose from 5 pre-configured templates
4. **Configure Basic Parameters**:
   - Session Key: `={{$json.userId || $json.sessionId}}`
   - Message Content: `={{$json.message || $json.text}}`
5. **Connect Outputs**: Wire Success, Processed, Error, and Metrics outputs

### ⚙️ Advanced Setup (Manual Configuration)

1. **Disable Template Mode**: Set "Configuration Mode" to "Advanced Configuration"
2. **Choose Operation**: Select from 7 advanced operations
3. **Configure Operation-Specific Parameters**:
   - **Buffer Time**: 1-3600 seconds for message buffering
   - **Rate Limits**: Requests per minute with burst protection
   - **Session Timeouts**: Minutes for session management
   - **Memory Types**: Conversation, FAQ, or context storage
4. **Fine-tune Performance**: Adjust batch sizes, TTL, compression settings

### Template Usage

For quick setup, use the template options:

- **Basic Rate Limiting**: Perfect for simple spam protection
  - Configure session key (user ID)
  - Set message content field
  - Default rate limiting rules apply

- **Session Management**: Ideal for conversation tracking
  - Maintains user session state
  - Tracks conversation context
  - Automatic session cleanup

### Advanced Configuration

For complex scenarios, disable templates and configure individual operations:

1. Set `Use Template` to false
2. Choose specific operation type
3. Configure advanced parameters based on operation
4. Connect appropriate outputs to downstream nodes

### Output Handling

Connect the four outputs to handle different scenarios:
- **Success output**: Continue normal flow processing
- **Processed output**: Handle transformed/enriched data
- **Error output**: Implement error handling and recovery
- **Metrics output**: Monitor performance and trigger alerts

### Expression Usage

The node supports n8n expressions for dynamic configuration:
```javascript
// Session key from incoming data
={{$json.userId || $json.sessionId || "anonymous"}}

// Message content from various fields
={{$json.message || $json.text || $json.content}}
```

### 🎯 Buffer Time Feature (Key Highlight)

⏱️ **Configurable Message Buffering** - The critical feature for high-volume scenarios:

```javascript
// Example: Buffer messages for 30 seconds
Buffer Time: 30
Time Unit: seconds
Buffer Size: 100
Buffer Pattern: collect_send
```

**Use Cases:**
- **High-frequency messages**: Batch process chat bursts
- **API rate limiting**: Buffer requests to avoid API limits  
- **Cost optimization**: Reduce downstream processing costs
- **Analytics batching**: Aggregate data before analysis

### 🏗️ Architecture & Performance

**Multi-Manager Architecture:**
- 🔧 **RedisManager**: Connection handling with auto-retry and health checks
- 🛡️ **RateLimiter**: Sliding window with burst detection and penalties
- 💾 **SessionManager**: Context storage with TTL and cleanup
- 📦 **MessageBuffer**: Time/size-based buffering with multiple patterns
- 🧠 **SmartMemory**: Conversation and FAQ storage with compression
- 🔀 **MessageRouter**: Multi-channel routing with load balancing
- 👤 **UserStorage**: Profile and preference management
- 📊 **AnalyticsTracker**: Real-time metrics with histogram generation

**Performance Optimizations:**
- Connection pooling for high-volume scenarios
- Batch processing for Redis operations
- Memory compression for large datasets
- TTL-based automatic cleanup
- Health monitoring and alerting

## Resources

- [n8n community nodes documentation](https://docs.n8n.io/integrations/#community-nodes)
- [Redis Documentation](https://redis.io/docs/)
- [Valkey Documentation](https://valkey.io/docs/)
- [n8n Expression Reference](https://docs.n8n.io/code/expressions/)
- [Node.js Redis Client](https://github.com/redis/node-redis)

## Version history

### 0.1.0 (Current)
- Initial release with core chatbot enhancement features
- Redis/Valkey integration with comprehensive connection options
- Template-based quick setup for common scenarios
- Advanced operation types for complex use cases
- Multiple output streams for different data types
- Comprehensive credential management with SSL/TLS support
- Built-in testing framework and validation
- Production-ready architecture with error handling
