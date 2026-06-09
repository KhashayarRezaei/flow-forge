import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EngineModule } from '../engine/engine.module';
import { Workflow } from '../database/entities/workflow.entity';
import { WorkflowRun } from '../database/entities/workflow-run.entity';
import { StepRun } from '../database/entities/step-run.entity';
import { RunsController } from './runs.controller';
import { RunsService } from './runs.service';

@Module({
  imports: [TypeOrmModule.forFeature([Workflow, WorkflowRun, StepRun]), EngineModule],
  controllers: [RunsController],
  providers: [RunsService],
  exports: [RunsService],
})
export class RunsModule {}
