import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { Queue, UnrecoverableError } from 'bullmq';
import { DataSource, In, Repository } from 'typeorm';
import { AppConfig } from '../config/configuration';
import { RunStatus, StepStatus, TERMINAL_RUN_STATUSES } from '../common/status.enum';
import { Workflow } from '../database/entities/workflow.entity';
import { WorkflowRun } from '../database/entities/workflow-run.entity';
import { StepRun } from '../database/entities/step-run.entity';
import { DeadLetter } from '../database/entities/dead-letter.entity';
import { RunContext, StepDefinition } from '../workflows/workflow.types';
import { ApprovalPauseSignal, isRetryable } from './errors';
import { planRun, StepStateMap } from './planner';
import { resolveTemplates } from './template';
import {
  advanceJobId,
  AdvanceJobData,
  ENGINE_QUEUE_TOKEN,
  StepJobData,
  stepJobId,
} from './queue.constants';
import { StepExecutor } from './step-executors/step-executor.interface';
import { LlmStepExecutor } from './step-executors/llm.executor';
import { HttpStepExecutor } from './step-executors/http.executor';
import { ConditionalStepExecutor } from './step-executors/conditional.executor';
import { ApprovalStepExecutor } from './step-executors/approval.executor';

@Injectable()
export class EngineService {
  private readonly logger = new Logger(EngineService.name);
  private readonly executors: Map<string, StepExecutor>;
  private readonly maxAttempts: number;
  private readonly backoffMs: number;

  constructor(
    @Inject(ENGINE_QUEUE_TOKEN) private readonly queue: Queue,
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(WorkflowRun) private readonly runRepo: Repository<WorkflowRun>,
    @InjectRepository(StepRun) private readonly stepRepo: Repository<StepRun>,
    @InjectRepository(DeadLetter) private readonly dlqRepo: Repository<DeadLetter>,
    config: ConfigService<AppConfig, true>,
    llm: LlmStepExecutor,
    http: HttpStepExecutor,
    conditional: ConditionalStepExecutor,
    approval: ApprovalStepExecutor,
  ) {
    this.executors = new Map<string, StepExecutor>([
      [llm.type, llm],
      [http.type, http],
      [conditional.type, conditional],
      [approval.type, approval],
    ]);
    const engine = config.get('engine', { infer: true });
    this.maxAttempts = engine.stepMaxAttempts;
    this.backoffMs = engine.stepBackoffMs;
  }

  // -------------------------------------------------------------------------
  // Producers
  // -------------------------------------------------------------------------

  async enqueueAdvance(runId: string): Promise<void> {
    await this.queue.add('advance', { runId } satisfies AdvanceJobData, {
      jobId: advanceJobId(runId, Date.now()),
      attempts: 1,
      removeOnComplete: 1000,
      removeOnFail: 1000,
    });
  }

  private async enqueueStep(runId: string, stepId: string): Promise<void> {
    await this.queue.add('step', { runId, stepId } satisfies StepJobData, {
      // Deterministic id => duplicate enqueues for the same step collapse.
      jobId: stepJobId(runId, stepId),
      attempts: this.maxAttempts,
      backoff: { type: 'exponential', delay: this.backoffMs },
      removeOnComplete: 1000,
      // Keep failed jobs so the dead-letter trail is inspectable in Redis too.
      removeOnFail: false,
    });
  }

  // -------------------------------------------------------------------------
  // Orchestration tick
  // -------------------------------------------------------------------------

  /**
   * Advance a run: load its current step states, compute the schedule via the
   * pure planner, persist skips + the new run status, and enqueue ready steps.
   * Safe to call repeatedly (idempotent): only PENDING steps are acted upon.
   */
  async advance(runId: string): Promise<void> {
    const run = await this.runRepo.findOne({ where: { id: runId } });
    if (!run) {
      this.logger.warn(`advance: run ${runId} not found`);
      return;
    }
    if (TERMINAL_RUN_STATUSES.includes(run.status)) return;

    const workflow = await this.dataSource
      .getRepository(Workflow)
      .findOne({ where: { id: run.workflowId } });
    if (!workflow) {
      await this.failRun(run, `Workflow ${run.workflowId} no longer exists`);
      return;
    }
    const def = workflow.definition;
    const steps = await this.stepRepo.find({ where: { runId } });

    const states: StepStateMap = {};
    for (const s of steps) states[s.stepId] = { status: s.status, output: s.output };

    const plan = planRun(def, states);

    if (plan.toSkip.length) {
      await this.stepRepo.update(
        { runId, status: StepStatus.PENDING, stepId: In(plan.toSkip) },
        { status: StepStatus.SKIPPED, finishedAt: new Date() },
      );
    }

    // Transition run status (and stamp lifecycle timestamps).
    if (run.status !== plan.runStatus) {
      run.status = plan.runStatus;
      if (plan.runStatus === RunStatus.RUNNING && !run.startedAt) run.startedAt = new Date();
      if (TERMINAL_RUN_STATUSES.includes(plan.runStatus)) {
        run.finishedAt = new Date();
        if (plan.runStatus === RunStatus.COMPLETED) run.output = await this.assembleOutput(runId);
        if (plan.runStatus === RunStatus.FAILED && !run.error)
          run.error = 'One or more steps failed';
      }
      await this.runRepo.save(run);
    } else if (run.status === RunStatus.PENDING) {
      run.status = RunStatus.RUNNING;
      run.startedAt = run.startedAt ?? new Date();
      await this.runRepo.save(run);
    }

    for (const stepId of plan.ready) {
      await this.enqueueStep(runId, stepId);
    }
  }

  // -------------------------------------------------------------------------
  // Step execution
  // -------------------------------------------------------------------------

  /**
   * Execute a single step. Invoked by the BullMQ worker. Claims the step
   * atomically (PENDING -> RUNNING), runs the executor, persists the outcome,
   * and triggers the next orchestration tick. Throws to let BullMQ retry
   * transient failures with backoff; throws UnrecoverableError to fail fast on
   * permanent errors.
   */
  async executeStep(runId: string, stepId: string): Promise<void> {
    const run = await this.runRepo.findOne({ where: { id: runId } });
    if (!run || TERMINAL_RUN_STATUSES.includes(run.status)) return;

    const workflow = await this.dataSource
      .getRepository(Workflow)
      .findOne({ where: { id: run.workflowId } });
    if (!workflow) return;
    const def = workflow.definition;
    const stepDef = def.steps.find((s) => s.id === stepId);
    if (!stepDef) return;

    const context = await this.buildContext(run, runId);
    const resolvedInput = this.resolveInputForRecord(stepDef, context);

    // Atomically claim the step: only one worker may move PENDING -> RUNNING.
    const claimed = await this.claimStep(runId, stepId, resolvedInput);
    if (!claimed) {
      this.logger.debug(`step ${stepId} not claimable (already running/terminal)`);
      return;
    }

    const executor = this.executors.get(stepDef.type);
    if (!executor) {
      await this.recordPermanentFailure(runId, stepId, `No executor for type ${stepDef.type}`);
      throw new UnrecoverableError(`No executor for type ${stepDef.type}`);
    }

    const start = Date.now();
    try {
      const result = await executor.execute({ step: stepDef, resolvedInput, context });
      await this.stepRepo.update(
        { runId, stepId },
        {
          status: StepStatus.COMPLETED,
          output: result.output as any,
          promptTokens: result.promptTokens ?? null,
          completionTokens: result.completionTokens ?? null,
          totalTokens: result.totalTokens ?? null,
          latencyMs: Date.now() - start,
          finishedAt: new Date(),
          error: null,
        },
      );
      await this.enqueueAdvance(runId);
    } catch (err) {
      if (err instanceof ApprovalPauseSignal) {
        await this.pauseForApproval(runId, stepId, err.prompt, Date.now() - start);
        await this.enqueueAdvance(runId);
        return;
      }
      await this.handleStepError(runId, stepId, err, Date.now() - start);
    }
  }

  /** Atomic claim using a conditional UPDATE; returns true if this call won. */
  private async claimStep(runId: string, stepId: string, resolvedInput: unknown): Promise<boolean> {
    const res = await this.dataSource
      .createQueryBuilder()
      .update(StepRun)
      .set({
        status: StepStatus.RUNNING,
        attempt: () => '"attempt" + 1',
        startedAt: () => 'COALESCE("startedAt", now())',
        // Bound parameter (no string interpolation) cast to jsonb.
        input: () => 'CAST(:inputJson AS jsonb)',
      })
      .where('runId = :runId AND stepId = :stepId AND status = :status', {
        runId,
        stepId,
        status: StepStatus.PENDING,
      })
      .setParameter('inputJson', JSON.stringify(resolvedInput ?? null))
      .execute();
    return (res.affected ?? 0) > 0;
  }

  private async handleStepError(
    runId: string,
    stepId: string,
    err: unknown,
    latencyMs: number,
  ): Promise<void> {
    const message = err instanceof Error ? err.message : String(err);
    const retryable = isRetryable(err);
    const step = await this.stepRepo.findOne({ where: { runId, stepId } });
    const attempt = step?.attempt ?? 0;

    if (retryable && attempt < this.maxAttempts) {
      // Reset to PENDING so the retry can re-claim; record the transient error.
      await this.stepRepo.update(
        { runId, stepId },
        { status: StepStatus.PENDING, error: { message, retryable: true, attempt }, latencyMs },
      );
      this.logger.warn(
        `step ${stepId} attempt ${attempt}/${this.maxAttempts} failed (retryable): ${message}`,
      );
      throw err; // BullMQ schedules the next attempt with backoff.
    }

    // Permanent failure (non-retryable, or attempts exhausted). The worker's
    // 'failed' handler will finalize the step/run and write the dead-letter.
    await this.stepRepo.update(
      { runId, stepId },
      { status: StepStatus.PENDING, error: { message, retryable, attempt }, latencyMs },
    );
    if (retryable) {
      this.logger.error(`step ${stepId} exhausted ${this.maxAttempts} attempts: ${message}`);
      throw err;
    }
    this.logger.error(`step ${stepId} failed permanently (non-retryable): ${message}`);
    throw new UnrecoverableError(message);
  }

  /**
   * Called by the worker's 'failed' event once a step job is permanently dead.
   * Marks the step + run failed and writes the dead-letter record.
   */
  async finalizeFailure(
    runId: string,
    stepId: string,
    jobId: string,
    attemptsMade: number,
    payload: unknown,
    errorMessage: string,
  ): Promise<void> {
    const step = await this.stepRepo.findOne({ where: { runId, stepId } });
    // Idempotent: if this step is already FAILED we've finalized it before
    // (e.g. a duplicate 'failed' event) — skip to avoid a double dead-letter.
    if (step && step.status === StepStatus.FAILED) return;

    if (step) {
      step.status = StepStatus.FAILED;
      step.finishedAt = new Date();
      step.error = { message: errorMessage, retryable: false, attempt: step.attempt };
      await this.stepRepo.save(step);
    }

    const run = await this.runRepo.findOne({ where: { id: runId } });
    if (run && !TERMINAL_RUN_STATUSES.includes(run.status)) {
      await this.failRun(run, `Step "${stepId}" failed: ${errorMessage}`);
    }

    await this.dlqRepo.save(
      this.dlqRepo.create({
        runId,
        stepId,
        jobId,
        attemptsMade,
        payload,
        error: errorMessage,
      }),
    );
    this.logger.error(`dead-letter recorded for run=${runId} step=${stepId} job=${jobId}`);
  }

  private async pauseForApproval(
    runId: string,
    stepId: string,
    prompt: string | undefined,
    latencyMs: number,
  ): Promise<void> {
    await this.stepRepo.update(
      { runId, stepId },
      {
        status: StepStatus.WAITING_APPROVAL,
        output: { awaitingApproval: true, prompt: prompt ?? null } as any,
        latencyMs,
      },
    );
    this.logger.log(`run ${runId} paused at approval gate "${stepId}"`);
  }

  // -------------------------------------------------------------------------
  // Approval resolution
  // -------------------------------------------------------------------------

  async resolveApproval(
    runId: string,
    stepId: string,
    approved: boolean,
    decidedBy?: string,
    note?: string,
  ): Promise<StepRun> {
    const step = await this.stepRepo.findOne({ where: { runId, stepId } });
    if (!step) throw new Error('STEP_NOT_FOUND');
    if (step.status !== StepStatus.WAITING_APPROVAL) {
      throw new Error('STEP_NOT_AWAITING_APPROVAL');
    }
    step.status = StepStatus.COMPLETED;
    step.finishedAt = new Date();
    step.output = {
      approved,
      result: approved,
      decidedBy: decidedBy ?? null,
      note: note ?? null,
      decidedAt: new Date().toISOString(),
    };
    await this.stepRepo.save(step);

    const run = await this.runRepo.findOne({ where: { id: runId } });
    if (run && !TERMINAL_RUN_STATUSES.includes(run.status)) {
      run.status = RunStatus.RUNNING;
      await this.runRepo.save(run);
    }
    await this.enqueueAdvance(runId);
    return step;
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  private async buildContext(run: WorkflowRun, runId: string): Promise<RunContext> {
    const steps = await this.stepRepo.find({ where: { runId } });
    const ctxSteps: RunContext['steps'] = {};
    for (const s of steps) {
      ctxSteps[s.stepId] = { output: s.output, status: s.status };
    }
    return { input: run.input ?? {}, steps: ctxSteps };
  }

  private resolveInputForRecord(step: StepDefinition, context: RunContext): unknown {
    const config = (step as any).config ?? {};
    try {
      return resolveTemplates(config, context);
    } catch {
      // If templating fails we still record the raw config; the executor will
      // surface the real error.
      return config;
    }
  }

  private async assembleOutput(runId: string): Promise<Record<string, unknown>> {
    const steps = await this.stepRepo.find({ where: { runId } });
    const output: Record<string, unknown> = {};
    for (const s of steps) {
      if (s.status === StepStatus.COMPLETED) output[s.stepId] = s.output;
    }
    return output;
  }

  private async failRun(run: WorkflowRun, error: string): Promise<void> {
    run.status = RunStatus.FAILED;
    run.error = error;
    run.finishedAt = new Date();
    await this.runRepo.save(run);
  }

  private async recordPermanentFailure(
    runId: string,
    stepId: string,
    message: string,
  ): Promise<void> {
    await this.stepRepo.update(
      { runId, stepId },
      { status: StepStatus.PENDING, error: { message, retryable: false } },
    );
  }
}
