import { StepDefinition, WorkflowDefinition } from '../workflows/workflow.types';

export class WorkflowValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WorkflowValidationError';
  }
}

const VALID_TYPES = new Set(['llm', 'http', 'conditional', 'approval']);

/**
 * Validate a workflow definition: non-empty, unique step ids, known types,
 * resolvable dependency/guard references, and an acyclic graph (Kahn's
 * algorithm). Throws WorkflowValidationError on the first problem found.
 */
export function validateWorkflow(def: WorkflowDefinition): void {
  if (!def || !Array.isArray(def.steps) || def.steps.length === 0) {
    throw new WorkflowValidationError('Workflow must define at least one step');
  }

  const ids = new Set<string>();
  for (const step of def.steps) {
    if (!step.id || typeof step.id !== 'string') {
      throw new WorkflowValidationError('Every step must have a string id');
    }
    if (ids.has(step.id)) {
      throw new WorkflowValidationError(`Duplicate step id: ${step.id}`);
    }
    ids.add(step.id);
    if (!VALID_TYPES.has(step.type)) {
      throw new WorkflowValidationError(`Unknown step type "${step.type}" on step ${step.id}`);
    }
  }

  for (const step of def.steps) {
    for (const dep of step.dependsOn ?? []) {
      if (!ids.has(dep)) {
        throw new WorkflowValidationError(`Step ${step.id} depends on unknown step ${dep}`);
      }
      if (dep === step.id) {
        throw new WorkflowValidationError(`Step ${step.id} cannot depend on itself`);
      }
    }
    if (step.runWhen && !ids.has(step.runWhen.step)) {
      throw new WorkflowValidationError(
        `Step ${step.id} runWhen references unknown step ${step.runWhen.step}`,
      );
    }
  }

  detectCycle(def.steps);
}

function detectCycle(steps: StepDefinition[]): void {
  const indegree = new Map<string, number>();
  const adj = new Map<string, string[]>();
  for (const step of steps) {
    indegree.set(step.id, indegree.get(step.id) ?? 0);
    adj.set(step.id, adj.get(step.id) ?? []);
  }
  for (const step of steps) {
    for (const dep of step.dependsOn ?? []) {
      adj.get(dep)!.push(step.id);
      indegree.set(step.id, (indegree.get(step.id) ?? 0) + 1);
    }
  }
  const queue: string[] = [];
  for (const [id, deg] of indegree) if (deg === 0) queue.push(id);

  let visited = 0;
  while (queue.length) {
    const id = queue.shift()!;
    visited++;
    for (const next of adj.get(id) ?? []) {
      indegree.set(next, indegree.get(next)! - 1);
      if (indegree.get(next) === 0) queue.push(next);
    }
  }
  if (visited !== steps.length) {
    throw new WorkflowValidationError('Workflow graph contains a cycle');
  }
}

/** Return a topological ordering of step ids (stable on insertion order). */
export function topoSort(def: WorkflowDefinition): string[] {
  const indegree = new Map<string, number>();
  const adj = new Map<string, string[]>();
  const order: string[] = def.steps.map((s) => s.id);
  for (const id of order) {
    indegree.set(id, 0);
    adj.set(id, []);
  }
  for (const step of def.steps) {
    for (const dep of step.dependsOn ?? []) {
      adj.get(dep)!.push(step.id);
      indegree.set(step.id, indegree.get(step.id)! + 1);
    }
  }
  const queue = order.filter((id) => indegree.get(id) === 0);
  const result: string[] = [];
  while (queue.length) {
    const id = queue.shift()!;
    result.push(id);
    for (const next of adj.get(id) ?? []) {
      indegree.set(next, indegree.get(next)! - 1);
      if (indegree.get(next) === 0) queue.push(next);
    }
  }
  return result;
}
