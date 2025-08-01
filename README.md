# n8n-nodes-chatbot-enchanced

This is an n8n community node. It lets you use enhanced chatbot capabilities with Redis/Valkey integration in your n8n workflows.

ChatBot Enhanced provides advanced chatbot functionality including rate limiting, session management, message buffering, smart memory, message routing, user storage, and analytics. It uses Redis or Valkey as the backend for high-performance data operations and is designed for production chatbot applications.

[n8n](https://n8n.io/) is a [fair-code licensed](https://docs.n8n.io/reference/license/) workflow automation platform.

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

### Template-Based Operations
- **Basic Rate Limiting**: Simple rate limiting to prevent spam and abuse
- **Session Management**: User session tracking with context and conversation history

### Advanced Operations
- **Smart Rate Limiting**: Advanced rate limiting with burst protection and penalty systems
- **Session Management**: Comprehensive user session tracking with timeout and cleanup
- **Message Buffering**: Batch message processing with configurable flush intervals
- **Smart Memory**: Intelligent conversation, FAQ, and context memory management
- **Message Routing**: Multi-channel message routing with various strategies
- **User Storage**: Secure user profile, preferences, and history storage
- **Analytics**: Real-time metrics tracking and performance monitoring

### Multiple Outputs
The node provides four distinct outputs for different types of data:
1. **Success**: Successfully processed messages and results
2. **Processed**: Messages that have been transformed or enriched
3. **Error**: Error handling and failed operations
4. **Metrics**: Performance metrics, analytics, and system health data

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

## Usage

### Basic Setup

1. **Add Redis Credentials**: Configure your Redis connection in n8n credentials
2. **Add ChatBot Enhanced Node**: Drag the node into your workflow
3. **Configure Parameters**: Set up session key and message content
4. **Choose Operation**: Select template or advanced operation type

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

### Performance Considerations

- Use connection pooling for high-volume scenarios
- Configure appropriate Redis memory limits
- Monitor metrics output for performance insights
- Implement proper error handling for Redis connectivity issues

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
