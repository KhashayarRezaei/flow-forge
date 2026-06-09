import { WorkflowDefinition } from '../workflows/workflow.types';

/**
 * Flagship example workflow. Exercises all four step types plus conditional
 * branching and a human-approval gate:
 *
 *   fetch_url (http) ─▶ summarize (llm) ─▶ extract_actions (llm/json) ─▶ triage (conditional)
 *                                                                             │
 *                          ┌──────────────────────────────────────────────────┤
 *           priority=high  │                                                    │ priority!=high
 *                          ▼                                                    ▼
 *                 human_review (approval) ── approved ──▶ post_high (http)   post_low (http)
 *
 * Data flows between steps with {{ ... }} templates resolved against
 * { input, steps }.
 */
export const EXAMPLE_WORKFLOW_NAME = 'URL → Summary → Action Items → Webhook';

export const exampleWorkflowDefinition: WorkflowDefinition = {
  version: 1,
  defaultInput: {
    url: 'https://example.com',
    webhookUrl: 'https://httpbin.org/post',
  },
  steps: [
    {
      id: 'fetch_url',
      type: 'http',
      name: 'Fetch URL contents',
      config: {
        method: 'GET',
        url: '{{ input.url }}',
        timeoutMs: 15000,
      },
    },
    {
      id: 'summarize',
      type: 'llm',
      name: 'Summarize page',
      dependsOn: ['fetch_url'],
      config: {
        system: 'You are a precise summarizer. Reply with 2-3 sentences.',
        prompt:
          'Summarize the following web page content fetched from {{ input.url }}:\n\n{{ steps.fetch_url.output.body }}',
        maxOutputTokens: 256,
      },
    },
    {
      id: 'extract_actions',
      type: 'llm',
      name: 'Extract action items (JSON)',
      dependsOn: ['summarize'],
      config: {
        prompt:
          'From this summary, extract action items as JSON with keys ' +
          '"summary" (string), "action_items" (string array) and "priority" ' +
          '("high" or "low"). Summary:\n\n{{ steps.summarize.output.text }}',
        parseJson: true,
        maxOutputTokens: 512,
      },
    },
    {
      id: 'triage',
      type: 'conditional',
      name: 'Is this high priority?',
      dependsOn: ['extract_actions'],
      config: {
        expression: "steps.extract_actions.output.json.priority === 'high'",
      },
    },
    {
      id: 'human_review',
      type: 'approval',
      name: 'Human sign-off (high priority only)',
      dependsOn: ['triage'],
      runWhen: { step: 'triage', equals: true },
      config: {
        prompt:
          'High-priority items detected. Approve posting to the webhook?\n' +
          'Actions: {{ steps.extract_actions.output.json.action_items }}',
      },
    },
    {
      id: 'post_high',
      type: 'http',
      name: 'Post to webhook (after approval)',
      dependsOn: ['human_review'],
      runWhen: { step: 'human_review', equals: true },
      config: {
        method: 'POST',
        url: '{{ input.webhookUrl }}',
        body: {
          source: '{{ input.url }}',
          priority: 'high',
          approvedBy: '{{ steps.human_review.output.decidedBy }}',
          summary: '{{ steps.extract_actions.output.json.summary }}',
          action_items: '{{ steps.extract_actions.output.json.action_items }}',
        },
      },
    },
    {
      id: 'post_low',
      type: 'http',
      name: 'Post to webhook (auto, low priority)',
      dependsOn: ['triage'],
      runWhen: { step: 'triage', equals: false },
      config: {
        method: 'POST',
        url: '{{ input.webhookUrl }}',
        body: {
          source: '{{ input.url }}',
          priority: 'low',
          summary: '{{ steps.extract_actions.output.json.summary }}',
          action_items: '{{ steps.extract_actions.output.json.action_items }}',
        },
      },
    },
  ],
};
