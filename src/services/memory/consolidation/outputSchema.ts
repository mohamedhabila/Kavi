import type { StructuredOutputOptions } from '../../llm/support/contracts';
import { MEMORY_FACT_SENSITIVITY_LEVELS } from '../facts/applicabilityProvenance';
import {
  SEMANTIC_FACT_ASSERTION_CLASSES,
  SEMANTIC_FACT_PROPOSAL_OPERATIONS,
  SEMANTIC_FACT_PROPOSAL_SCOPES,
  SEMANTIC_FACT_PROPOSAL_VERSION,
} from '../semanticFactProposal';

const nullableString = (maxLength: number): Record<string, unknown> => ({
  type: ['string', 'null'],
  maxLength,
});

export const MEMORY_CONSOLIDATION_OUTPUT_SCHEMA: StructuredOutputOptions = {
  name: 'memory_consolidation',
  mimeType: 'application/json',
  strict: true,
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
          required: [
            'version',
            'subject_ref',
            'predicate',
            'value',
            'scope',
            'importance',
            'confidence',
            'source_message_id',
            'operation',
            'assertion_class',
            'evidence_quote',
            'sensitivity',
          ],
          properties: {
            version: { type: 'integer', enum: [SEMANTIC_FACT_PROPOSAL_VERSION] },
            subject_ref: {
              anyOf: [
                {
                  type: 'object',
                  additionalProperties: false,
                  required: ['kind'],
                  properties: { kind: { type: 'string', enum: ['self'] } },
                },
                {
                  type: 'object',
                  additionalProperties: false,
                  required: ['kind', 'label'],
                  properties: {
                    kind: { type: 'string', enum: ['named'] },
                    label: { type: 'string', minLength: 1, maxLength: 80 },
                  },
                },
              ],
            },
            predicate: { type: 'string', minLength: 1, maxLength: 80 },
            value: { type: 'string', minLength: 1, maxLength: 200 },
            scope: {
              type: 'string',
              enum: [...SEMANTIC_FACT_PROPOSAL_SCOPES],
            },
            importance: { type: 'number', minimum: 0, maximum: 1 },
            confidence: { type: 'number', minimum: 0, maximum: 1 },
            source_message_id: { type: 'string', minLength: 1, maxLength: 120 },
            operation: { type: 'string', enum: [...SEMANTIC_FACT_PROPOSAL_OPERATIONS] },
            assertion_class: {
              type: 'string',
              enum: [...SEMANTIC_FACT_ASSERTION_CLASSES],
            },
            evidence_quote: { type: 'string', minLength: 1, maxLength: 600 },
            sensitivity: { type: 'string', enum: [...MEMORY_FACT_SENSITIVITY_LEVELS] },
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
