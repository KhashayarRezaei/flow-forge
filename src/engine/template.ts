import { RunContext } from '../workflows/workflow.types';

/**
 * Minimal, dependency-free templating + expression evaluation for workflow data
 * flow. Workflow definitions are trusted (they are submitted through an
 * API-key-protected endpoint), so expressions are evaluated with `Function`
 * against a frozen `{ input, steps }` context. We expose nothing else from
 * scope, and block obvious escape hatches.
 *
 * Two surfaces:
 *  - `evaluateExpression(expr, ctx)` -> the raw evaluated value (used by
 *    conditional steps and `runWhen` guards).
 *  - `resolveTemplates(value, ctx)` -> deep-clones `value`, replacing any
 *    `{{ expr }}` occurrences inside strings. If a string is exactly one
 *    `{{ expr }}` token, the original (non-string) typed value is preserved.
 */

const BLOCKLIST =
  /\b(process|require|globalThis|global|module|eval|Function|constructor|__proto__|import)\b/;

export class ExpressionError extends Error {
  constructor(
    public readonly expression: string,
    public readonly cause: unknown,
  ) {
    super(
      `Failed to evaluate expression "${expression}": ${
        cause instanceof Error ? cause.message : String(cause)
      }`,
    );
    this.name = 'ExpressionError';
  }
}

export function evaluateExpression(expression: string, ctx: RunContext): unknown {
  if (BLOCKLIST.test(expression)) {
    throw new ExpressionError(expression, new Error('expression contains a blocked identifier'));
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    const fn = new Function('input', 'steps', `"use strict"; return (${expression});`);
    return fn(ctx.input, ctx.steps);
  } catch (err) {
    throw new ExpressionError(expression, err);
  }
}

export function evaluateCondition(expression: string, ctx: RunContext): boolean {
  return Boolean(evaluateExpression(expression, ctx));
}

const TEMPLATE_RE = /\{\{([\s\S]+?)\}\}/g;
const SINGLE_TEMPLATE_RE = /^\s*\{\{([\s\S]+?)\}\}\s*$/;

function resolveString(str: string, ctx: RunContext): unknown {
  // Whole-string single token -> keep the typed value (numbers, objects, ...).
  const single = str.match(SINGLE_TEMPLATE_RE);
  if (single) {
    return evaluateExpression(single[1].trim(), ctx);
  }
  // Otherwise interpolate each token into the string.
  return str.replace(TEMPLATE_RE, (_match, expr: string) => {
    const value = evaluateExpression(expr.trim(), ctx);
    if (value === null || value === undefined) return '';
    return typeof value === 'object' ? JSON.stringify(value) : String(value);
  });
}

export function resolveTemplates<T>(value: T, ctx: RunContext): T {
  if (typeof value === 'string') {
    return resolveString(value, ctx) as T;
  }
  if (Array.isArray(value)) {
    return value.map((item) => resolveTemplates(item, ctx)) as unknown as T;
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = resolveTemplates(v, ctx);
    }
    return out as T;
  }
  return value;
}
