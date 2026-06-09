export const ENGINE_QUEUE = 'engine';

/** DI tokens for the shared Redis connection and the BullMQ queue. */
export const REDIS_CONNECTION = 'REDIS_CONNECTION';
export const ENGINE_QUEUE_TOKEN = 'ENGINE_QUEUE_TOKEN';

export type EngineJobName = 'advance' | 'step';

export interface AdvanceJobData {
  runId: string;
}

export interface StepJobData {
  runId: string;
  stepId: string;
}

export type EngineJobData = AdvanceJobData | StepJobData;

export const advanceJobId = (runId: string, nonce: string | number): string =>
  `advance:${runId}:${nonce}`;

export const stepJobId = (runId: string, stepId: string): string => `step:${runId}:${stepId}`;
