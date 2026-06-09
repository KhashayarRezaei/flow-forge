import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Workflow } from '../database/entities/workflow.entity';
import { WorkflowRun } from '../database/entities/workflow-run.entity';
import { StepRun } from '../database/entities/step-run.entity';
import { DeadLetter } from '../database/entities/dead-letter.entity';
import { TracesController } from './traces.controller';
import { TracesService } from './traces.service';

@Module({
  imports: [TypeOrmModule.forFeature([Workflow, WorkflowRun, StepRun, DeadLetter])],
  controllers: [TracesController],
  providers: [TracesService],
})
export class TracesModule {}
