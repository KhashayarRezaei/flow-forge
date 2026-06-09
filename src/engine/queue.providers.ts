import { Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import { AppConfig } from '../config/configuration';
import { ENGINE_QUEUE, ENGINE_QUEUE_TOKEN, REDIS_CONNECTION } from './queue.constants';

export const redisConnectionProvider: Provider = {
  provide: REDIS_CONNECTION,
  inject: [ConfigService],
  useFactory: (config: ConfigService<AppConfig, true>) => {
    const redis = config.get('redis', { infer: true });
    // BullMQ requires maxRetriesPerRequest: null on its connections.
    return new IORedis({
      host: redis.host,
      port: redis.port,
      password: redis.password,
      maxRetriesPerRequest: null,
    });
  },
};

export const engineQueueProvider: Provider = {
  provide: ENGINE_QUEUE_TOKEN,
  inject: [REDIS_CONNECTION],
  useFactory: (connection: IORedis) =>
    new Queue(ENGINE_QUEUE, {
      // Cast: BullMQ ships a nested copy of ioredis, so the structurally
      // identical Redis types differ by import path. Same instance at runtime.
      connection: connection as never,
      defaultJobOptions: { removeOnComplete: 1000, removeOnFail: 5000 },
    }),
};
