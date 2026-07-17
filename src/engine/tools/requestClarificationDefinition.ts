import type { ToolDefinition } from '../../types/tool';
import {
  MAX_REQUEST_CLARIFICATION_FIELDS,
  MAX_REQUEST_CLARIFICATION_QUESTION_CHARACTERS,
  REQUEST_CLARIFICATION_TOOL_NAME,
  REQUEST_INFORMATION_KEY_PATTERN,
} from '../../services/agents/requestClarification';

export const REQUEST_CLARIFICATION_TOOL: ToolDefinition = {
  name: REQUEST_CLARIFICATION_TOOL_NAME,
  description:
    'Register user-owned information that is genuinely required before safe or complete execution, then end the turn with one focused question. ' +
    'Use this instead of a prose-only clarification when the missing information cannot be obtained from current context, memory, or a read-only tool. ' +
    'A retrieved memory fact labeled policy=use already resolves the parameter it supplies, so do not request that information again. ' +
    'Do not combine this call with another tool call. Use stable semantic field keys independent of the user-facing language.',
  input_schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      missing_information: {
        type: 'array',
        minItems: 1,
        maxItems: MAX_REQUEST_CLARIFICATION_FIELDS,
        description:
          'Required user-owned fields. Use concise lower_snake_case or dotted semantic keys such as recipient, message_body, date_time, location, or account.selection.',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            key: {
              type: 'string',
              pattern: REQUEST_INFORMATION_KEY_PATTERN.source,
              description: 'Stable semantic field key; never copy the user-facing question here.',
            },
            required_for: {
              type: 'string',
              enum: ['understanding', 'execution'],
              description:
                'Whether the field is needed to understand the request or to execute it.',
            },
            semantic_role: {
              type: 'string',
              enum: [
                'authorization',
                'constraint',
                'content',
                'identifier',
                'location',
                'other',
                'preference',
                'quantity',
                'recipient',
                'selection',
                'time',
                'title',
              ],
              description:
                'Canonical semantic role. Use recipient for a target person/address; content for a message body, topic, intent, or material to compose; time for dates or times; title for names or headings; selection for choosing among options; other only when no listed role fits.',
            },
          },
          required: ['key', 'required_for', 'semantic_role'],
        },
      },
      question: {
        type: 'string',
        minLength: 1,
        maxLength: MAX_REQUEST_CLARIFICATION_QUESTION_CHARACTERS,
        description:
          "One concise user-facing question in the user's language that asks for all registered fields.",
      },
    },
    required: ['missing_information', 'question'],
  },
  strict: true,
  contract: {
    category: 'interaction',
    capabilities: ['coordinate'],
    resourceKinds: ['conversation_workspace'],
    sideEffects: ['none'],
    riskHints: ['read_only', 'idempotent'],
    providesEvidence: [],
    workflowStages: [],
    outputSchema: {
      type: 'object',
      required: ['schemaVersion', 'status', 'question', 'requiredInformation'],
    },
  },
};
