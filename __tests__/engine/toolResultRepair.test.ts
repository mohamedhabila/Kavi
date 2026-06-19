import { enrichToolResultWithSchemaRepair } from '../../src/engine/toolExecution/toolResultRepair';
import type { ToolDefinition } from '../../src/types/tool';

const calendarCreateTool: ToolDefinition = {
  name: 'calendar_create_event',
  description: 'Create a calendar event.',
  input_schema: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'Event title' },
      startDate: { type: 'string', description: 'Start date/time in ISO 8601' },
      endDate: { type: 'string', description: 'End date/time in ISO 8601' },
      notes: { type: 'string', description: 'Optional notes' },
    },
    required: ['title', 'startDate', 'endDate'],
  },
};

describe('enrichToolResultWithSchemaRepair', () => {
  it('adds schema-grounded repair details to structured missing-argument errors', () => {
    const enriched = enrichToolResultWithSchemaRepair({
      toolName: 'calendar_create_event',
      tools: [calendarCreateTool],
      result: JSON.stringify({
        status: 'error',
        code: 'missing_required_argument',
        tool: 'calendar_create_event',
        missingRequiredArguments: ['title'],
        error: 'Missing required argument(s): title',
      }),
    });

    const parsed = JSON.parse(enriched);
    expect(parsed.repair).toEqual({
      retryable: true,
      code: 'missing_required_argument',
      missingFields: ['title'],
      expectedShape: {
        arguments: {
          title: { type: 'string', description: 'Event title' },
          startDate: { type: 'string', description: 'Start date/time in ISO 8601' },
          endDate: { type: 'string', description: 'End date/time in ISO 8601' },
        },
      },
      fieldPlacement:
        'Send required fields as top-level JSON properties in the next tool call arguments.',
      valueSource:
        'Use values already present in the user request, graph goals, or prior tool outputs. Do not invent unavailable values.',
      sideEffectApplied: false,
    });
  });

  it('leaves unrelated errors unchanged', () => {
    const raw = JSON.stringify({
      status: 'error',
      code: 'platform_unavailable',
      error: 'Calendar is unavailable',
    });

    expect(
      enrichToolResultWithSchemaRepair({
        toolName: 'calendar_create_event',
        tools: [calendarCreateTool],
        result: raw,
      }),
    ).toBe(raw);
  });

  it('does not fabricate repair details without the tool schema', () => {
    const raw = JSON.stringify({
      status: 'error',
      code: 'missing_required_argument',
      missingRequiredArguments: ['title'],
      error: 'Missing required argument(s): title',
    });

    expect(
      enrichToolResultWithSchemaRepair({
        toolName: 'calendar_create_event',
        tools: [],
        result: raw,
      }),
    ).toBe(raw);
  });
});
