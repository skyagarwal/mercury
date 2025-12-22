import { Module, Global } from '@nestjs/common';
import Redis from 'ioredis';

export const REDIS_CLIENT = Symbol('REDIS_CLIENT');

@Global()
@Module({
	providers: [
			{
				provide: REDIS_CLIENT,
				useFactory: async (): Promise<any> => {
				const url = process.env.REDIS_URL || 'redis://localhost:6379';
					const client = new (Redis as any)(url);
				// quick ping to fail fast in case of bad connection
				try {
					await client.ping();
				} catch (e) {
					// eslint-disable-next-line no-console
					console.warn('Warning: Redis ping failed at startup:', (e as Error).message);
				}
				return client;
			},
		},
	],
	exports: [REDIS_CLIENT],
})
export class RedisModule {}

