import { resolveToolCallPreflight } from '../../src/engine/toolExecution/toolCallLifecyclePreflight';
import type { ToolExecutionLifecycleParams } from '../../src/engine/toolExecution/toolCallLifecycleTypes';
import type { ToolCallRecord } from '../../src/engine/loopDetection';
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
    },
    required: ['title', 'startDate', 'endDate'],
  },
};

const sessionSpawnTool: ToolDefinition = {
  name: 'sessions_spawn',
  description: 'Launch a delegated worker.',
  input_schema: {
    type: 'object',
    properties: {
      prompt: { type: 'string' },
      dependsOnWorkstreams: {
        type: 'array',
        items: { type: 'string' },
      },
      goalScope: {
        type: 'object',
        properties: {
          goalIds: {
            type: 'array',
            items: { type: 'string' },
          },
        },
      },
      waitForCompletion: { type: 'boolean' },
    },
    required: ['prompt'],
  },
};

const optionalShapeTool: ToolDefinition = {
  name: 'profile_update',
  description: 'Update optional profile details.',
  input_schema: {
    type: 'object',
    properties: {
      tags: {
        type: 'array',
        items: { type: 'string' },
      },
    },
  },
};

function buildLifecycle(
  overrides: Partial<ToolExecutionLifecycleParams> = {},
): ToolExecutionLifecycleParams {
  const toolCallHistory: ToolCallRecord[] = [];
  return {
    tc: { id: 'tc-1', name: 'update_goals', arguments: '{}' },
    iteration: 1,
    conversationId: 'conv-1',
    provider: { id: 'p1', name: 'Test', apiKey: 'k', baseUrl: 'https://example.com', models: [] },
    model: 'test-model',
    availableToolNames: new Set(['update_goals']),
    runtimeToolAvailability: {
      hasWorkspaceTargets: false,
      hasBrowserControllableWorkspaceTargets: false,
      hasDelegableWorkspaceTargets: false,
    },
    toolCallHistory,
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
      success: 'success',
      error: 'error',
    },
    ...overrides,
  };
}

describe('resolveToolCallPreflight', () => {
  it('blocks unregistered tool names before execution', () => {
    const lifecycle = buildLifecycle();
    const result = resolveToolCallPreflight(lifecycle, {
      id: 'tc-1',
      name: 'update_goal',
      arguments: '{}',
    });

    expect(result?.effectiveToolName).toBe('update_goal');
    expect(result?.toolMessage.content).toContain('not registered');
    expect(lifecycle.toolCallHistory[0]?.preflightBlockedKind).toBe('unknown_tool');
    expect(lifecycle.callbacks.onToolCallStart).not.toHaveBeenCalled();
    expect(lifecycle.callbacks.onToolCallComplete).not.toHaveBeenCalled();
  });

  it('records tool_filter preflight blocks for loop detection', () => {
    const lifecycle = buildLifecycle({
      toolFilter: () => false,
    });
    const result = resolveToolCallPreflight(lifecycle, {
      id: 'tc-1',
      name: 'update_goals',
      arguments: '{}',
    });

    expect(result?.toolMessage.content).toContain('not allowed');
    expect(lifecycle.toolCallHistory[0]?.preflightBlockedKind).toBe('tool_filter');
    expect(lifecycle.callbacks.onToolCallStart).not.toHaveBeenCalled();
    expect(lifecycle.callbacks.onToolCallComplete).not.toHaveBeenCalled();
  });

  it('applies filters to registered provider-prefixed aliases by canonical name', () => {
    const toolFilter = jest.fn((name: string) => name === 'update_goals');
    const lifecycle = buildLifecycle({ toolFilter });
    const result = resolveToolCallPreflight(lifecycle, {
      id: 'tc-1',
      name: 'system:update_goals',
      arguments: '{}',
    });

    expect(result).toBeUndefined();
    expect(toolFilter).toHaveBeenCalledWith('update_goals');
  });

  it('returns schema repair details for missing required top-level arguments before execution', () => {
    const lifecycle = buildLifecycle({
      availableToolNames: new Set(['calendar_create_event']),
      groundedRequestScopedTools: [calendarCreateTool],
    });
    const result = resolveToolCallPreflight(lifecycle, {
      id: 'tc-calendar',
      name: 'calendar_create_event',
      arguments: JSON.stringify({
        startDate: '2026-06-14T09:00:00',
        endDate: '2026-06-14T10:00:00',
      }),
    });

    const parsed = JSON.parse(result?.toolMessage.content ?? '{}');
    expect(parsed).toMatchObject({
      status: 'error',
      code: 'missing_required_argument',
      missingRequiredArguments: ['title'],
      repair: {
        retryable: true,
        missingFields: ['title'],
      },
    });
    expect(result?.toolMessage.isError).toBe(true);
    expect(result?.toolMessage.toolCalls?.[0]).toEqual(
      expect.objectContaining({
        name: 'calendar_create_event',
        status: 'failed',
        failureKind: 'tool_error',
      }),
    );
    expect(lifecycle.callbacks.onToolCallStart).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'calendar_create_event',
        status: 'failed',
      }),
    );
    expect(lifecycle.callbacks.onToolCallComplete).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'calendar_create_event',
        status: 'failed',
        failureKind: 'tool_error',
      }),
    );
    expect(lifecycle.toolCallHistory[0]?.preflightBlockedKind).toBe('schema_validation');
  });

  it('returns schema repair details for invalid declared argument shapes before execution', () => {
    const lifecycle = buildLifecycle({
      availableToolNames: new Set(['sessions_spawn']),
      groundedRequestScopedTools: [sessionSpawnTool],
    });
    const result = resolveToolCallPreflight(lifecycle, {
      id: 'tc-spawn',
      name: 'sessions_spawn',
      arguments: JSON.stringify({
        prompt: 'Research the issue.',
        dependsOnWorkstreams: 'none',
        goalScope: { goalIds: 'worker-chain' },
        waitForCompletion: 'true',
      }),
    });

    const parsed = JSON.parse(result?.toolMessage.content ?? '{}');
    expect(parsed).toMatchObject({
      status: 'error',
      code: 'invalid_argument_shape',
      repair: {
        retryable: true,
        code: 'invalid_argument_shape',
        invalidFields: ['dependsOnWorkstreams', 'goalScope', 'waitForCompletion'],
      },
    });
    expect(parsed.invalidArguments).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          field: 'dependsOnWorkstreams',
          expected: 'array',
          actual: 'string',
        }),
        expect.objectContaining({
          field: 'goalScope.goalIds',
          expected: 'array',
          actual: 'string',
        }),
        expect.objectContaining({
          field: 'waitForCompletion',
          expected: 'boolean',
          actual: 'string',
        }),
      ]),
    );
    expect(result?.toolMessage.isError).toBe(true);
    expect(lifecycle.callbacks.onToolCallStart).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'sessions_spawn',
        status: 'failed',
      }),
    );
    expect(lifecycle.callbacks.onToolCallComplete).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'sessions_spawn',
        status: 'failed',
        failureKind: 'tool_error',
      }),
    );
    expect(lifecycle.toolCallHistory[0]?.preflightBlockedKind).toBe('schema_validation');
  });

  it('validates malformed optional argument shapes even when a schema has no required fields', () => {
    const lifecycle = buildLifecycle({
      availableToolNames: new Set(['profile_update']),
      groundedRequestScopedTools: [optionalShapeTool],
    });
    const result = resolveToolCallPreflight(lifecycle, {
      id: 'tc-profile',
      name: 'profile_update',
      arguments: JSON.stringify({
        tags: 'focus',
      }),
    });

    const parsed = JSON.parse(result?.toolMessage.content ?? '{}');
    expect(parsed).toMatchObject({
      status: 'error',
      code: 'invalid_argument_shape',
      repair: {
        retryable: true,
        invalidFields: ['tags'],
      },
    });
    expect(parsed.invalidArguments).toEqual([
      expect.objectContaining({
        field: 'tags',
        expected: 'array',
        actual: 'string',
      }),
    ]);
    expect(lifecycle.toolCallHistory[0]?.preflightBlockedKind).toBe('schema_validation');
  });

  it('treats null optional arguments as absent for strict provider tool payloads', () => {
    const lifecycle = buildLifecycle({
      availableToolNames: new Set(['profile_update']),
      groundedRequestScopedTools: [optionalShapeTool],
    });
    const result = resolveToolCallPreflight(lifecycle, {
      id: 'tc-profile-null',
      name: 'profile_update',
      arguments: JSON.stringify({
        tags: null,
      }),
    });

    expect(result).toBeUndefined();
    expect(lifecycle.toolCallHistory).toHaveLength(0);
    expect(lifecycle.callbacks.onToolCallStart).not.toHaveBeenCalled();
    expect(lifecycle.callbacks.onToolCallComplete).not.toHaveBeenCalled();
  });
});
