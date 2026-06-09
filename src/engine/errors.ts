/**
 * Marker error for transient failures that SHOULD be retried by the worker
 * (e.g. LLM 429/5xx, network blips, upstream HTTP 5xx). Anything that is not a
 * RetryableError is treated as a permanent failure and fails the step/run
 * immediately without burning the remaining attempts.
 */
export class RetryableError extends Error {
  readonly retryable = true;
  constructor(message: string) {
    super(message);
    this.name = 'RetryableError';
  }
}

/** Special control-flow signal: an approval step is pausing the run. */
export class ApprovalPauseSignal extends Error {
  readonly approvalPause = true;
  constructor(public readonly prompt?: string) {
    super('Run paused awaiting human approval');
    this.name = 'ApprovalPauseSignal';
  }
}

export function isRetryable(err: unknown): boolean {
  return err instanceof RetryableError || (err as any)?.retryable === true;
}
