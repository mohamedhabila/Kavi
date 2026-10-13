import { mapForegroundScenarioResult } from '../../src/acceptance/e2eAgent/scenarioResultMapper';
import type { ForegroundScenarioDriverResult } from '../../src/acceptance/e2eAgent/foregroundScenarioDriver';

describe('scenarioResultMapper tool outcomes', () => {
  it('uses code-owned status instead of opaque multilingual tool content', () => {
    const messages = [
      {
        id: 'assistant-1',
        role: 'assistant',
        content: '',
        timestamp: 2,
        toolCalls: [
          {
            id: 'call-completed',
            name: 'opaque_completed',
            arguments: '{}',
            status: 'completed',
          },
          {
            id: 'call-failed',
            name: 'opaque_failed',
            arguments: '{}',
            status: 'failed',
          },
        ],
      },
      {
        id: 'tool-completed',
        role: 'tool',
        content: 'Error: فشل — Ошибка — エラー',
        timestamp: 3,
        toolCallId: 'call-completed',
      },
      {
        id: 'tool-failed',
        role: 'tool',
        content: '完了しました — تم بنجاح — завершено',
        timestamp: 4,
        toolCallId: 'call-failed',
      },
    ];
    const driverResult = {
      conversationId: 'conversation-1',
      finalConversation: {},
      memoryItems: { capturedAt: 1, items: [], indexedTurnCount: 0 },
      turns: [
        {
          turnIndex: 0,
          lifecycleBefore: null,
          user: { messageId: 'user-1', text: 'run', timestamp: 1 },
          finalAssistant: null,
          finalAssistantCandidateCount: 0,
          completion: {
            assistantStatus: 'missing',
            executionCompleted: true,
            finalResponseCompleted: false,
            runStatus: 'not_applicable',
            runCompleted: null,
            runCompletedAt: null,
            runTerminalReason: null,
            graphStatus: null,
            graphTerminalReason: null,
          },
          run: null,
          memoryExtractionSettled: true,
          memoryExtractionWaitMs: 0,
          native: { stateBefore: {}, stateAfter: {}, invocations: [] },
          memoryPrompt: { status: 'missing', builds: [] },
          messages,
          usage: null,
          error: null,
          timedOut: false,
          durationMs: 1,
          userMessageId: 'user-1',
        },
      ],
    } as unknown as ForegroundScenarioDriverResult;

    const result = mapForegroundScenarioResult({
      contentClass: 'synthetic_public',
      driverResult,
      durationMs: 1,
      fixtureId: 'typed-tool-outcomes',
      requestedUserTurnCount: 1,
    });

    expect(result.toolResults).toEqual([
      expect.objectContaining({ toolCallId: 'call-completed', isError: false }),
      expect.objectContaining({ toolCallId: 'call-failed', isError: true }),
    ]);
  });

  it('completes a task that clarifies, resumes the same flow, and finishes', () => {
    const native = { stateBefore: {}, stateAfter: {}, invocations: [] };
    const baseTurn = {
      lifecycleBefore: null,
      finalAssistantCandidateCount: 1,
      run: null,
      memoryExtractionSettled: true,
      memoryExtractionWaitMs: 0,
      native,
      memoryPrompt: { status: 'missing', builds: [] },
      messages: [],
      usage: null,
      error: null,
      timedOut: false,
      durationMs: 1,
    };
    const driverResult = {
      conversationId: 'conversation-1',
      finalConversation: {},
      memoryItems: { capturedAt: 1, items: [], indexedTurnCount: 0 },
      turns: [
        {
          ...baseTurn,
          turnIndex: 0,
          user: { messageId: 'user-1', text: 'Draft a message', timestamp: 1 },
          userMessageId: 'user-1',
          finalAssistant: {
            messageId: 'assistant-1',
            text: 'Who should receive it?',
            timestamp: 2,
            completionStatus: 'complete',
            finishReason: 'request_clarification',
            terminalReason: null,
          },
          completion: {
            assistantStatus: 'complete',
            executionCompleted: false,
            finalResponseCompleted: true,
            runStatus: 'running',
            runCompleted: false,
            runCompletedAt: null,
            runTerminalReason: null,
            graphStatus: 'awaiting_user',
            graphTerminalReason: null,
          },
        },
        {
          ...baseTurn,
          turnIndex: 1,
          user: { messageId: 'user-2', text: 'Avery', timestamp: 3 },
          userMessageId: 'user-2',
          finalAssistant: {
            messageId: 'assistant-2',
            text: 'Done',
            timestamp: 4,
            completionStatus: 'complete',
            finishReason: 'completed',
            terminalReason: null,
          },
          completion: {
            assistantStatus: 'complete',
            executionCompleted: true,
            finalResponseCompleted: true,
            runStatus: 'completed',
            runCompleted: true,
            runCompletedAt: 4,
            runTerminalReason: null,
            graphStatus: 'finalized',
            graphTerminalReason: null,
          },
        },
      ],
    } as unknown as ForegroundScenarioDriverResult;

    const result = mapForegroundScenarioResult({
      contentClass: 'synthetic_public',
      driverResult,
      durationMs: 2,
      fixtureId: 'clarification-resume',
      requestedUserTurnCount: 2,
    });

    expect(result.turnTraces.map((turn) => turn.completed)).toEqual([false, true]);
    expect(result.completed).toBe(true);
  });

  it('does not complete while the final requested turn still awaits the user', () => {
    const driverResult = {
      conversationId: 'conversation-1',
      finalConversation: {},
      memoryItems: { capturedAt: 1, items: [], indexedTurnCount: 0 },
      turns: [
        {
          turnIndex: 0,
          lifecycleBefore: null,
          user: { messageId: 'user-1', text: 'Draft a message', timestamp: 1 },
          finalAssistant: {
            messageId: 'assistant-1',
            text: 'Who should receive it?',
            timestamp: 2,
            completionStatus: 'complete',
            finishReason: 'request_clarification',
            terminalReason: null,
          },
          finalAssistantCandidateCount: 1,
          completion: {
            assistantStatus: 'complete',
            executionCompleted: false,
            finalResponseCompleted: true,
            runStatus: 'running',
            runCompleted: false,
            runCompletedAt: null,
            runTerminalReason: null,
            graphStatus: 'awaiting_user',
            graphTerminalReason: null,
          },
          run: null,
          memoryExtractionSettled: true,
          memoryExtractionWaitMs: 0,
          native: { stateBefore: {}, stateAfter: {}, invocations: [] },
          memoryPrompt: { status: 'missing', builds: [] },
          messages: [],
          usage: null,
          error: null,
          timedOut: false,
          durationMs: 1,
          userMessageId: 'user-1',
        },
      ],
    } as unknown as ForegroundScenarioDriverResult;

    const result = mapForegroundScenarioResult({
      contentClass: 'synthetic_public',
      driverResult,
      durationMs: 1,
      fixtureId: 'clarification-pending',
      requestedUserTurnCount: 1,
    });

    expect(result.completed).toBe(false);
  });

  it('keeps memory extraction calls out of the conversation usage but in the cost', () => {
    const entry = (source: 'primary' | 'memory', inputTokens: number, estimatedCost: number) => ({
      model: 'z-ai/glm-5.3-flash',
      source,
      inputTokens,
      outputTokens: 10,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      totalTokens: inputTokens + 10,
      estimatedCost,
      timestamp: 1,
    });
    const driverResult = {
      conversationId: 'conversation-1',
      finalConversation: {},
      memoryItems: { capturedAt: 1, items: [], indexedTurnCount: 1 },
      turns: [
        {
          turnIndex: 0,
          lifecycleBefore: null,
          user: { messageId: 'user-1', text: 'hello', timestamp: 1 },
          finalAssistant: null,
          finalAssistantCandidateCount: 0,
          completion: {
            assistantStatus: 'complete',
            executionCompleted: true,
            finalResponseCompleted: true,
            runStatus: 'not_applicable',
            runCompleted: null,
            runCompletedAt: null,
            runTerminalReason: null,
            graphStatus: null,
            graphTerminalReason: null,
          },
          run: null,
          memoryExtractionSettled: true,
          memoryExtractionWaitMs: 0,
          native: { stateBefore: {}, stateAfter: {}, invocations: [] },
          memoryPrompt: { status: 'missing', builds: [] },
          messages: [],
          usage: { entries: [entry('primary', 1000, 0.002), entry('memory', 400, 0.001)] },
          error: null,
          timedOut: false,
          durationMs: 1,
          userMessageId: 'user-1',
        },
      ],
    } as unknown as ForegroundScenarioDriverResult;

    const result = mapForegroundScenarioResult({
      contentClass: 'synthetic_public',
      driverResult,
      durationMs: 1,
      fixtureId: 'memory-usage-split',
      requestedUserTurnCount: 1,
    });

    expect(result.usage).toMatchObject({ inputTokens: 1000, eventCount: 1 });
    expect(result.turnTraces[0]?.usage).toMatchObject({ inputTokens: 1000, eventCount: 1 });
    expect(result.memoryUsage).toMatchObject({ inputTokens: 400, eventCount: 1 });
    expect(result.estimatedCost).toEqual({ status: 'available', usd: 0.003 });
  });
});
