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
      memoryFinalState: {},
      turns: [
        {
          turnIndex: 0,
          lifecycleBefore: null,
          user: { messageId: 'user-1', text: 'run', timestamp: 1 },
          route: { directive: 'forced_agentic', mode: 'agentic', personaId: 'default' },
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
          memory: [],
          memoryEvidence: { delta: {} },
          native: { stateBefore: {}, stateAfter: {}, invocations: [] },
          retrieval: {},
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
});
