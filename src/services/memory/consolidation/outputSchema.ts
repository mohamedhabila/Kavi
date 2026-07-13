import type { StructuredOutputOptions } from '../../llm/support/contracts';

const nullableString = (maxLength: number): Record<string, unknown> => ({
  type: ['string', 'null'],
  maxLength,
});

export const MEMORY_CONSOLIDATION_OUTPUT_SCHEMA: StructuredOutputOptions = {
  name: 'memory_consolidation',
  mimeType: 'application/json',
  // Optional fact metadata must remain optional. Deterministic admission code,
  // not the provider schema, decides which proposed fields carry authority.
  strict: false,
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['new_facts', 'episode_summary', 'active_focus', 'open_threads', 'notable'],
    properties: {
      new_facts: {
        type: 'array',
        maxItems: 5,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['subject', 'predicate', 'value'],
          properties: {
            subject: { type: 'string', minLength: 1, maxLength: 80 },
            predicate: { type: 'string', minLength: 1, maxLength: 80 },
            value: { type: 'string', minLength: 1, maxLength: 200 },
            scope: {
              type: 'string',
              enum: ['global', 'project', 'conversation', 'session'],
            },
            importance: { type: 'number', minimum: 0, maximum: 1 },
            confidence: { type: 'number', minimum: 0, maximum: 1 },
            evidence_message_ids: {
              type: 'array',
              maxItems: 8,
              items: { type: 'string', minLength: 1, maxLength: 120 },
            },
            operation: { type: 'string', enum: ['insert', 'replace_current'] },
            assertion_class: {
              type: 'string',
              enum: [
                'current_direct',
                'historical',
                'hypothetical',
                'quoted',
                'third_party',
                'uncertain',
              ],
            },
            evidence_quote: { type: 'string', minLength: 1, maxLength: 600 },
            reason: { type: 'string', minLength: 1, maxLength: 240 },
          },
        },
      },
      episode_summary: nullableString(1_200),
      active_focus: nullableString(600),
      open_threads: {
        type: 'array',
        maxItems: 5,
        items: { type: 'string', minLength: 1, maxLength: 80 },
      },
      notable: {
        type: 'array',
        maxItems: 2,
        items: { type: 'string', minLength: 1, maxLength: 200 },
      },
    },
  },
};
