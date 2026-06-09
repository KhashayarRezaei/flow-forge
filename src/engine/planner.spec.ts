import { RunStatus, StepStatus } from '../common/status.enum';
import { planRun, StepStateMap } from './planner';
import { WorkflowDefinition } from '../workflows/workflow.types';

const branching: WorkflowDefinition = {
  steps: [
    { id: 'a', type: 'http', config: { url: 'x' } },
    { id: 'cond', type: 'conditional', dependsOn: ['a'], config: { expression: 'true' } },
    {
      id: 'hi',
      type: 'http',
      dependsOn: ['cond'],
      runWhen: { step: 'cond', equals: true },
      config: { url: 'x' },
    },
    {
      id: 'lo',
      type: 'http',
      dependsOn: ['cond'],
      runWhen: { step: 'cond', equals: false },
      config: { url: 'x' },
    },
    { id: 'after_hi', type: 'http', dependsOn: ['hi'], config: { url: 'x' } },
  ],
};

const states = (
  m: Record<string, Partial<{ status: StepStatus; output: unknown }>>,
): StepStateMap => {
  const out: StepStateMap = {};
  for (const [k, v] of Object.entries(m))
    out[k] = { status: v.status ?? StepStatus.PENDING, output: v.output };
  return out;
};

describe('planRun', () => {
  it('marks the root step ready on a fresh run', () => {
    const plan = planRun(branching, states({}));
    expect(plan.ready).toEqual(['a']);
    expect(plan.runStatus).toBe(RunStatus.RUNNING);
  });

  it('runs the true branch and skips the false branch + its descendants', () => {
    const plan = planRun(
      branching,
      states({
        a: { status: StepStatus.COMPLETED },
        cond: { status: StepStatus.COMPLETED, output: { result: true } },
      }),
    );
    expect(plan.ready).toContain('hi');
    expect(plan.toSkip).toContain('lo');
    expect(plan.ready).not.toContain('lo');
  });

  it('propagates skips transitively', () => {
    // cond false -> hi skipped -> after_hi (depends on hi) skipped too.
    const plan = planRun(
      branching,
      states({
        a: { status: StepStatus.COMPLETED },
        cond: { status: StepStatus.COMPLETED, output: { result: false } },
      }),
    );
    expect(plan.toSkip).toEqual(expect.arrayContaining(['hi', 'after_hi']));
    expect(plan.ready).toContain('lo');
  });

  it('reports COMPLETED when every step is terminal', () => {
    const plan = planRun(
      branching,
      states({
        a: { status: StepStatus.COMPLETED },
        cond: { status: StepStatus.COMPLETED, output: { result: false } },
        lo: { status: StepStatus.COMPLETED },
        hi: { status: StepStatus.SKIPPED },
        after_hi: { status: StepStatus.SKIPPED },
      }),
    );
    expect(plan.runStatus).toBe(RunStatus.COMPLETED);
    expect(plan.ready).toHaveLength(0);
  });

  it('reports FAILED when any step failed', () => {
    const plan = planRun(branching, states({ a: { status: StepStatus.FAILED } }));
    expect(plan.runStatus).toBe(RunStatus.FAILED);
  });

  it('reports WAITING_APPROVAL when only an approval gate remains', () => {
    const wf: WorkflowDefinition = {
      steps: [
        { id: 'a', type: 'approval' },
        { id: 'b', type: 'http', dependsOn: ['a'], config: { url: 'x' } },
      ],
    };
    const plan = planRun(wf, states({ a: { status: StepStatus.WAITING_APPROVAL } }));
    expect(plan.runStatus).toBe(RunStatus.WAITING_APPROVAL);
    expect(plan.ready).toHaveLength(0);
  });

  it('does not re-run non-pending steps (idempotent)', () => {
    const plan = planRun(branching, states({ a: { status: StepStatus.RUNNING } }));
    expect(plan.ready).toHaveLength(0);
    expect(plan.runStatus).toBe(RunStatus.RUNNING);
  });
});
