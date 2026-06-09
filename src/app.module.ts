import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ServeStaticModule } from '@nestjs/serve-static';
import { join } from 'path';
import configuration from './config/configuration';
import { DatabaseModule } from './database/database.module';
import { EngineModule } from './engine/engine.module';
import { WorkflowsModule } from './workflows/workflows.module';
import { RunsModule } from './runs/runs.module';
import { TracesModule } from './traces/traces.module';
import { HealthController } from './health.controller';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      envFilePath: ['.env'],
    }),
    // Read-only trace viewer (static HTML/JS). Served at /viewer; API routes
    // live at their own prefixes and are unaffected.
    ServeStaticModule.forRoot({
      rootPath: join(__dirname, '..', 'public'),
      serveRoot: '/viewer',
    }),
    DatabaseModule,
    EngineModule,
    WorkflowsModule,
    RunsModule,
    TracesModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
