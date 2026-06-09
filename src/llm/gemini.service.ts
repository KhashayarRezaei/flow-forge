import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppConfig } from '../config/configuration';
import { RetryableError } from '../engine/errors';

export interface LlmRequest {
  prompt: string;
  system?: string;
  model?: string;
  temperature?: number;
  maxOutputTokens?: number;
}

export interface LlmResult {
  text: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  /** True when produced by the deterministic offline mock. */
  mock: boolean;
}

/**
 * Thin client for Google's Gemini (Generative Language API, free tier).
 *
 * When GEMINI_API_KEY is not configured the service runs in MOCK mode and
 * returns a deterministic response derived from the prompt, so the whole engine
 * is runnable offline / in CI without secrets. Transient upstream failures
 * (HTTP 429 / 5xx, network errors, timeouts) are thrown as RetryableError so
 * the BullMQ worker retries them with backoff.
 */
@Injectable()
export class GeminiService {
  private readonly logger = new Logger(GeminiService.name);
  private readonly apiKey?: string;
  private readonly defaultModel: string;
  private readonly baseUrl: string;

  constructor(config: ConfigService<AppConfig, true>) {
    const llm = config.get('llm', { infer: true });
    this.apiKey = llm.apiKey;
    this.defaultModel = llm.model;
    this.baseUrl = llm.baseUrl;
  }

  get isMock(): boolean {
    return !this.apiKey;
  }

  async generate(req: LlmRequest): Promise<LlmResult> {
    const model = req.model || this.defaultModel;
    if (this.isMock) {
      return this.mockGenerate(req, model);
    }
    return this.realGenerate(req, model);
  }

  private async realGenerate(req: LlmRequest, model: string): Promise<LlmResult> {
    const url = `${this.baseUrl}/models/${model}:generateContent?key=${this.apiKey}`;
    const body = {
      systemInstruction: req.system ? { role: 'system', parts: [{ text: req.system }] } : undefined,
      contents: [{ role: 'user', parts: [{ text: req.prompt }] }],
      generationConfig: {
        temperature: req.temperature ?? 0.7,
        maxOutputTokens: req.maxOutputTokens ?? 1024,
      },
    };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);
    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (err) {
      // Network errors / aborts are transient.
      throw new RetryableError(
        `Gemini request failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      clearTimeout(timeout);
    }

    if (res.status === 429 || res.status >= 500) {
      const detail = await res.text().catch(() => '');
      throw new RetryableError(`Gemini transient error ${res.status}: ${detail.slice(0, 500)}`);
    }
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      // 4xx (bad request, auth) are non-retryable.
      throw new Error(`Gemini error ${res.status}: ${detail.slice(0, 500)}`);
    }

    const data: any = await res.json();
    const text: string =
      data?.candidates?.[0]?.content?.parts?.map((p: any) => p.text).join('') ?? '';
    const usage = data?.usageMetadata ?? {};
    const promptTokens = usage.promptTokenCount ?? 0;
    const completionTokens = usage.candidatesTokenCount ?? 0;
    return {
      text,
      model,
      promptTokens,
      completionTokens,
      totalTokens: usage.totalTokenCount ?? promptTokens + completionTokens,
      mock: false,
    };
  }

  /**
   * Deterministic offline response. Produces a short "summary" plus, when the
   * prompt asks for JSON, a small JSON object — enough for the seeded workflow
   * to exercise every step type end-to-end without a network call.
   */
  private mockGenerate(req: LlmRequest, model: string): LlmResult {
    const prompt = req.prompt.trim();
    const wantsJson = /json/i.test(prompt);
    const firstWords = prompt.replace(/\s+/g, ' ').slice(0, 180);

    let text: string;
    if (wantsJson) {
      const items = prompt
        .split(/[\n.]/)
        .map((s) => s.trim())
        .filter((s) => s.length > 12)
        .slice(0, 3)
        .map((s, i) => `Action ${i + 1}: ${s.slice(0, 60)}`);
      const highPriority = /incident|urgent|outage|severity|critical|breach|rollback/i.test(prompt);
      text = JSON.stringify(
        {
          summary: `Mock summary of input (${prompt.length} chars).`,
          action_items: items.length ? items : ['Action 1: follow up'],
          priority: highPriority ? 'high' : 'low',
        },
        null,
        2,
      );
    } else {
      text = `Mock LLM (${model}) response. Context: "${firstWords}"`;
    }

    const promptTokens = Math.ceil(prompt.length / 4);
    const completionTokens = Math.ceil(text.length / 4);
    this.logger.debug(`mock generate: model=${model} promptTokens=${promptTokens}`);
    return {
      text,
      model: `${model} (mock)`,
      promptTokens,
      completionTokens,
      totalTokens: promptTokens + completionTokens,
      mock: true,
    };
  }
}
