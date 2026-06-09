import { Injectable } from '@nestjs/common';
import { ApprovalStepDefinition } from '../../workflows/workflow.types';
import { ApprovalPauseSignal } from '../errors';
import { resolveTemplates } from '../template';
import { StepExecutionInput, StepExecutionResult, StepExecutor } from './step-executor.interface';

/**
 * Human-approval gate. On first execution it raises ApprovalPauseSignal, which
 * the orchestrator translates into a WAITING_APPROVAL state on both the step and
 * the run. The run resumes when POST /runs/:id/steps/:stepId/approve (or
 * /reject) is called, which records the decision as this step's output and
 * advances the DAG.
 */
@Injectable()
export class ApprovalStepExecutor implements StepExecutor {
  readonly type = 'approval' as const;

  async execute({ step, context }: StepExecutionInput): Promise<StepExecutionResult> {
    const def = step as ApprovalStepDefinition;
    const prompt = def.config?.prompt
      ? (resolveTemplates(def.config.prompt, context) as string)
      : undefined;
    throw new ApprovalPauseSignal(prompt);
  }
}
