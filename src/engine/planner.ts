import { RunStatus, StepStatus } from '../common/status.enum';
import { WorkflowDefinition } from '../workflows/workflow.types';

export interface PlannerStepState {
  status: StepStatus;
  output?: unknown;
}

export type StepStateMap = Record<string, PlannerStepState>;

export interface RunPlan {
  /** Pending steps that should now transition to SKIPPED. */
  toSkip: string[];
  /** Pending steps whose dependencies are all satisfied and may execute now. */
  ready: string[];
  /** Overall run status implied by applying `toSkip` to the current states. */
  runStatus: RunStatus;
}

const isTerminal = (s: StepStatus): boolean =>
  s === StepStatus.COMPLETED || s === StepStatus.FAILED || s === StepStatus.SKIPPED;

/**
 * Pure scheduling decision for one orchestration tick.
 *
 * Rules:
 *  - A pending step is decidable only when every dependency is in a terminal
 *    state (completed / failed / skipped).
 *  - It is SKIPPED if any dependency was skipped or failed, or if its `runWhen`
 *    guard is not satisfied (guard step did not complete, or its `output.result`
 *    !== the expected value). Skips propagate transitively (a step whose only
 *    path runs through a skipped branch is itself skipped).
 *  - Otherwise, when all dependencies COMPLETED and the guard passes, it is
 *    READY to execute.
 *
 * `runStatus` priority: any FAILED -> FAILED; all terminal -> COMPLETED;
 * work in flight (ready/running) -> RUNNING; only an approval gate left ->
 * WAITING_APPROVAL; otherwise RUNNING (waiting on dependencies).
 */
export function planRun(def: WorkflowDefinition, states: StepStateMap): RunPlan {
  const local: StepStateMap = {};
  for (const step of def.steps) {
    local[step.id] = states[step.id] ?? { status: StepStatus.PENDING };
  }
  const toSkip: string[] = [];

  // Iterate to a fixpoint so skips propagate through descendants.
  let changed = true;
  while (changed) {
    changed = false;
    for (const step of def.steps) {
      const state = local[step.id];
      if (state.status !== StepStatus.PENDING) continue;

      const deps = step.dependsOn ?? [];
      const depsDecidable = deps.every((d) => isTerminal(local[d]?.status ?? StepStatus.PENDING));
      if (!depsDecidable) continue;

      let skip = deps.some(
        (d) => local[d]?.status === StepStatus.SKIPPED || local[d]?.status === StepStatus.FAILED,
      );

      if (!skip && step.runWhen) {
        const guard = local[step.runWhen.step];
        const expected = step.runWhen.equals ?? true;
        if (!guard || guard.status !== StepStatus.COMPLETED) {
          skip = true;
        } else {
          const value = Boolean((guard.output as any)?.result);
          if (value !== expected) skip = true;
        }
      }

      if (skip) {
        local[step.id] = { ...state, status: StepStatus.SKIPPED };
        toSkip.push(step.id);
        changed = true;
      }
    }
  }

  // Now compute ready steps against the post-skip local state.
  const ready: string[] = [];
  for (const step of def.steps) {
    if (local[step.id].status !== StepStatus.PENDING) continue;
    const deps = step.dependsOn ?? [];
    const allCompleted = deps.every((d) => local[d]?.status === StepStatus.COMPLETED);
    if (allCompleted) ready.push(step.id);
  }

  const statuses = def.steps.map((s) => local[s.id].status);
  const hasFailed = statuses.includes(StepStatus.FAILED);
  const allTerminal = statuses.every(isTerminal);
  const hasRunning = statuses.includes(StepStatus.RUNNING);
  const hasWaitingApproval = statuses.includes(StepStatus.WAITING_APPROVAL);

  let runStatus: RunStatus;
  if (hasFailed) {
    runStatus = RunStatus.FAILED;
  } else if (allTerminal) {
    runStatus = RunStatus.COMPLETED;
  } else if (ready.length > 0 || hasRunning) {
    runStatus = RunStatus.RUNNING;
  } else if (hasWaitingApproval) {
    runStatus = RunStatus.WAITING_APPROVAL;
  } else {
    runStatus = RunStatus.RUNNING;
  }

  return { toSkip, ready, runStatus };
}
