import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { StepStatus } from '../common/status.enum';
import { Workflow } from '../database/entities/workflow.entity';
import { WorkflowRun } from '../database/entities/workflow-run.entity';
import { StepRun } from '../database/entities/step-run.entity';
import { DeadLetter } from '../database/entities/dead-letter.entity';
import { topoSort } from '../engine/dag';

interface StepNode {
  stepId: string;
  name: string | null;
  type: string;
  status: StepStatus;
  attempt: number;
  dependsOn: string[];
  input: unknown;
  output: unknown;
  error: unknown;
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
  latencyMs: number | null;
  startedAt: Date | null;
  finishedAt: Date | null;
  children: StepNode[];
}

@Injectable()
export class TracesService {
  constructor(
    @InjectRepository(WorkflowRun) private readonly runRepo: Repository<WorkflowRun>,
    @InjectRepository(StepRun) private readonly stepRepo: Repository<StepRun>,
    @InjectRepository(Workflow) private readonly workflowRepo: Repository<Workflow>,
    @InjectRepository(DeadLetter) private readonly dlqRepo: Repository<DeadLetter>,
  ) {}

  /** Assemble the full execution trace for a run: run header, ordered steps,
   * the dependency tree, aggregate metrics, and any dead-letters. */
  async getTrace(runId: string) {
    const run = await this.runRepo.findOne({ where: { id: runId } });
    if (!run) throw new NotFoundException(`Run ${runId} not found`);

    const workflow = await this.workflowRepo.findOne({ where: { id: run.workflowId } });
    const steps = await this.stepRepo.find({ where: { runId } });
    const deadLetters = await this.dlqRepo.find({ where: { runId } });

    // Order steps topologically using the workflow definition when available;
    // otherwise fall back to creation order.
    const order = workflow ? topoSort(workflow.definition) : steps.map((s) => s.stepId);
    const rank = new Map(order.map((id, i) => [id, i]));
    steps.sort((a, b) => (rank.get(a.stepId) ?? 0) - (rank.get(b.stepId) ?? 0));

    const nodes = new Map<string, StepNode>();
    for (const s of steps) {
      nodes.set(s.stepId, {
        stepId: s.stepId,
        name: s.name,
        type: s.type,
        status: s.status,
        attempt: s.attempt,
        dependsOn: s.dependsOn ?? [],
        input: s.input,
        output: s.output,
        error: s.error,
        promptTokens: s.promptTokens,
        completionTokens: s.completionTokens,
        totalTokens: s.totalTokens,
        latencyMs: s.latencyMs,
        startedAt: s.startedAt,
        finishedAt: s.finishedAt,
        children: [],
      });
    }

    // Build the dependency tree (DAG rendered as a tree; a node with multiple
    // parents appears under each — the flat `steps` list is authoritative).
    const roots: StepNode[] = [];
    for (const node of nodes.values()) {
      if (!node.dependsOn.length) {
        roots.push(node);
      } else {
        for (const dep of node.dependsOn) {
          nodes.get(dep)?.children.push(node);
        }
      }
    }

    const flat = order.map((id) => nodes.get(id)).filter(Boolean) as StepNode[];

    const summary = {
      totalSteps: flat.length,
      byStatus: countBy(flat, (n) => n.status),
      totalPromptTokens: sum(flat, (n) => n.promptTokens),
      totalCompletionTokens: sum(flat, (n) => n.completionTokens),
      totalTokens: sum(flat, (n) => n.totalTokens),
      totalStepLatencyMs: sum(flat, (n) => n.latencyMs),
      deadLetterCount: deadLetters.length,
    };

    return {
      run: {
        id: run.id,
        workflowId: run.workflowId,
        status: run.status,
        input: run.input,
        output: run.output,
        error: run.error,
        idempotencyKey: run.idempotencyKey,
        startedAt: run.startedAt,
        finishedAt: run.finishedAt,
        durationMs:
          run.startedAt && run.finishedAt
            ? run.finishedAt.getTime() - run.startedAt.getTime()
            : null,
        createdAt: run.createdAt,
      },
      workflow: workflow
        ? { id: workflow.id, name: workflow.name, version: workflow.version }
        : null,
      summary,
      steps: flat,
      tree: roots,
      deadLetters,
    };
  }
}

function sum(items: StepNode[], pick: (n: StepNode) => number | null): number {
  return items.reduce((acc, n) => acc + (pick(n) ?? 0), 0);
}

function countBy(items: StepNode[], pick: (n: StepNode) => string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const item of items) {
    const key = pick(item);
    out[key] = (out[key] ?? 0) + 1;
  }
  return out;
}
