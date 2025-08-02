import {
	ICredentialType,
	INodeProperties,
} from 'n8n-workflow';

export class RedisApi implements ICredentialType {
	name = 'redisApi';
	displayName = 'Redis API';
	documentationUrl = 'https://redis.io/docs/connect/clients/';
	properties: INodeProperties[] = [
		{
			displayName: 'Connection Type',
			name: 'connectionType',
			type: 'options',
			options: [
				{
					name: 'Standard Connection',
					value: 'standard',
				},
				{
					name: 'Redis Cluster',
					value: 'cluster',
				},
				{
					name: 'Redis Sentinel',
					value: 'sentinel',
				},
			],
			default: 'standard',
			description: 'Type of Redis connection to establish',
		},
		{
			displayName: 'Host',
			name: 'host',
			type: 'string',
			default: 'localhost',
			required: true,
			description: 'Redis server hostname or IP address',
			displayOptions: {
				show: {
					connectionType: ['standard'],
				},
			},
		},
		{
			displayName: 'Port',
			name: 'port',
			type: 'number',
			default: 6379,
			required: true,
			description: 'Redis server port number',
			displayOptions: {
				show: {
					connectionType: ['standard'],
				},
			},
		},
		{
			displayName: 'Cluster Hosts',
			name: 'clusterHosts',
			type: 'string',
			default: 'localhost:6379,localhost:6380,localhost:6381',
			required: true,
			description: 'Comma-separated list of cluster host:port pairs',
			displayOptions: {
				show: {
					connectionType: ['cluster'],
				},
			},
		},
		{
			displayName: 'Sentinel Hosts',
			name: 'sentinelHosts',
			type: 'string',
			default: 'localhost:26379,localhost:26380,localhost:26381',
			required: true,
			description: 'Comma-separated list of sentinel host:port pairs',
			displayOptions: {
				show: {
					connectionType: ['sentinel'],
				},
			},
		},
		{
			displayName: 'Master Name',
			name: 'masterName',
			type: 'string',
			default: 'mymaster',
			required: true,
			description: 'Name of the Redis master instance in Sentinel configuration',
			displayOptions: {
				show: {
					connectionType: ['sentinel'],
				},
			},
		},
		{
			displayName: 'Database',
			name: 'database',
			type: 'number',
			default: 0,
			description: 'Redis database number (0-15)',
			displayOptions: {
				show: {
					connectionType: ['standard', 'sentinel'],
				},
			},
		},
		{
			displayName: 'Authentication',
			name: 'authType',
			type: 'options',
			options: [
				{
					name: 'None',
					value: 'none',
				},
				{
					name: 'Password Only',
					value: 'password',
				},
				{
					name: 'Username & Password',
					value: 'userpass',
				},
			],
			default: 'none',
			description: 'Authentication method for Redis connection',
		},
		{
			displayName: 'Username',
			name: 'username',
			type: 'string',
			default: '',
			description: 'Redis username (Redis 6.0+)',
			displayOptions: {
				show: {
					authType: ['userpass'],
				},
			},
		},
		{
			displayName: 'Password',
			name: 'password',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			description: 'Redis password',
			displayOptions: {
				show: {
					authType: ['password', 'userpass'],
				},
			},
		},
		{
			displayName: 'SSL/TLS',
			name: 'ssl',
			type: 'boolean',
			default: false,
			description: 'Whether to use SSL/TLS encryption for the connection',
		},
		{
			displayName: 'SSL Options',
			name: 'sslOptions',
			type: 'collection',
			placeholder: 'Add SSL Option',
			default: {},
			displayOptions: {
				show: {
					ssl: [true],
				},
			},
			options: [
				{
					displayName: 'Reject Unauthorized',
					name: 'rejectUnauthorized',
					type: 'boolean',
					default: true,
					description: 'Whether to reject connections with invalid certificates',
				},
				{
					displayName: 'CA Certificate',
					name: 'ca',
					type: 'string',
					typeOptions: { rows: 4 },
					default: '',
					description: 'Certificate Authority certificate in PEM format',
				},
				{
					displayName: 'Client Certificate',
					name: 'cert',
					type: 'string',
					typeOptions: { rows: 4 },
					default: '',
					description: 'Client certificate in PEM format',
				},
				{
					displayName: 'Client Key',
					name: 'key',
					type: 'string',
					typeOptions: { password: true, rows: 4 },
					default: '',
					description: 'Client private key in PEM format',
				},
			],
		},
	];
}