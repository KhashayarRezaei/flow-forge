/**
 * Workflow definition schema.
 *
 * A workflow is a DAG of steps. Each step declares the steps it `dependsOn`
 * (the edges of the DAG). A step becomes runnable once all of its dependencies
 * have reached a terminal state. Data flows between steps via `{{ expression }}`
 * templating that is resolved against the run context `{ input, steps }`.
 */

export type StepType = 'llm' | 'http' | 'conditional' | 'approval';

export interface BaseStepDefinition {
  /** Unique key within the workflow. */
  id: string;
  type: StepType;
  /** Optional human label for traces. */
  name?: string;
  /** Step ids that must finish before this step is eligible to run. */
  dependsOn?: string[];
  /**
   * Optional guard. When present the step only runs if the referenced step's
   * boolean output matches `equals` (default true). Otherwise the step (and its
   * descendants) is marked `skipped`. This is how conditional branches prune
   * one side of the DAG.
   */
  runWhen?: {
    /** Id of a (typically conditional) step whose output gates this one. */
    step: string;
    /** Required value of `<step>.result`. Defaults to true. */
    equals?: boolean;
  };
}

export interface LlmStepDefinition extends BaseStepDefinition {
  type: 'llm';
  config: {
    /** Prompt template, supports {{ input.x }} and {{ steps.y.output.z }}. */
    prompt: string;
    /** Optional system instruction template. */
    system?: string;
    /** Override the default model for this step. */
    model?: string;
    temperature?: number;
    maxOutputTokens?: number;
    /**
     * If true, attempt to JSON.parse the model output into `output.json`.
     * The raw text is always available at `output.text`.
     */
    parseJson?: boolean;
  };
}

export interface HttpStepDefinition extends BaseStepDefinition {
  type: 'http';
  config: {
    method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
    /** URL template. */
    url: string;
    headers?: Record<string, string>;
    /** Body template (object is JSON-serialized, string sent as-is). */
    body?: unknown;
    timeoutMs?: number;
    /** HTTP status codes >= this are treated as retryable failures. Default 500. */
    retryOnStatusGte?: number;
  };
}

export interface ConditionalStepDefinition extends BaseStepDefinition {
  type: 'conditional';
  config: {
    /**
     * Boolean expression evaluated against `{ input, steps }`.
     * e.g. "steps.classify.output.json.priority === 'high'".
     * The step output is `{ result: boolean, expression: string }`.
     */
    expression: string;
  };
}

export interface ApprovalStepDefinition extends BaseStepDefinition {
  type: 'approval';
  config?: {
    /** Message template shown to the approver / stored in the trace. */
    prompt?: string;
    /** Optional informational timeout (not auto-enforced in this build). */
    timeoutSeconds?: number;
  };
}

export type StepDefinition =
  | LlmStepDefinition
  | HttpStepDefinition
  | ConditionalStepDefinition
  | ApprovalStepDefinition;

export interface WorkflowDefinition {
  /** Free-form schema version of the workflow definition. */
  version?: number;
  /** Optional defaults applied to runs. */
  defaultInput?: Record<string, unknown>;
  steps: StepDefinition[];
}

/** The mutable context resolved against during a run. */
export interface RunContext {
  input: Record<string, unknown>;
  steps: Record<string, { output: unknown; status: string }>;
}
