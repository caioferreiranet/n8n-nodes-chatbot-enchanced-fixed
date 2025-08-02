import { createClient } from 'redis';
import { RedisCredential } from './types';

export type BuiltinRedisCredential = {
	host: string;
	port: number;
	ssl?: boolean;
	database: number;
	user?: string;
	password?: string;
};

export type RedisClient = ReturnType<typeof createClient>;

export const setupRedisClient = (credentials: BuiltinRedisCredential): RedisClient => {
	const socketConfig: any = {
		host: credentials.host,
		port: credentials.port,
	};
	
	if (credentials.ssl === true) {
		socketConfig.tls = true;
	}
	
	return createClient({
		socket: socketConfig,
		database: credentials.database,
		username: credentials.user || undefined,
		password: credentials.password || undefined,
	});
};

/**
 * Convert built-in n8n Redis credentials to our complex RedisCredential format
 */
export const adaptBuiltinCredentials = (builtin: BuiltinRedisCredential): RedisCredential => {
	return {
		connectionType: 'standard',
		host: builtin.host,
		port: builtin.port,
		database: builtin.database,
		authType: builtin.user ? 'userpass' : (builtin.password ? 'password' : 'none'),
		username: builtin.user,
		password: builtin.password,
		ssl: builtin.ssl || false,
		sslOptions: undefined
	};
};