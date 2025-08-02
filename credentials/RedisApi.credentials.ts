import type {
	IAuthenticateGeneric,
	ICredentialType,
	INodeProperties,
} from 'n8n-workflow';

export class RedisApi implements ICredentialType {
	name = 'redisApi';

	displayName = 'Redis API';

	documentationUrl = 'https://redis.io/docs/';

	icon = 'file:redis.svg' as const;

	properties: INodeProperties[] = [
		// Connection Type Selection
		{
			displayName: 'Connection Type',
			name: 'connectionType',
			type: 'options',
			options: [
				{
					name: 'Standard',
					value: 'standard',
					description: 'Connect to a single Redis instance',
				},
				{
					name: 'Cluster',
					value: 'cluster',
					description: 'Connect to a Redis Cluster with multiple nodes',
				},
				{
					name: 'Sentinel',
					value: 'sentinel',
					description: 'Connect through Redis Sentinel for high availability',
				},
			],
			default: 'standard',
			description: 'Choose the type of Redis connection',
		},

		// Standard Connection Fields
		{
			displayName: 'Host',
			name: 'host',
			type: 'string',
			displayOptions: {
				show: {
					connectionType: ['standard'],
				},
			},
			default: 'localhost',
			placeholder: 'localhost',
			description: 'Redis server hostname or IP address',
		},
		{
			displayName: 'Port',
			name: 'port',
			type: 'number',
			displayOptions: {
				show: {
					connectionType: ['standard'],
				},
			},
			default: 6379,
			description: 'Redis server port number',
		},

		// Cluster Connection Fields
		{
			displayName: 'Cluster Hosts',
			name: 'clusterHosts',
			type: 'string',
			displayOptions: {
				show: {
					connectionType: ['cluster'],
				},
			},
			default: 'localhost:6379,localhost:6380,localhost:6381',
			placeholder: 'host1:port1,host2:port2,host3:port3',
			description: 'Comma-separated list of Redis cluster hosts and ports',
		},

		// Sentinel Connection Fields
		{
			displayName: 'Sentinel Hosts',
			name: 'sentinelHosts',
			type: 'string',
			displayOptions: {
				show: {
					connectionType: ['sentinel'],
				},
			},
			default: 'localhost:26379,localhost:26380,localhost:26381',
			placeholder: 'sentinel1:port1,sentinel2:port2,sentinel3:port3',
			description: 'Comma-separated list of Redis Sentinel hosts and ports',
		},
		{
			displayName: 'Master Name',
			name: 'masterName',
			type: 'string',
			displayOptions: {
				show: {
					connectionType: ['sentinel'],
				},
			},
			default: 'mymaster',
			placeholder: 'mymaster',
			description: 'Name of the Redis master as configured in Sentinel',
		},

		// Database Selection
		{
			displayName: 'Database',
			name: 'database',
			type: 'number',
			default: 0,
			description: 'Redis database number to connect to',
		},

		// Authentication Type
		{
			displayName: 'Authentication',
			name: 'authType',
			type: 'options',
			options: [
				{
					name: 'None',
					value: 'none',
					description: 'No authentication required',
				},
				{
					name: 'Password Only',
					value: 'password',
					description: 'Authenticate using password only',
				},
				{
					name: 'Username and Password',
					value: 'userpass',
					description: 'Authenticate using username and password',
				},
			],
			default: 'none',
			description: 'Choose the authentication method',
		},

		// Authentication Fields
		{
			displayName: 'Username',
			name: 'username',
			type: 'string',
			displayOptions: {
				show: {
					authType: ['userpass'],
				},
			},
			default: '',
			placeholder: 'default',
			description: 'Redis username (Redis 6.0+)',
		},
		{
			displayName: 'Password',
			name: 'password',
			type: 'string',
			typeOptions: { password: true },
			displayOptions: {
				show: {
					authType: ['password', 'userpass'],
				},
			},
			default: '',
			description: 'Redis password',
		},

		// SSL/TLS Configuration
		{
			displayName: 'Use SSL/TLS',
			name: 'ssl',
			type: 'boolean',
			default: false,
			description: 'Whether to use SSL/TLS connection',
		},

		// Advanced SSL Options
		{
			displayName: 'SSL Options',
			name: 'sslOptions',
			type: 'collection',
			displayOptions: {
				show: {
					ssl: [true],
				},
			},
			default: {},
			placeholder: 'Add SSL Option',
			options: [
				{
					displayName: 'Reject Unauthorized',
					name: 'rejectUnauthorized',
					type: 'boolean',
					default: true,
					description: 'Whether to reject connections with invalid certificates',
				},
				{
					displayName: 'Certificate Authority (CA)',
					name: 'ca',
					type: 'string',
					typeOptions: {
						rows: 4,
					},
					default: '',
					placeholder: '-----BEGIN CERTIFICATE-----\n...\n-----END CERTIFICATE-----',
					description: 'Certificate Authority certificate in PEM format',
				},
				{
					displayName: 'Client Certificate',
					name: 'cert',
					type: 'string',
					typeOptions: {
						rows: 4,
					},
					default: '',
					placeholder: '-----BEGIN CERTIFICATE-----\n...\n-----END CERTIFICATE-----',
					description: 'Client certificate in PEM format',
				},
				{
					displayName: 'Client Private Key',
					name: 'key',
					type: 'string',
					typeOptions: {
						password: true,
						rows: 4,
					},
					default: '',
					placeholder: '-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----',
					description: 'Client private key in PEM format',
				},
			],
		},

		// Connection Options
		{
			displayName: 'Connection Options',
			name: 'connectionOptions',
			type: 'collection',
			default: {},
			placeholder: 'Add Connection Option',
			options: [
				{
					displayName: 'Connection Timeout (ms)',
					name: 'connectTimeout',
					type: 'number',
					default: 10000,
					description: 'Connection timeout in milliseconds',
				},
				{
					displayName: 'Command Timeout (ms)',
					name: 'commandTimeout',
					type: 'number',
					default: 5000,
					description: 'Command timeout in milliseconds',
				},
				{
					displayName: 'Retry Attempts',
					name: 'retryAttempts',
					type: 'number',
					default: 3,
					description: 'Number of retry attempts for failed commands',
				},
				{
					displayName: 'Retry Delay (ms)',
					name: 'retryDelayOnFailover',
					type: 'number',
					default: 100,
					description: 'Delay between retry attempts in milliseconds',
				},
				{
					displayName: 'Keep Alive (ms)',
					name: 'keepAlive',
					type: 'number',
					default: 30000,
					description: 'Keep alive interval in milliseconds',
				},
			],
		},
	];

	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: {},
	};
}