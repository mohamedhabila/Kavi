import { createForegroundToolCallLifecycleController } from '../../src/engine/graph/foregroundRun/toolCallLifecycle';
import type { ToolCall } from '../../src/types/message';

function createHarness(
  overrides: {
    currentAssistantMessageId?: string;
    liveToolCalls?: ToolCall[];
    pendingSurfacedWorkerOutputs?: Map<string, any>;
    persistedToolCalls?: ToolCall[];
  } = {},
) {
  let currentAssistantMessageId = overrides.currentAssistantMessageId ?? 'assistant-1';
  const actions = {
    addToolCall: jest.fn(),
    addToolMessage: jest.fn(),
    appendConversationLog: jest.fn(),
    applyMessageEffect: jest.fn(),
    applyToolCompletionEffect: jest.fn(),
    applyToolStartEffect: jest.fn(),
    clearSurfacedWorkerOutputLock: jest.fn(),
    flushSurfacedWorkerOutput: jest.fn(),
    recordToolUsage: jest.fn(),
    requestPersistenceCheckpoint: jest.fn(),
    trackCounters: jest.fn(),
    updateToolCallStatus: jest.fn(),
    upsertLiveToolCall: jest.fn(),
  };

  const controller = createForegroundToolCallLifecycleController({
    pendingSurfacedWorkerOutputs: overrides.pendingSurfacedWorkerOutputs ?? new Map<string, any>(),
    accessors: {
      getCurrentAssistantMessageId: () => currentAssistantMessageId,
      getLiveToolCalls: () => overrides.liveToolCalls,
      getPersistedAssistantToolCalls: () => overrides.persistedToolCalls,
      now: () => 1_700_000_000_500,
    },
    actions,
  });

  return {
    actions,
    controller,
    setCurrentAssistantMessageId(nextMessageId: string) {
      currentAssistantMessageId = nextMessageId;
    },
  };
}

describe('foreground tool call lifecycle controller', () => {
  it('starts tool calls through runtime-owned work-phase effects', () => {
    const harness = createHarness();
    const toolCall: ToolCall = {
      id: 'tc-read',
      name: 'read_file',
      arguments: '{"path":"README.md"}',
      status: 'running',
      startedAt: 1_700_000_000_000,
    };

    harness.controller.startToolCall(toolCall);

    expect(harness.actions.clearSurfacedWorkerOutputLock).toHaveBeenCalledTimes(1);
    expect(harness.actions.trackCounters).toHaveBeenCalledWith({ startedTools: 1 });
    expect(harness.actions.upsertLiveToolCall).toHaveBeenCalledWith('assistant-1', toolCall);
    expect(harness.actions.addToolCall).toHaveBeenCalledWith('assistant-1', toolCall);
    expect(harness.actions.applyToolStartEffect).toHaveBeenCalledWith(
      expect.objectContaining({
        checkpoint: expect.objectContaining({
          title: 'Tool started: read_file',
          detail: '{"path":"README.md"}',
        }),
      }),
    );
    expect(harness.actions.appendConversationLog).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Tool started: read_file',
      }),
    );
  });

  it('completes message-effect tool calls and applies the effect through runtime actions', () => {
    const harness = createHarness();
    const toolCall: ToolCall = {
      id: 'tc-effect',
      name: 'message_effect',
      arguments: '{}',
      status: 'completed',
      result: JSON.stringify({ effectId: 'confetti' }),
      startedAt: 1_700_000_000_000,
      completedAt: 1_700_000_000_250,
    };

    harness.controller.completeToolCall(toolCall);

    expect(harness.actions.recordToolUsage).toHaveBeenCalledWith(toolCall);
    expect(harness.actions.upsertLiveToolCall).toHaveBeenCalledWith('assistant-1', toolCall);
    expect(harness.actions.updateToolCallStatus).toHaveBeenCalledWith(
      'assistant-1',
      'tc-effect',
      'completed',
      expect.objectContaining({
        result: toolCall.result,
        completedAt: toolCall.completedAt,
      }),
    );
    expect(harness.actions.applyMessageEffect).toHaveBeenCalledWith('assistant-1', 'confetti');
    expect(harness.actions.trackCounters).toHaveBeenCalledWith({
      completedTools: 1,
      spawnedSubAgents: 0,
    });
    expect(harness.actions.applyToolCompletionEffect).toHaveBeenCalledWith(
      expect.objectContaining({
        checkpoint: expect.objectContaining({
          title: 'Tool completed: message_effect',
        }),
      }),
    );
  });

  it('anchors completed tool calls to the assistant turn that started them', () => {
    const harness = createHarness();
    const runningToolCall: ToolCall = {
      id: 'tc-python',
      name: 'python',
      arguments: '{"code":"print(1)"}',
      status: 'running',
      startedAt: 1_700_000_000_000,
    };
    const completedToolCall: ToolCall = {
      ...runningToolCall,
      status: 'completed',
      result: '1\n',
      completedAt: 1_700_000_000_300,
    };

    harness.controller.startToolCall(runningToolCall);
    harness.setCurrentAssistantMessageId('assistant-2');
    harness.controller.completeToolCall(completedToolCall);

    expect(harness.actions.upsertLiveToolCall).toHaveBeenLastCalledWith(
      'assistant-1',
      completedToolCall,
    );
    expect(harness.actions.updateToolCallStatus).toHaveBeenLastCalledWith(
      'assistant-1',
      'tc-python',
      'completed',
      expect.objectContaining({
        result: '1\n',
        completedAt: completedToolCall.completedAt,
      }),
    );
  });

  it('publishes surfaced worker tool results with resolved tool metadata', () => {
    const pendingSurfacedWorkerOutputs = new Map([
      [
        'tc-surface',
        {
          status: 'surfaced',
          sessionId: 'sub-surface',
          output: 'Worker-authored final answer',
          outputLength: 26,
          sourceOutputLength: 26,
          selectionApplied: false,
          usedFullOutput: true,
          guidance:
            'This output is intended to be surfaced directly to the user by the runtime. Do not restate the same content in assistant text unless you are adding materially new information.',
        },
      ],
    ]);
    const sourceToolCall: ToolCall = {
      id: 'tc-surface',
      name: 'sessions_surface_output',
      arguments: '{"sessionId":"sub-surface"}',
      status: 'completed',
      result: '{"status":"surfaced"}',
      completedAt: 1_700_000_000_100,
    };
    const harness = createHarness({
      liveToolCalls: [sourceToolCall],
      pendingSurfacedWorkerOutputs,
    });

    harness.controller.publishToolMessage('tc-surface', 'tool result');

    expect(harness.actions.addToolMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'assistant-1_tool_tc-surface',
        role: 'tool',
        content: expect.stringContaining('surfaced to the user'),
        toolCallId: 'tc-surface',
        toolCalls: [
          expect.objectContaining({
            id: 'tc-surface',
            name: 'sessions_surface_output',
            status: 'completed',
            result: sourceToolCall.result,
          }),
        ],
      }),
    );
    expect(harness.actions.flushSurfacedWorkerOutput).toHaveBeenCalledWith('tc-surface');
    expect(harness.actions.requestPersistenceCheckpoint).toHaveBeenCalledTimes(1);
  });

  it('publishes tool messages against the assistant turn that owns the tool call', () => {
    const sourceToolCall: ToolCall = {
      id: 'tc-python',
      name: 'python',
      arguments: '{"code":"print(1)"}',
      status: 'completed',
      result: '1\n',
      completedAt: 1_700_000_000_100,
    };
    const harness = createHarness({
      liveToolCalls: [sourceToolCall],
      persistedToolCalls: [sourceToolCall],
    });

    harness.controller.startToolCall({
      ...sourceToolCall,
      status: 'running',
      result: undefined,
      completedAt: undefined,
    });
    harness.setCurrentAssistantMessageId('assistant-2');
    harness.controller.publishToolMessage('tc-python', '1\n');

    expect(harness.actions.addToolMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'assistant-1_tool_tc-python',
        toolCallId: 'tc-python',
        toolCalls: [
          expect.objectContaining({
            id: 'tc-python',
            name: 'python',
            status: 'completed',
          }),
        ],
      }),
    );
  });
});
