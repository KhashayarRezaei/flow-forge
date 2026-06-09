# FlowForge — Agent Orchestration / Workflow Engine

A backend service that runs multi-step LLM **workflows** as **durable, observable jobs**.
Define a workflow as a DAG of LLM calls + tool calls, submit it over an HTTP API, and it
executes asynchronously with retries, persists every step (input / output / tokens / latency),
and exposes full execution traces.

This is an "automation platform" thesis in miniature: the kind of infrastructure a founding
backend engineer would build for an agent product.

```
 ┌──────────┐   POST /workflows/:id/runs    ┌───────────────┐   enqueue   ┌─────────────┐
 │  Client  │ ────────────────────────────▶ │  NestJS API   │ ──────────▶ │ BullMQ /    │
 └──────────┘                               │ (api-key auth)│             │ Redis queue │
      ▲                                      └──────┬────────┘             └──────┬──────┘
      │ GET /traces/:id                             │ persist                      │ consume
      │                                       ┌─────▼────────┐              ┌──────▼───────┐
      └────────────────────────────────────  │  PostgreSQL  │ ◀─────────── │ Engine worker│
        full execution tree (steps, tokens,   │ workflows /  │   persist    │ (orchestrator│
        latency, retries, dead-letters)       │ runs / steps │   each step  │  + executors)│
                                              └──────────────┘              └──────────────┘
```

## Stack

- **NestJS** (TypeScript) — modular HTTP API + DI
- **PostgreSQL** + **TypeORM** — durable persistence of workflows, runs, steps, dead-letters
- **BullMQ** on **Redis** — async job queue with per-step retries & exponential backoff
- **Google Gemini** (free tier) for LLM steps, with a **deterministic offline mock** so the
  whole engine runs with zero secrets / zero network

## Features

- **DAG workflows.** Steps declare `dependsOn` edges; the engine validates the graph
  (unique ids, known types, resolvable refs, acyclic) before accepting it.
- **4 built-in step types:**
  - `llm` — Gemini call; captures prompt/completion/total **tokens** and **latency**; optional `parseJson`.
  - `http` — outbound HTTP tool call; configurable method/headers/body/timeout; retryable on 5xx.
  - `conditional` — boolean expression that gates downstream branches.
  - `approval` — **human-approval gate** that pauses the run until approved/rejected via the API.
- **Data flow between steps** via `{{ ... }}` templating resolved against `{ input, steps }`
  (e.g. `{{ steps.summarize.output.text }}`).
- **Durable & observable.** Every step row stores resolved input, output, error, attempt count,
  token usage, latency, and timestamps. `GET /traces/:id` returns the full execution tree.
- **Retries, idempotency & dead-letters.**
  - Transient failures (LLM 429/5xx, network blips, HTTP 5xx) are retried with exponential backoff.
  - Permanent failures fail fast (`UnrecoverableError`) without burning attempts.
  - Steps are claimed atomically (`PENDING → RUNNING`) and re-entrant — at-least-once delivery is safe.
  - Run submission supports an `idempotencyKey` (one run per key).
  - Exhausted jobs are written to a **dead-letter** table for inspection/replay.
- **Read-only HTML trace viewer** at `/viewer/`.
- **Auth:** a single shared API key (`x-api-key` header or `Authorization: Bearer`). No users,
  no multi-tenancy — intentionally out of scope.

## Quick start

```bash
# 1. Infra (Postgres + Redis)
docker compose up -d

# 2. Install & configure
npm install
cp .env.example .env        # GEMINI_API_KEY blank => offline mock mode

# 3. Seed the flagship example workflow (also creates the schema)
npm run seed

# 4. Run
npm run start:dev           # http://localhost:3000
```

Open the trace viewer at **http://localhost:3000/viewer/** (default key `dev-secret-key`).

> **LLM mode:** leave `GEMINI_API_KEY` empty to use the deterministic offline mock (great for
> CI/demo). Set it to a real key to call Gemini for `llm` steps.

## The seeded example workflow

`URL → Summary → Action Items → Webhook` exercises every step type plus branching and a gate:

```
fetch_url (http) ─▶ summarize (llm) ─▶ extract_actions (llm/json) ─▶ triage (conditional)
                                                                          │
              priority = high  ┌───────────────────────────────────────────┤  priority ≠ high
                               ▼                                             ▼
                     human_review (approval) ──approved──▶ post_high (http)  post_low (http)
```

## API

All routes except `/health` and `/viewer/*` require the API key.

| Method | Path | Description |
| --- | --- | --- |
| `POST` | `/workflows` | Create a workflow (validates the DAG) |
| `GET` | `/workflows` | List workflows |
| `GET` | `/workflows/:id` | Get a workflow |
| `DELETE` | `/workflows/:id` | Delete a workflow |
| `POST` | `/workflows/:id/runs` | **Submit a run** (async → `202`); body `{ input?, idempotencyKey? }` |
| `GET` | `/workflows/:id/runs` | List runs for a workflow |
| `GET` | `/runs` | List recent runs (`?workflowId=`) |
| `GET` | `/runs/:id` | Get a run |
| `POST` | `/runs/:id/steps/:stepId/approve` | Approve a paused gate (resumes the run) |
| `POST` | `/runs/:id/steps/:stepId/reject` | Reject a paused gate (gated branch is skipped) |
| `GET` | `/traces/:id` | **Full execution trace**: run header, ordered steps, dependency tree, token/latency totals, dead-letters |
| `GET` | `/health` | Liveness |

### Example: submit, approve, trace

```bash
KEY=dev-secret-key
WF=$(curl -s localhost:3000/workflows -H "x-api-key: $KEY" | jq -r '.[0].id')

# Submit a run (returns immediately)
RUN=$(curl -s -X POST localhost:3000/workflows/$WF/runs \
  -H "x-api-key: $KEY" -H 'content-type: application/json' \
  -d '{"input":{"url":"https://example.com","webhookUrl":"https://httpbin.org/post"}}' \
  | jq -r '.id')

# Poll the trace; for a high-priority page it pauses at the approval gate
curl -s localhost:3000/traces/$RUN -H "x-api-key: $KEY" | jq '.run.status'

# Approve the gate -> run resumes and posts to the webhook
curl -s -X POST localhost:3000/runs/$RUN/steps/human_review/approve \
  -H "x-api-key: $KEY" -H 'content-type: application/json' \
  -d '{"decidedBy":"me","note":"ship it"}'
```

See [`requests.http`](./requests.http) for a ready-to-run set of requests.

## Defining a workflow

```jsonc
{
  "name": "My workflow",
  "definition": {
    "steps": [
      { "id": "fetch", "type": "http", "config": { "method": "GET", "url": "{{ input.url }}" } },
      { "id": "sum",   "type": "llm",  "dependsOn": ["fetch"],
        "config": { "prompt": "Summarize: {{ steps.fetch.output.body }}" } },
      { "id": "isBig", "type": "conditional", "dependsOn": ["sum"],
        "config": { "expression": "input.notify === true" } },
      { "id": "gate",  "type": "approval", "dependsOn": ["isBig"],
        "runWhen": { "step": "isBig", "equals": true } },
      { "id": "post",  "type": "http", "dependsOn": ["gate"],
        "runWhen": { "step": "gate", "equals": true },
        "config": { "method": "POST", "url": "{{ input.hook }}",
                    "body": { "summary": "{{ steps.sum.output.text }}" } } }
    ]
  }
}
```

- `dependsOn` defines DAG edges. A step runs once all dependencies reach a terminal state.
- `runWhen: { step, equals }` gates a step on another step's boolean `output.result`
  (conditional steps and approval gates both expose `result`). A guard that fails marks the
  step `skipped`, and skips **propagate** to descendants — that's how a branch is pruned.
- Templates: a whole-string token like `{{ steps.x.output.json }}` preserves the typed value;
  mixed strings interpolate.

## How it works

1. `POST /runs` creates the `WorkflowRun` + one `StepRun` per step (all `PENDING`) and enqueues
   an `advance` job.
2. **`advance`** (orchestration tick) loads step states, runs the pure
   [`planner`](./src/engine/planner.ts) (skip propagation + readiness + run-status), persists
   skips and the new run status, and enqueues a `step` job for each ready step.
3. **`step`** jobs atomically claim the step, run the matching executor, persist
   output/tokens/latency, then enqueue the next `advance`. Approval steps raise a pause signal
   instead of completing.
4. On transient failure the job throws → BullMQ retries with exponential backoff. When attempts
   are exhausted (or the error is unrecoverable) the worker's `failed` handler marks the
   step/run failed and writes a **dead-letter** record.

Idempotency: deterministic `step:<runId>:<stepId>` job ids collapse duplicate enqueues, and the
atomic `PENDING → RUNNING` claim guarantees a step body runs once even under at-least-once
delivery and concurrency.

## Project layout

```
src/
  common/        api-key guard, status enums
  config/        typed env configuration
  database/      TypeORM entities (workflow, run, step, dead-letter) + module
  llm/           Gemini client (+ offline mock)
  engine/        the orchestrator
    dag.ts            graph validation + topo sort        (unit-tested)
    template.ts       {{ }} resolver + safe expr eval      (unit-tested)
    planner.ts        pure scheduling decision per tick    (unit-tested)
    engine.service.ts orchestration, step execution, retry/DLQ wiring
    engine.processor.ts  BullMQ worker
    step-executors/   llm | http | conditional | approval
  workflows/     workflow CRUD + run submission API
  runs/          run queries + approval endpoints
  traces/        execution-tree assembly + endpoint
  seed/          flagship example workflow + seeder
public/          read-only HTML trace viewer
test/            e2e spec + local echo server
```

## Tests

```bash
npm test         # unit: template / dag / planner (no infra needed)
npm run test:e2e # e2e: full run incl. approval pause/resume (needs docker compose up)
```

The unit suite covers the pure engine logic (expression sandbox, DAG validation/cycle
detection, branch skip-propagation, run-status computation). The e2e suite boots the app
against real Postgres + Redis and drives a workflow through an approval gate to completion.

## Configuration

See [`.env.example`](./.env.example). Key knobs:

| Var | Default | Meaning |
| --- | --- | --- |
| `API_KEY` | `dev-secret-key` | shared API key |
| `STEP_MAX_ATTEMPTS` | `3` | per-step retry attempts |
| `STEP_BACKOFF_MS` | `1000` | exponential backoff base |
| `ENGINE_CONCURRENCY` | `5` | concurrent step jobs per worker |
| `GEMINI_API_KEY` | _(empty)_ | empty ⇒ offline mock mode |
| `DATABASE_SYNC` | `true` | auto-create schema from entities (demo only) |

## Deliberately out of scope

No fancy UI beyond the read-only trace viewer, no auth beyond the API key, no multi-tenancy.

## License

MIT
