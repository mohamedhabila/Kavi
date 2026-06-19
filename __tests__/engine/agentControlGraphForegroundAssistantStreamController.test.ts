import { createForegroundAssistantStreamController } from '../../src/engine/graph/foregroundRun/assistantStreamController';

function createHarness(overrides: {
  resumedAssistantDraft?: {
    assistantMetadata?: { finishReason?: string };
    content?: string;
    id: string;
    reasoning?: string;
  };
} = {}) {
  const drafts: Record<string, { content?: string; reasoning?: string }> = {};
  const clearStreamingDraft = jest.fn((messageId: string) => {
    delete drafts[messageId];
  });
  const mergeStreamingDraft = jest.fn(
    (messageId: string, patch: { content?: string; reasoning?: string }) => {
      drafts[messageId] = {
        ...(drafts[messageId] ?? {}),
        ...patch,
      };
    },
  );
  const startAssistantTurn = jest.fn();
  const updateMessage = jest.fn();
  const updateMessageReasoning = jest.fn();
  let nextIdIndex = 0;
  const nextIds = ['assistant-2', 'assistant-3'];

  const controller = createForegroundAssistantStreamController({
    actions: {
      clearStreamingDraft,
      mergeStreamingDraft,
      startAssistantTurn,
      updateMessage,
      updateMessageReasoning,
    },
    checkpointIntervalMs: 240,
    createAssistantMessageId: () => nextIds[nextIdIndex++] ?? `assistant-${nextIdIndex + 1}`,
    currentAssistantMessageId: 'assistant-1',
    getStreamingDraft: (messageId) => drafts[messageId],
    publishIntervalMs: 48,
    resumedAssistantDraft: overrides.resumedAssistantDraft,
  });

  return {
    clearStreamingDraft,
    controller,
    drafts,
    mergeStreamingDraft,
    startAssistantTurn,
    updateMessage,
    updateMessageReasoning,
  };
}

describe('foreground assistant stream controller', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('publishes the first streamed token immediately and throttles later draft writes', () => {
    jest.useFakeTimers();
    const harness = createHarness();

    harness.controller.appendToken('Streaming');
    expect(harness.mergeStreamingDraft).toHaveBeenCalledTimes(1);
    expect(harness.drafts['assistant-1']).toEqual({
      content: 'Streaming',
      reasoning: undefined,
    });

    harness.controller.appendToken(' answer');
    expect(harness.mergeStreamingDraft).toHaveBeenCalledTimes(1);

    jest.advanceTimersByTime(47);
    expect(harness.mergeStreamingDraft).toHaveBeenCalledTimes(1);

    jest.advanceTimersByTime(1);
    expect(harness.mergeStreamingDraft).toHaveBeenCalledTimes(2);
    expect(harness.drafts['assistant-1']).toEqual({
      content: 'Streaming answer',
      reasoning: undefined,
    });
  });

  it('resets the current turn back to the resumed baseline content', () => {
    const harness = createHarness({
      resumedAssistantDraft: {
        id: 'assistant-1',
        content: 'Baseline answer',
        reasoning: 'Baseline reasoning',
      },
    });

    harness.controller.commitResolvedContent('Replacement answer', false);
    harness.controller.resetCurrentTurn();

    expect(harness.clearStreamingDraft).toHaveBeenCalledWith('assistant-1');
    expect(harness.updateMessage).toHaveBeenCalledWith('assistant-1', 'Baseline answer');
    expect(harness.updateMessageReasoning).not.toHaveBeenCalled();
    expect(harness.controller.getVisibleAssistantContent()).toBe('Baseline answer');
  });

  it('starts a fresh assistant turn when the next turn is queued', () => {
    const harness = createHarness();

    harness.controller.appendToken('Draft answer');
    harness.controller.queueNextAssistantTurn();

    expect(harness.controller.ensureAssistantTurn()).toBe(true);

    expect(harness.updateMessage).toHaveBeenCalledWith('assistant-1', 'Draft answer');
    expect(harness.clearStreamingDraft).toHaveBeenCalledWith('assistant-1');
    expect(harness.startAssistantTurn).toHaveBeenCalledWith('assistant-2');
    expect(harness.controller.getCurrentAssistantMessageId()).toBe('assistant-2');
    expect(harness.controller.getVisibleAssistantContent()).toBe('');
  });
});
