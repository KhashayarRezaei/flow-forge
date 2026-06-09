import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { RunStatus, StepStatus } from '../common/status.enum';
import { Workflow } from '../database/entities/workflow.entity';
import { WorkflowRun } from '../database/entities/workflow-run.entity';
import { StepRun } from '../database/entities/step-run.entity';
import { EngineService } from '../engine/engine.service';
import { RunWorkflowDto } from '../workflows/dto/run-workflow.dto';

@Injectable()
export class RunsService {
  constructor(
    @InjectRepository(Workflow) private readonly workflowRepo: Repository<Workflow>,
    @InjectRepository(WorkflowRun) private readonly runRepo: Repository<WorkflowRun>,
    @InjectRepository(StepRun) private readonly stepRepo: Repository<StepRun>,
    private readonly engine: EngineService,
  ) {}

  /** Create a run for a workflow, materialize its step rows, and kick it off. */
  async start(workflowId: string, dto: RunWorkflowDto): Promise<WorkflowRun> {
    const workflow = await this.workflowRepo.findOne({ where: { id: workflowId } });
    if (!workflow) throw new NotFoundException(`Workflow ${workflowId} not found`);

    if (dto.idempotencyKey) {
      const existing = await this.runRepo.findOne({
        where: { idempotencyKey: dto.idempotencyKey },
      });
      if (existing) return existing;
    }

    const input = { ...(workflow.definition.defaultInput ?? {}), ...(dto.input ?? {}) };

    let run = this.runRepo.create({
      workflowId,
      status: RunStatus.PENDING,
      input,
      idempotencyKey: dto.idempotencyKey ?? null,
    });
    try {
      run = await this.runRepo.save(run);
    } catch (err: any) {
      // Unique violation on idempotencyKey from a concurrent submission.
      if (err?.code === '23505' && dto.idempotencyKey) {
        const existing = await this.runRepo.findOne({
          where: { idempotencyKey: dto.idempotencyKey },
        });
        if (existing) return existing;
      }
      throw err;
    }

    const stepRows = workflow.definition.steps.map((s) =>
      this.stepRepo.create({
        runId: run.id,
        stepId: s.id,
        name: s.name ?? null,
        type: s.type,
        status: StepStatus.PENDING,
        dependsOn: s.dependsOn ?? [],
      }),
    );
    await this.stepRepo.save(stepRows);

    await this.engine.enqueueAdvance(run.id);
    return run;
  }

  async findOne(id: string): Promise<WorkflowRun> {
    const run = await this.runRepo.findOne({ where: { id } });
    if (!run) throw new NotFoundException(`Run ${id} not found`);
    return run;
  }

  findAll(workflowId?: string): Promise<WorkflowRun[]> {
    return this.runRepo.find({
      where: workflowId ? { workflowId } : {},
      order: { createdAt: 'DESC' },
      take: 100,
    });
  }

  async approve(
    runId: string,
    stepId: string,
    approved: boolean,
    decidedBy?: string,
    note?: string,
  ): Promise<StepRun> {
    try {
      return await this.engine.resolveApproval(runId, stepId, approved, decidedBy, note);
    } catch (err: any) {
      if (err?.message === 'STEP_NOT_FOUND') {
        throw new NotFoundException(`Step ${stepId} not found on run ${runId}`);
      }
      if (err?.message === 'STEP_NOT_AWAITING_APPROVAL') {
        throw new ConflictException(`Step ${stepId} is not awaiting approval`);
      }
      throw new BadRequestException(err?.message ?? 'Approval failed');
    }
  }
}
