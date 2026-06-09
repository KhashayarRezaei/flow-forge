import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Job, Queue, Worker } from 'bullmq';
import IORedis from 'ioredis';
import { AppConfig } from '../config/configuration';
import { EngineService } from './engine.service';
import {
  AdvanceJobData,
  ENGINE_QUEUE,
  ENGINE_QUEUE_TOKEN,
  EngineJobData,
  REDIS_CONNECTION,
  StepJobData,
} from './queue.constants';

/**
 * BullMQ worker. Consumes `advance` (orchestration tick) and `step` (single
 * step execution) jobs. Step jobs carry retry/backoff options; when one finally
 * dies the 'failed' listener hands it to the dead-letter path.
 */
@Injectable()
export class EngineProcessor implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(EngineProcessor.name);
  private worker?: Worker<EngineJobData>;

  constructor(
    @Inject(REDIS_CONNECTION) private readonly connection: IORedis,
    @Inject(ENGINE_QUEUE_TOKEN) private readonly queue: Queue,
    private readonly engine: EngineService,
    private readonly config: ConfigService<AppConfig, true>,
  ) {}

  onModuleInit(): void {
    const concurrency = this.config.get('engine', { infer: true }).concurrency;
    this.worker = new Worker<EngineJobData>(
      ENGINE_QUEUE,
      async (job: Job<EngineJobData>) => {
        if (job.name === 'advance') {
          await this.engine.advance((job.data as AdvanceJobData).runId);
        } else if (job.name === 'step') {
          const { runId, stepId } = job.data as StepJobData;
          await this.engine.executeStep(runId, stepId);
        }
      },
      // Cast: BullMQ bundles its own ioredis; identical instance, differing type path.
      { connection: this.connection as never, concurrency },
    );

    this.worker.on('failed', (job, err) => {
      if (!job || job.name !== 'step') return;
      const attempts = job.opts.attempts ?? 1;
      const finallyDead = err?.name === 'UnrecoverableError' || job.attemptsMade >= attempts;
      if (!finallyDead) {
        this.logger.warn(
          `step job ${job.id} attempt ${job.attemptsMade}/${attempts} failed; will retry`,
        );
        return;
      }
      const { runId, stepId } = job.data as StepJobData;
      void this.engine.finalizeFailure(
        runId,
        stepId,
        String(job.id),
        job.attemptsMade,
        job.data,
        err?.message ?? 'unknown error',
      );
    });

    this.worker.on('error', (err) => this.logger.error(`worker error: ${err.message}`));
    this.logger.log(`engine worker started (concurrency=${concurrency})`);
  }

  async onModuleDestroy(): Promise<void> {
    // Graceful shutdown: stop consuming, then close the queue + shared
    // connection so the process can exit cleanly (no dangling handles).
    await this.worker?.close();
    await this.queue.close();
    this.connection.disconnect();
  }
}
