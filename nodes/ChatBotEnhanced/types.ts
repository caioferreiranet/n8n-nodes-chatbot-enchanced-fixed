import { createClient } from 'redis';

// Redis Client Type
export type RedisClient = ReturnType<typeof createClient>;

// Simplified Redis Credential Interface - matches n8n's built-in redis credential
export interface RedisCredential {
	host: string;
	port: number;
	ssl?: boolean;
	database: number;
	user?: string;
	password?: string;
}

// Buffer State for Timed Buffer Logic
export interface BufferState {
	exp: number;
	data: BufferedMessage[];
	sessionId: string;
	totalCount: number;
}

export interface BufferedMessage {
	content: string;
	userId: string;
	timestamp: number;
	metadata?: Record<string, unknown>;
}