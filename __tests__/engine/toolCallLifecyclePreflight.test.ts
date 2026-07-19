import { resolveToolCallPreflight } from '../../src/engine/toolExecution/toolCallLifecyclePreflight';
import { validateToolArgumentsAgainstSchema } from '../../src/engine/toolExecution/toolArgumentSchemaValidation';
import { POLICY_INDEPENDENT_MODEL_TURN_MEMORY_BINDING } from '../../src/engine/authority/modelTurnMemoryPolicyBinding';
import type { ToolExecutionLifecycleParams } from '../../src/engine/toolExecution/toolCallLifecycleTypes';
import type { ToolCallRecord } from '../../src/engine/loopDetection';
import { MEMORY_REMEMBER_TOOL } from '../../src/engine/tools/builtin-definitions-memory';
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
    modelTurnMemoryPolicyBinding: POLICY_INDEPENDENT_MODEL_TURN_MEMORY_BINDING,
    availableToolNames: new Set(['update_goals']),
    runtimeToolAvailability: {
      hasWorkspaceTargets: false,
      hasBrowserControllableWorkspaceTargets: false,
      hasDelegableWorkspaceTargets: false,
      hasMobileController: false,
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

  it.each(['update_goals', 'system:update_goals'])(
    'blocks registered tool %s when it was not exposed on the active grounded surface',
    (toolName) => {
      const lifecycle = buildLifecycle({
        groundedRequestScopedTools: [],
      });
      const result = resolveToolCallPreflight(lifecycle, {
        id: 'tc-hidden-goals',
        name: toolName,
        arguments: '{}',
      });

      expect(result?.effectiveToolName).toBe('update_goals');
      expect(result?.toolMessage.content).toContain('not allowed');
      expect(result?.toolMessage.isError).toBe(true);
      expect(lifecycle.toolCallHistory[0]?.preflightBlockedKind).toBe('tool_filter');
      expect(lifecycle.callbacks.onToolCallStart).not.toHaveBeenCalled();
      expect(lifecycle.callbacks.onToolCallComplete).not.toHaveBeenCalled();
    },
  );

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

  it('returns the exact nested length constraint before executing an oversized memory write', () => {
    const result = validateToolArgumentsAgainstSchema({
      toolName: 'memory_remember',
      tools: [MEMORY_REMEMBER_TOOL],
      argumentsText: JSON.stringify({
        semanticEvidence: {
          version: 4,
          subject: { kind: 'named', label: 'Ellie', type: 'person' },
          predicate: 'has_fixed_trip',
          value: 'x'.repeat(223),
          scope: 'global',
          importance: 0.9,
          confidence: 0.9,
          operation: 'record',
          assertion_class: 'current_direct',
          sensitivity: 'personal',
        },
      }),
    });

    const parsed = JSON.parse(result ?? '{}');
    expect(parsed).toMatchObject({
      code: 'invalid_argument_shape',
      invalidArguments: [
        {
          field: 'semanticEvidence.value',
          expected: 'string with at most 200 characters',
          actual: 'string with 223 characters',
          constraint: { keyword: 'maxLength', limit: 200, actual: 223 },
        },
      ],
      repair: {
        retryable: true,
        invalidFields: ['semanticEvidence'],
        invalidPaths: ['semanticEvidence.value'],
        sideEffectApplied: false,
      },
    });
  });

  it('counts Unicode code points when enforcing string length constraints', () => {
    const unicodeTool: ToolDefinition = {
      name: 'unicode_note',
      description: 'Store a bounded note.',
      input_schema: {
        type: 'object',
        properties: { note: { type: 'string', minLength: 2, maxLength: 3 } },
        required: ['note'],
      },
    };
    const lifecycle = buildLifecycle({
      availableToolNames: new Set(['unicode_note']),
      groundedRequestScopedTools: [unicodeTool],
    });

    expect(
      resolveToolCallPreflight(lifecycle, {
        id: 'tc-unicode-valid',
        name: 'unicode_note',
        arguments: JSON.stringify({ note: '😀😀😀' }),
      }),
    ).toBeUndefined();

    const tooShort = resolveToolCallPreflight(lifecycle, {
      id: 'tc-unicode-short',
      name: 'unicode_note',
      arguments: JSON.stringify({ note: '😀' }),
    });
    expect(JSON.parse(tooShort?.toolMessage.content ?? '{}').invalidArguments).toEqual([
      expect.objectContaining({
        field: 'note',
        constraint: { keyword: 'minLength', limit: 2, actual: 1 },
      }),
    ]);
  });

  it.each([
    ['invalid JSON', '{"prompt":'],
    ['a non-object payload', '[]'],
  ])('rejects %s as an argument object before execution', (_label, argumentsText) => {
    const lifecycle = buildLifecycle({
      availableToolNames: new Set(['sessions_spawn']),
      groundedRequestScopedTools: [sessionSpawnTool],
    });
    const result = resolveToolCallPreflight(lifecycle, {
      id: 'tc-spawn-invalid-json',
      name: 'sessions_spawn',
      arguments: argumentsText,
    });

    const parsed = JSON.parse(result?.toolMessage.content ?? '{}');
    expect(parsed).toMatchObject({
      status: 'error',
      code: 'invalid_argument_shape',
      invalidArguments: [
        {
          field: '$',
          expected: 'object',
          actual: 'invalid JSON or non-object',
        },
      ],
      repair: {
        retryable: true,
        invalidFields: ['$'],
      },
    });
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

  it('settles a workflow-blocked tool call and records the structured repair before execution', () => {
    const blocker = JSON.stringify({
      status: 'error',
      code: 'completion_contract_required',
      tool: 'write_file',
    });
    const lifecycle = buildLifecycle({
      tc: {
        id: 'tc-write',
        name: 'write_file',
        arguments: '{"path":"reports/final.md","content":"done"}',
      },
      availableToolNames: new Set(['write_file']),
      groundedRequestScopedTools: [
        {
          name: 'write_file',
          description: 'Write a workspace file.',
          input_schema: {
            type: 'object',
            properties: { path: { type: 'string' }, content: { type: 'string' } },
            required: ['path', 'content'],
          },
        },
      ],
      workflowToolCallBlocker: () => blocker,
    });

    const result = resolveToolCallPreflight(lifecycle, lifecycle.tc);

    expect(result?.toolMessage.content).toBe(blocker);
    expect(result?.toolMessage.isError).toBe(true);
    expect(result?.toolMessage.toolCalls?.[0]).toEqual(
      expect.objectContaining({
        name: 'write_file',
        status: 'failed',
        failureKind: 'workflow_guard',
      }),
    );
    expect(lifecycle.callbacks.onToolCallStart).toHaveBeenCalledTimes(1);
    expect(lifecycle.callbacks.onToolCallComplete).toHaveBeenCalledTimes(1);
    expect(lifecycle.toolCallHistory).toEqual([
      expect.objectContaining({
        name: 'write_file',
        result: blocker,
      }),
    ]);
  });
});
