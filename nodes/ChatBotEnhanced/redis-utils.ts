import { createClient } from 'redis';
import { RedisCredential } from './types';

export type RedisClient = ReturnType<typeof createClient>;

export const setupRedisClient = (credentials: RedisCredential): RedisClient => {
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