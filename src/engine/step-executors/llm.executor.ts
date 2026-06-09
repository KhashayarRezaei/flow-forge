import { Injectable } from '@nestjs/common';
import { GeminiService } from '../../llm/gemini.service';
import { LlmStepDefinition } from '../../workflows/workflow.types';
import { resolveTemplates } from '../template';
import { StepExecutionInput, StepExecutionResult, StepExecutor } from './step-executor.interface';

@Injectable()
export class LlmStepExecutor implements StepExecutor {
  readonly type = 'llm' as const;

  constructor(private readonly gemini: GeminiService) {}

  async execute({ step, context }: StepExecutionInput): Promise<StepExecutionResult> {
    const def = step as LlmStepDefinition;
    const prompt = resolveTemplates(def.config.prompt, context);
    const system = def.config.system ? resolveTemplates(def.config.system, context) : undefined;

    const result = await this.gemini.generate({
      prompt,
      system,
      model: def.config.model,
      temperature: def.config.temperature,
      maxOutputTokens: def.config.maxOutputTokens,
    });

    let json: unknown;
    let parseError: string | undefined;
    if (def.config.parseJson) {
      try {
        json = JSON.parse(extractJson(result.text));
      } catch (err) {
        parseError = err instanceof Error ? err.message : String(err);
      }
    }

    return {
      output: {
        text: result.text,
        ...(def.config.parseJson ? { json, parseError } : {}),
        model: result.model,
        mock: result.mock,
      },
      promptTokens: result.promptTokens,
      completionTokens: result.completionTokens,
      totalTokens: result.totalTokens,
    };
  }
}

/** Pull a JSON object/array out of a possibly fenced or chatty model reply. */
function extractJson(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) return fenced[1].trim();
  const start = text.search(/[[{]/);
  const end = Math.max(text.lastIndexOf('}'), text.lastIndexOf(']'));
  if (start !== -1 && end !== -1 && end > start) {
    return text.slice(start, end + 1);
  }
  return text.trim();
}
