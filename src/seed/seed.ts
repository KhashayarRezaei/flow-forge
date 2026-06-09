import 'reflect-metadata';
import { DataSource } from 'typeorm';
import configuration from '../config/configuration';
import { Workflow } from '../database/entities/workflow.entity';
import { WorkflowRun } from '../database/entities/workflow-run.entity';
import { StepRun } from '../database/entities/step-run.entity';
import { DeadLetter } from '../database/entities/dead-letter.entity';
import { validateWorkflow } from '../engine/dag';
import { EXAMPLE_WORKFLOW_NAME, exampleWorkflowDefinition } from './example-workflow';

/**
 * Idempotently seed the flagship example workflow. Safe to run repeatedly.
 * Usage: `npm run seed`
 */
async function seed() {
  // dotenv ships with @nestjs/config; load .env for standalone runs.
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('dotenv').config();
  } catch {
    /* optional */
  }
  const cfg = configuration();
  const ds = new DataSource({
    type: 'postgres',
    host: cfg.database.host,
    port: cfg.database.port,
    username: cfg.database.user,
    password: cfg.database.password,
    database: cfg.database.name,
    entities: [Workflow, WorkflowRun, StepRun, DeadLetter],
    synchronize: cfg.database.synchronize,
  });

  await ds.initialize();
  const repo = ds.getRepository(Workflow);

  validateWorkflow(exampleWorkflowDefinition);

  const existing = await repo.findOne({ where: { name: EXAMPLE_WORKFLOW_NAME } });
  if (existing) {
    existing.definition = exampleWorkflowDefinition;
    existing.version = exampleWorkflowDefinition.version ?? 1;
    existing.description =
      'Summarize a URL, extract action items, gate on approval, post to a webhook.';
    await repo.save(existing);
    // eslint-disable-next-line no-console
    console.log(`Updated example workflow: ${existing.id}`);
  } else {
    const created = await repo.save(
      repo.create({
        name: EXAMPLE_WORKFLOW_NAME,
        description: 'Summarize a URL, extract action items, gate on approval, post to a webhook.',
        version: exampleWorkflowDefinition.version ?? 1,
        definition: exampleWorkflowDefinition,
      }),
    );
    // eslint-disable-next-line no-console
    console.log(`Created example workflow: ${created.id}`);
  }

  await ds.destroy();
}

seed().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Seed failed:', err);
  process.exit(1);
});
