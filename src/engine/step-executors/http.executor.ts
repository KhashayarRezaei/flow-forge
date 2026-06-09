import { Injectable, Logger } from '@nestjs/common';
import { HttpStepDefinition } from '../../workflows/workflow.types';
import { RetryableError } from '../errors';
import { resolveTemplates } from '../template';
import { StepExecutionInput, StepExecutionResult, StepExecutor } from './step-executor.interface';

@Injectable()
export class HttpStepExecutor implements StepExecutor {
  readonly type = 'http' as const;
  private readonly logger = new Logger(HttpStepExecutor.name);

  async execute({ step, context }: StepExecutionInput): Promise<StepExecutionResult> {
    const def = step as HttpStepDefinition;
    const method = (def.config.method ?? 'GET').toUpperCase();
    const url = resolveTemplates(def.config.url, context);
    const headers = resolveTemplates(def.config.headers ?? {}, context) as Record<string, string>;
    const retryOnStatusGte = def.config.retryOnStatusGte ?? 500;

    let body: string | undefined;
    if (def.config.body !== undefined && method !== 'GET' && method !== 'DELETE') {
      const resolved = resolveTemplates(def.config.body, context);
      if (typeof resolved === 'string') {
        body = resolved;
      } else {
        body = JSON.stringify(resolved);
        if (!Object.keys(headers).some((h) => h.toLowerCase() === 'content-type')) {
          headers['content-type'] = 'application/json';
        }
      }
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), def.config.timeoutMs ?? 15_000);
    const startedAt = Date.now();
    let res: Response;
    try {
      res = await fetch(url, { method, headers, body, signal: controller.signal });
    } catch (err) {
      throw new RetryableError(
        `HTTP request to ${url} failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      clearTimeout(timeout);
    }

    const contentType = res.headers.get('content-type') ?? '';
    const rawText = await res.text();
    let parsedBody: unknown = rawText;
    if (contentType.includes('application/json') && rawText) {
      try {
        parsedBody = JSON.parse(rawText);
      } catch {
        parsedBody = rawText;
      }
    }

    const output = {
      status: res.status,
      ok: res.ok,
      url,
      method,
      durationMs: Date.now() - startedAt,
      headers: Object.fromEntries(res.headers.entries()),
      body: parsedBody,
    };

    if (res.status >= retryOnStatusGte) {
      this.logger.warn(`HTTP ${method} ${url} -> ${res.status} (retryable)`);
      throw new RetryableError(`HTTP ${res.status} from ${url}`);
    }

    return { output };
  }
}
