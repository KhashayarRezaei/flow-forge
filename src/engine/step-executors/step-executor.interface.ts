import { StepDefinition, RunContext } from '../../workflows/workflow.types';

export interface StepExecutionResult {
  output: unknown;
  /** Optional token accounting (LLM steps). */
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
}

export interface StepExecutionInput {
  step: StepDefinition;
  /** Resolved (post-templating) input to record on the step run. */
  resolvedInput: unknown;
  context: RunContext;
}

export interface StepExecutor {
  readonly type: StepDefinition['type'];
  /**
   * Execute the step. Throw RetryableError for transient failures (worker will
   * retry with backoff), ApprovalPauseSignal to pause the run, or any other
   * Error for a permanent failure.
   */
  execute(input: StepExecutionInput): Promise<StepExecutionResult>;
}

export const STEP_EXECUTORS = 'STEP_EXECUTORS';
