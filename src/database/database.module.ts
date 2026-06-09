import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppConfig } from '../config/configuration';
import { Workflow } from './entities/workflow.entity';
import { WorkflowRun } from './entities/workflow-run.entity';
import { StepRun } from './entities/step-run.entity';
import { DeadLetter } from './entities/dead-letter.entity';

export const ENTITIES = [Workflow, WorkflowRun, StepRun, DeadLetter];

@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<AppConfig, true>) => {
        const db = config.get('database', { infer: true });
        return {
          type: 'postgres',
          host: db.host,
          port: db.port,
          username: db.user,
          password: db.password,
          database: db.name,
          entities: ENTITIES,
          synchronize: db.synchronize,
          logging: ['error'],
        };
      },
    }),
  ],
})
export class DatabaseModule {}
