import 'reflect-metadata';
import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { AppConfig } from './config/configuration';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: false });
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: false }),
  );
  app.enableShutdownHooks();

  const config = app.get(ConfigService) as ConfigService<AppConfig, true>;
  const port = config.get('port', { infer: true });
  await app.listen(port);

  const logger = new Logger('Bootstrap');
  logger.log(`FlowForge listening on http://localhost:${port}`);
  logger.log(`Trace viewer:   http://localhost:${port}/viewer/`);
  logger.log(`Health:         http://localhost:${port}/health`);
}

void bootstrap();
