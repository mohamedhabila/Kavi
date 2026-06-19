import { createForegroundAssistantMessageController } from '../../src/engine/graph/foregroundRun/assistantMessageController';
import type { Message, ToolCall } from '../../src/types/message';

function createToolCall(id: string, name: string): ToolCall {
  return {
    id,
    name,
    arguments: '{}',
    status: 'pending',
  };
}

function createHarness(
  overrides: {
    currentAssistantMessageId?: string;
    currentDraft?: { content?: string; reasoning?: string };
    hasQueuedNextAssistantTurn?: boolean;
    isSurfacedWorkerOutputLocked?: boolean;
    persistedAssistantMessage?: Pick<
      Message,
      'content' | 'providerReplay' | 'reasoning' | 'toolCalls'
    >;
  } = {},
) {
  let currentAssistantMessageId = overrides.currentAssistantMessageId ?? 'assistant-1';
  const actions = {
    clearSurfacedWorkerOutputLock: jest.fn(),
    commitResolvedContent: jest.fn(),
    ensureAssistantTurn: jest.fn(() => {
      currentAssistantMessageId = 'assistant-2';
    }),
    enterWorkPhase: jest.fn(),
    mergeLiveToolCalls: jest.fn(),
    persistToolCalls: jest.fn(),
    queueNextAssistantTurn: jest.fn(),
    resolveAssistantTurnContent: jest.fn((content: string) => `${content} resolved`),
    setAssistantMetadata: jest.fn(),
    setProviderReplay: jest.fn(),
    syncSummary: jest.fn(),
  };

  const controller = createForegroundAssistantMessageController({
    accessors: {
      getCurrentAssistantMessageId: () => currentAssistantMessageId,
      getCurrentStreamingDraft: () => overrides.currentDraft,
      getPersistedAssistantMessage: () => overrides.persistedAssistantMessage,
      hasQueuedNextAssistantTurn: () => overrides.hasQueuedNextAssistantTurn ?? false,
      isSurfacedWorkerOutputLocked: () => overrides.isSurfacedWorkerOutputLocked ?? false,
    },
    actions,
  });

  return {
    actions,
    controller,
  };
}

describe('foreground assistant message controller', () => {
  it('short-circuits late text while surfaced worker output remains locked', () => {
    const providerReplay = { geminiParts: [{ text: 'late text' }] } as Message['providerReplay'];
    const assistantMetadata = {
      kind: 'final',
      completionStatus: 'complete',
    } as Message['assistantMetadata'];
    const harness = createHarness({
      isSurfacedWorkerOutputLocked: true,
    });

    harness.controller.applyAssistantMessage({
      assistantMetadata,
      content: 'late text',
      providerReplay,
      toolCalls: [],
    });

    expect(harness.actions.setProviderReplay).toHaveBeenCalledWith('assistant-1', providerReplay);
    expect(harness.actions.setAssistantMetadata).toHaveBeenCalledWith(
      'assistant-1',
      assistantMetadata,
    );
    expect(harness.actions.commitResolvedContent).not.toHaveBeenCalled();
    expect(harness.actions.clearSurfacedWorkerOutputLock).not.toHaveBeenCalled();
  });

  it('starts a fresh turn and routes tool-only batches into work', () => {
    const harness = createHarness({
      hasQueuedNextAssistantTurn: true,
    });

    harness.controller.applyAssistantMessage({
      toolCalls: [createToolCall('tool-1', 'write_file')],
    });

    expect(harness.actions.ensureAssistantTurn).toHaveBeenCalledTimes(1);
    expect(harness.actions.mergeLiveToolCalls).toHaveBeenCalledWith('assistant-2', [
      expect.objectContaining({
        id: 'tool-1',
        name: 'write_file',
        status: 'pending',
      }),
    ]);
    expect(harness.actions.persistToolCalls).toHaveBeenCalledWith('assistant-2', [
      expect.objectContaining({
        id: 'tool-1',
        name: 'write_file',
        status: 'pending',
      }),
    ]);
    expect(harness.actions.enterWorkPhase).toHaveBeenCalledWith('Using write_file', 'Work started');
    expect(harness.actions.queueNextAssistantTurn).toHaveBeenCalledTimes(1);
    expect(harness.actions.commitResolvedContent).not.toHaveBeenCalled();
    expect(harness.actions.syncSummary).not.toHaveBeenCalled();
  });

  it('switches into a work phase instead of committing prose when a turn schedules tools', () => {
    const harness = createHarness();

    harness.controller.applyAssistantMessage({
      content: 'Draft answer before tool execution.',
      toolCalls: [createToolCall('tool-1', 'web_search')],
    });

    expect(harness.actions.mergeLiveToolCalls).toHaveBeenCalledWith('assistant-1', [
      expect.objectContaining({
        id: 'tool-1',
        name: 'web_search',
        status: 'pending',
      }),
    ]);
    expect(harness.actions.resolveAssistantTurnContent).toHaveBeenCalledWith(
      'Draft answer before tool execution.',
    );
    expect(harness.actions.commitResolvedContent).not.toHaveBeenCalled();
    expect(harness.actions.enterWorkPhase).toHaveBeenCalledWith('Using web_search', 'Work started');
    expect(harness.actions.syncSummary).not.toHaveBeenCalled();
  });

  it('keeps existing streamed prose visible without recommitting when persisting a tool turn', () => {
    const harness = createHarness({
      currentDraft: {
        content: 'Partial answer that should not survive the tool turn.',
      },
    });

    harness.controller.applyAssistantMessage({
      content: 'I already know the answer.',
      toolCalls: [createToolCall('tool-1', 'read_file')],
    });

    expect(harness.actions.mergeLiveToolCalls).toHaveBeenCalledWith('assistant-1', [
      expect.objectContaining({
        id: 'tool-1',
        name: 'read_file',
        status: 'pending',
      }),
    ]);
    expect(harness.actions.resolveAssistantTurnContent).toHaveBeenCalledWith(
      'I already know the answer.',
    );
    expect(harness.actions.commitResolvedContent).not.toHaveBeenCalled();
    expect(harness.actions.enterWorkPhase).not.toHaveBeenCalled();
    expect(harness.actions.syncSummary).not.toHaveBeenCalled();
  });

  it('commits resolved text-only content and syncs summary on the active turn', () => {
    const providerReplay = { geminiParts: [{ text: 'Draft answer' }] } as Message['providerReplay'];
    const assistantMetadata = {
      kind: 'final',
      completionStatus: 'complete',
    } as Message['assistantMetadata'];
    const harness = createHarness();

    harness.controller.applyAssistantMessage({
      assistantMetadata,
      content: 'Draft answer',
      providerReplay,
      toolCalls: [],
    });

    expect(harness.actions.resolveAssistantTurnContent).toHaveBeenCalledWith('Draft answer');
    expect(harness.actions.setProviderReplay).toHaveBeenCalledWith('assistant-1', providerReplay);
    expect(harness.actions.setAssistantMetadata).toHaveBeenCalledWith(
      'assistant-1',
      assistantMetadata,
    );
    expect(harness.actions.syncSummary).toHaveBeenCalledWith('Draft answer resolved');
    expect(harness.actions.commitResolvedContent).toHaveBeenCalledWith(
      'Draft answer resolved',
      true,
    );
    expect(harness.actions.queueNextAssistantTurn).not.toHaveBeenCalled();
  });
});
