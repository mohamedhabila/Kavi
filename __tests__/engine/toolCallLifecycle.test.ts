import { executeToolCallLifecycle } from '../../src/engine/toolExecution/toolCallLifecycle';
import { executeTool } from '../../src/engine/tools';
import type { ToolExecutionLifecycleParams } from '../../src/engine/toolExecution/toolCallLifecycleTypes';
import type { ToolDefinition } from '../../src/types/tool';

jest.mock('../../src/services/events/bus', () => ({
  emitAgentEvent: jest.fn(),
}));

jest.mock('../../src/engine/tools', () => ({
  executeTool: jest.fn(),
}));

const mockedExecuteTool = jest.mocked(executeTool);

const calendarCreateTool: ToolDefinition = {
  name: 'calendar_create_event',
  description: 'Create a calendar event.',
  input_schema: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'Event title' },
      startDate: { type: 'string', description: 'Start date/time in ISO 8601' },
      endDate: { type: 'string', description: 'End date/time in ISO 8601' },
    },
    required: ['title', 'startDate', 'endDate'],
  },
};

function buildLifecycle(
  overrides: Partial<ToolExecutionLifecycleParams> = {},
): ToolExecutionLifecycleParams {
  return {
    tc: {
      id: 'tc-calendar-create',
      name: 'calendar_create_event',
      arguments: JSON.stringify({
        startDate: '2026-06-14T09:00:00',
        endDate: '2026-06-14T10:00:00',
      }),
    },
    iteration: 1,
    conversationId: 'conv-1',
    provider: { id: 'p1', name: 'Test', apiKey: 'k', baseUrl: 'https://example.com', models: [] },
    model: 'test-model',
    availableToolNames: new Set(['calendar_create_event']),
    runtimeToolAvailability: {
      hasWorkspaceTargets: false,
      hasBrowserControllableWorkspaceTargets: false,
      hasDelegableWorkspaceTargets: false,
    },
    toolCallHistory: [],
    groundedRequestScopedTools: [calendarCreateTool],
    trackedAsyncOperations: new Map(),
    callbacks: {
      onToolCallStart: jest.fn(),
      onToolCallComplete: jest.fn(),
    },
    usePerformanceMetrics: false,
    idPrefixes: {
      blocked: 'blocked',
      filtered: 'filtered',
      workflow: 'workflow',
      cancelled: 'cancelled',
      success: 'tool',
      error: 'error',
    },
    ...overrides,
  };
}

describe('executeToolCallLifecycle', () => {
  beforeEach(() => {
    mockedExecuteTool.mockReset();
  });

  it('returns schema-grounded retry details for structured missing required arguments', async () => {
    mockedExecuteTool.mockResolvedValueOnce(
      JSON.stringify({
        status: 'error',
        code: 'missing_required_argument',
        tool: 'calendar_create_event',
        missingRequiredArguments: ['title'],
        error: 'Missing required argument(s): title',
      }),
    );

    const result = await executeToolCallLifecycle(buildLifecycle());
    const parsed = JSON.parse(result.toolMessage.content);

    expect(result.toolMessage.isError).toBe(true);
    expect(parsed.repair).toMatchObject({
      retryable: true,
      code: 'missing_required_argument',
      missingFields: ['title'],
      expectedShape: {
        arguments: {
          title: { type: 'string' },
          startDate: { type: 'string' },
          endDate: { type: 'string' },
        },
      },
    });
    expect(result.toolMessage.toolCalls?.[0]).toEqual(
      expect.objectContaining({
        name: 'calendar_create_event',
        status: 'failed',
        failureKind: 'tool_error',
      }),
    );
  });
});
