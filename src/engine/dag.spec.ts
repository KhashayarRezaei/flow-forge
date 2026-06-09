import { topoSort, validateWorkflow, WorkflowValidationError } from './dag';
import { WorkflowDefinition } from '../workflows/workflow.types';

const wf = (steps: any[]): WorkflowDefinition => ({ steps });

describe('validateWorkflow', () => {
  it('accepts a valid linear DAG', () => {
    expect(() =>
      validateWorkflow(
        wf([
          { id: 'a', type: 'http', config: { url: 'x' } },
          { id: 'b', type: 'llm', dependsOn: ['a'], config: { prompt: 'x' } },
        ]),
      ),
    ).not.toThrow();
  });

  it('rejects empty workflows', () => {
    expect(() => validateWorkflow(wf([]))).toThrow(WorkflowValidationError);
  });

  it('rejects duplicate step ids', () => {
    expect(() =>
      validateWorkflow(
        wf([
          { id: 'a', type: 'http', config: {} },
          { id: 'a', type: 'http', config: {} },
        ]),
      ),
    ).toThrow(/Duplicate/);
  });

  it('rejects unknown step types', () => {
    expect(() => validateWorkflow(wf([{ id: 'a', type: 'magic', config: {} }]))).toThrow(
      /Unknown step type/,
    );
  });

  it('rejects unknown dependency references', () => {
    expect(() =>
      validateWorkflow(wf([{ id: 'a', type: 'http', dependsOn: ['ghost'], config: {} }])),
    ).toThrow(/unknown step ghost/);
  });

  it('rejects unknown runWhen references', () => {
    expect(() =>
      validateWorkflow(wf([{ id: 'a', type: 'http', runWhen: { step: 'ghost' }, config: {} }])),
    ).toThrow(/runWhen references unknown/);
  });

  it('detects cycles', () => {
    expect(() =>
      validateWorkflow(
        wf([
          { id: 'a', type: 'http', dependsOn: ['b'], config: {} },
          { id: 'b', type: 'http', dependsOn: ['a'], config: {} },
        ]),
      ),
    ).toThrow(/cycle/);
  });
});

describe('topoSort', () => {
  it('orders dependencies before dependents', () => {
    const order = topoSort(
      wf([
        { id: 'c', type: 'http', dependsOn: ['b'], config: {} },
        { id: 'a', type: 'http', config: {} },
        { id: 'b', type: 'http', dependsOn: ['a'], config: {} },
      ]),
    );
    expect(order.indexOf('a')).toBeLessThan(order.indexOf('b'));
    expect(order.indexOf('b')).toBeLessThan(order.indexOf('c'));
  });
});
