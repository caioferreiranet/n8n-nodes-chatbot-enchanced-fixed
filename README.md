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

The ChatBot Enhanced node uses a **Resource/Operation pattern** for easy discovery and organized functionality:

### 🛡️ Rate Limiting Actions
**Smart rate limiting with burst protection and penalties**
- **Check Rate Limit**: Verify if user is within rate limits and get remaining quota
- **Reset User Limits**: Clear rate limiting counters for specific user  
- **Get Limit Status**: Retrieve comprehensive rate limiting statistics

### 👥 Session Actions  
**User session management and storage operations**
- **Create Session**: Initialize a new user session with context storage
- **Update Session**: Add message to session and extend timeout
- **Get Session Data**: Retrieve session information and conversation history
- **Store User Data**: Save user preferences, history and profile information

### 💬 Message Actions
**Message buffering and routing for human-like responses**  
- **Buffer Messages**: **CRITICAL FEATURE** - Collect multiple messages and flush after time delay (TimedBuffer implementation)
- **Route Messages**: Direct messages to appropriate channels or queues
- **Process Queue**: Handle queued messages with priority and load balancing

### 📊 Analytics Actions
**Smart memory, metrics tracking and performance monitoring**
- **Track Event**: Record custom events for analytics and monitoring
- **Query Metrics**: Retrieve analytics data and performance statistics  
- **Store Memory**: Save conversation context, FAQ or knowledge data
- **Generate Report**: Create comprehensive performance and usage reports

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

### 🚀 Quick Start (Resource/Operation Pattern)

1. **Add Redis Credentials**: Configure your Redis connection in n8n credentials
2. **Add ChatBot Enhanced Node**: Drag the node into your workflow  
3. **Select Resource**: Choose from 4 action categories:
   - **Rate Limiting Actions**: For spam protection and user quotas
   - **Session Actions**: For user session management and storage
   - **Message Actions**: For buffering and routing (human-like responses)
   - **Analytics Actions**: For metrics, memory, and performance monitoring
4. **Choose Operation**: Select specific action within the resource category
5. **Configure Parameters**:
   - Session Key: `={{$json.userId || $json.sessionId}}`
   - Message Content: `={{$json.message || $json.text}}`
   - Resource-specific settings (buffer time, rate limits, etc.)
6. **Connect Outputs**: Wire Success, Processed, Error, and Metrics outputs

### ⚙️ Advanced Configuration Tips

- **Buffer Time**: 1-3600 seconds for message buffering (human-like delays)
- **Rate Limits**: Requests per minute with burst protection  
- **Session Timeouts**: Minutes for session management
- **Resource Planning**: Each buffering session = 1 long-running execution

### Resource/Operation Examples

**Rate Limiting Actions Example:**
```javascript
Resource: "Rate Limiting Actions"
Operation: "Check Rate Limit"
Session Key: ={{$json.userId}}
Rate Limit: 10 // requests per minute
```

**Message Buffering Example:**
```javascript
Resource: "Message Actions"  
Operation: "Buffer Messages"
Session Key: ={{$json.userId}}
Message Content: ={{$json.message}}
Buffer Time: 10 // seconds - creates human-like delays
```

**Session Management Example:**
```javascript
Resource: "Session Actions"
Operation: "Update Session"
Session Key: ={{$json.userId}}
Message Content: ={{$json.message}}
Session Timeout: 30 // minutes
```

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

### 🎯 Message Buffering - Human-Like Response (NEW in v0.1.2!)

⏱️ **Revolutionary TimedBuffer Implementation** - The FLAGSHIP feature for human-like chatbot responses:

#### 🧠 How It Works (TimedBuffer Logic)
```javascript
// REAL BEHAVIOR (not just background optimization):

Chat 1: "Hello"                → Master Execution: Start 10s timer, wait...
Chat 2: "How are you?"         → Slave Execution: Add to buffer, extend timer, return "pending"
Chat 3: "What's your name?"    → Slave Execution: Add to buffer, extend timer, return "pending"

After 10 seconds              → Master Execution: Return ALL MESSAGES together!
// Output: ["Hello", "How are you?", "What's your name?"]
```

#### 🔄 Execution Pattern
- **Master Execution**: First message creates buffer, waits for timer, collects all messages
- **Slave Executions**: Subsequent messages extend timer, add to buffer, return immediately
- **Natural Delay**: Human-like response delay (not instant robot replies)
- **Batch Collection**: All messages returned together after timeout

#### ⚙️ Configuration
```javascript
Buffer Time: 10           // Wait 10 seconds before responding
Session Key: {{$json.userId}}  // Group messages by user
Message: {{$json.message}}     // Content to buffer
```

#### 🎯 Perfect For:
- **Human-like Chatbots**: Wait for multiple messages before responding (like humans do)
- **Conversation Context**: Collect user's complete thought before processing
- **Natural UX**: Avoid instant robot-like responses
- **WhatsApp/Telegram Style**: Mimic how humans read 2-3 messages then respond

#### ⚠️ Production Requirements:
- **Execution Timeout**: Set workflow timeout to 60 seconds
- **Redis Monitoring**: Health checks for buffer persistence
- **Resource Planning**: Each session = 1 long-running execution
- **Traffic Limits**: Optimal for 5-50 concurrent users

#### 📊 Response Types:
```json
// Buffered (Chat 2,3,4...)
{"type": "buffered", "status": "pending", "message": "How are you?"}

// Batch Ready (After timer)
{"type": "batch_ready", "status": "flushed", "messages": ["Hello", "How are you?", "What's your name?"]}
```

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

### 0.1.3 (Current) - Resource/Operation Pattern & Actions Section

- 🎯 **NEW UI PATTERN**: Implemented Resource/Operation pattern for better discoverability
- 📋 **Actions Section**: Community node now displays organized actions like professional nodes
- 🛡️ **Rate Limiting Actions**: Check Rate Limit, Reset User Limits, Get Limit Status
- 👥 **Session Actions**: Create Session, Update Session, Get Session Data, Store User Data  
- 💬 **Message Actions**: Buffer Messages, Route Messages, Process Queue
- 📊 **Analytics Actions**: Track Event, Query Metrics, Store Memory, Generate Report
- 🏗️ **Clean Architecture**: Removed legacy template system, streamlined configuration
- ✨ **Enhanced UX**: Better organization and professional appearance in n8n interface

### 0.1.2 - Major Message Buffering Update
- 🚀 **REVOLUTIONARY**: Complete Message Buffering rewrite with TimedBuffer implementation
- 🧠 **Human-like Response**: Master/Slave execution pattern for natural conversation delays
- ⏱️ **Timer Extension**: New messages extend buffer time for natural flow
- 🎯 **Batch Collection**: All messages returned together after timeout (not individual responses)
- 📊 **Enhanced Output**: Clear distinction between "buffered" and "batch_ready" responses
- 🔧 **Production Ready**: Comprehensive error handling, cancellation support, resource management
- 📚 **Complete Documentation**: Detailed tutorials, edge cases, production requirements
- ✅ **100% Test Coverage**: All 7 features tested and verified

### 0.1.1
- Bug fixes and performance improvements
- Enhanced error handling for Redis connections
- Updated documentation and examples

### 0.1.0
- Initial release with core chatbot enhancement features
- Redis/Valkey integration with comprehensive connection options
- Template-based quick setup for common scenarios
- Advanced operation types for complex use cases
- Multiple output streams for different data types
- Comprehensive credential management with SSL/TLS support
- Built-in testing framework and validation
- Production-ready architecture with error handling
