import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LlmModule } from '../llm/llm.module';
import { Workflow } from '../database/entities/workflow.entity';
import { WorkflowRun } from '../database/entities/workflow-run.entity';
import { StepRun } from '../database/entities/step-run.entity';
import { DeadLetter } from '../database/entities/dead-letter.entity';
import { EngineService } from './engine.service';
import { EngineProcessor } from './engine.processor';
import { engineQueueProvider, redisConnectionProvider } from './queue.providers';
import { LlmStepExecutor } from './step-executors/llm.executor';
import { HttpStepExecutor } from './step-executors/http.executor';
import { ConditionalStepExecutor } from './step-executors/conditional.executor';
import { ApprovalStepExecutor } from './step-executors/approval.executor';
import { ENGINE_QUEUE_TOKEN } from './queue.constants';

@Module({
  imports: [TypeOrmModule.forFeature([Workflow, WorkflowRun, StepRun, DeadLetter]), LlmModule],
  providers: [
    redisConnectionProvider,
    engineQueueProvider,
    EngineService,
    EngineProcessor,
    LlmStepExecutor,
    HttpStepExecutor,
    ConditionalStepExecutor,
    ApprovalStepExecutor,
  ],
  exports: [EngineService, ENGINE_QUEUE_TOKEN],
})
export class EngineModule {}
