import { Injectable } from '@nestjs/common';
import { ConditionalStepDefinition } from '../../workflows/workflow.types';
import { evaluateCondition } from '../template';
import { StepExecutionInput, StepExecutionResult, StepExecutor } from './step-executor.interface';

@Injectable()
export class ConditionalStepExecutor implements StepExecutor {
  readonly type = 'conditional' as const;

  async execute({ step, context }: StepExecutionInput): Promise<StepExecutionResult> {
    const def = step as ConditionalStepDefinition;
    const result = evaluateCondition(def.config.expression, context);
    // Downstream steps gate on `<this>.output.result` via their `runWhen`.
    return {
      output: { result, expression: def.config.expression },
    };
  }
}
