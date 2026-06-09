import {
  evaluateCondition,
  evaluateExpression,
  ExpressionError,
  resolveTemplates,
} from './template';
import { RunContext } from '../workflows/workflow.types';

const ctx: RunContext = {
  input: { url: 'https://x.com', count: 3 },
  steps: {
    a: {
      output: { text: 'hello', json: { priority: 'high', items: ['x', 'y'] } },
      status: 'completed',
    },
  },
};

describe('template', () => {
  it('evaluates expressions against input and steps', () => {
    expect(evaluateExpression('input.count + 1', ctx)).toBe(4);
    expect(evaluateExpression("steps.a.output.json.priority === 'high'", ctx)).toBe(true);
  });

  it('coerces conditions to boolean', () => {
    expect(evaluateCondition('input.count > 0', ctx)).toBe(true);
    expect(evaluateCondition('input.count > 10', ctx)).toBe(false);
  });

  it('blocks dangerous identifiers', () => {
    expect(() => evaluateExpression('process.exit(1)', ctx)).toThrow(ExpressionError);
    expect(() => evaluateExpression('global.foo', ctx)).toThrow(ExpressionError);
  });

  it('interpolates strings with multiple tokens', () => {
    expect(resolveTemplates('go to {{ input.url }} now', ctx)).toBe('go to https://x.com now');
  });

  it('preserves typed value for a whole-string single token', () => {
    expect(resolveTemplates('{{ input.count }}', ctx)).toBe(3);
    expect(resolveTemplates('{{ steps.a.output.json.items }}', ctx)).toEqual(['x', 'y']);
  });

  it('deep-resolves nested objects and arrays', () => {
    const out = resolveTemplates(
      {
        a: '{{ steps.a.output.text }}',
        nested: { n: '{{ input.count }}' },
        list: ['{{ input.url }}'],
      },
      ctx,
    );
    expect(out).toEqual({ a: 'hello', nested: { n: 3 }, list: ['https://x.com'] });
  });

  it('renders objects as JSON when interpolated mid-string', () => {
    expect(resolveTemplates('items: {{ steps.a.output.json.items }}!', ctx)).toBe(
      'items: ["x","y"]!',
    );
  });
});
