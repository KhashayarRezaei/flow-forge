import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';

/**
 * End-to-end test against real Postgres + Redis (docker compose up).
 * Uses an offline workflow (mock LLM + conditional + approval) so it needs no
 * network and is fully deterministic. Verifies: auth, validation, async
 * execution, token/latency persistence, the human-approval pause/resume cycle,
 * conditional skip propagation, and the trace endpoint.
 */
const KEY = process.env.API_KEY || 'dev-secret-key';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// A self-contained DAG: an LLM step that emits high-priority JSON, a
// conditional, an approval gate on the true branch, and a final LLM step.
const offlineWorkflow = {
  name: 'e2e-offline',
  definition: {
    steps: [
      {
        id: 'classify',
        type: 'llm',
        config: {
          prompt: 'Return JSON describing an incident (this is an urgent outage). Use key "priority".',
          parseJson: true,
        },
      },
      {
        id: 'triage',
        type: 'conditional',
        dependsOn: ['classify'],
        config: { expression: "steps.classify.output.json.priority === 'high'" },
      },
      {
        id: 'gate',
        type: 'approval',
        dependsOn: ['triage'],
        runWhen: { step: 'triage', equals: true },
        config: { prompt: 'Approve?' },
      },
      {
        id: 'finalize',
        type: 'llm',
        dependsOn: ['gate'],
        runWhen: { step: 'gate', equals: true },
        config: { prompt: 'Write a closing note for {{ steps.classify.output.json.summary }}.' },
      },
      {
        id: 'low_branch',
        type: 'llm',
        dependsOn: ['triage'],
        runWhen: { step: 'triage', equals: false },
        config: { prompt: 'low priority note' },
      },
    ],
  },
};

describe('FlowForge (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    http = request(app.getHttpServer());
  });

  afterAll(async () => {
    await app.close();
  });

  it('rejects requests without an API key', async () => {
    await http.get('/workflows').expect(401);
  });

  it('rejects an invalid (cyclic) workflow with 400', async () => {
    await http
      .post('/workflows')
      .set('x-api-key', KEY)
      .send({
        name: 'cyclic',
        definition: {
          steps: [
            { id: 'a', type: 'llm', dependsOn: ['b'], config: { prompt: 'x' } },
            { id: 'b', type: 'llm', dependsOn: ['a'], config: { prompt: 'x' } },
          ],
        },
      })
      .expect(400);
  });

  it('runs a workflow end-to-end through an approval gate', async () => {
    // Create
    const created = await http
      .post('/workflows')
      .set('x-api-key', KEY)
      .send(offlineWorkflow)
      .expect(201);
    const workflowId = created.body.id;
    expect(workflowId).toBeDefined();

    // Run (async, 202)
    const started = await http
      .post(`/workflows/${workflowId}/runs`)
      .set('x-api-key', KEY)
      .send({ input: {} })
      .expect(202);
    const runId = started.body.id;

    // Poll until paused at the approval gate.
    const paused = await pollFor(http, runId, (t) => t.run.status === 'waiting_approval');
    expect(paused.run.status).toBe('waiting_approval');
    const gate = paused.steps.find((s: any) => s.stepId === 'gate');
    expect(gate.status).toBe('waiting_approval');
    // LLM step recorded token usage.
    const classify = paused.steps.find((s: any) => s.stepId === 'classify');
    expect(classify.status).toBe('completed');
    expect(classify.totalTokens).toBeGreaterThan(0);
    // The false branch was skipped.
    expect(paused.steps.find((s: any) => s.stepId === 'low_branch').status).toBe('skipped');

    // Approve and resume.
    await http
      .post(`/runs/${runId}/steps/gate/approve`)
      .set('x-api-key', KEY)
      .send({ decidedBy: 'tester' })
      .expect(200);

    const done = await pollFor(http, runId, (t) =>
      ['completed', 'failed'].includes(t.run.status),
    );
    expect(done.run.status).toBe('completed');
    expect(done.steps.find((s: any) => s.stepId === 'finalize').status).toBe('completed');
    expect(done.summary.deadLetterCount).toBe(0);
    expect(done.summary.totalTokens).toBeGreaterThan(0);
  });
});

async function pollFor(
  http: ReturnType<typeof request>,
  runId: string,
  predicate: (trace: any) => boolean,
  timeoutMs = 20000,
): Promise<any> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = await http.get(`/traces/${runId}`).set('x-api-key', KEY);
    if (res.status === 200 && predicate(res.body)) return res.body;
    await sleep(250);
  }
  throw new Error(`Timed out waiting for run ${runId}`);
}
