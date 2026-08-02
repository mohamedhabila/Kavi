import {
  selectTerminalConversationsWithFinalResponseGaps,
  selectTerminalFinalResponseRecoveryCandidates,
} from '../../src/engine/graph/terminalFinalResponseRecovery';
import type { AgentRun } from '../../src/types/agentRun';
import type { Conversation } from '../../src/types/conversation';
import type { Message } from '../../src/types/message';

function message(overrides: Partial<Message>): Message {
  return {
    id: overrides.id ?? 'msg-1',
    role: overrides.role ?? 'assistant',
    content: overrides.content ?? '',
    timestamp: overrides.timestamp ?? 1,
    ...overrides,
  } as Message;
}

function run(overrides?: Partial<AgentRun>): AgentRun {
  return {
    id: 'run-1',
    status: 'completed',
    createdAt: 1,
    updatedAt: 10,
    userMessageId: 'user-1',
    summary: {
      assistantTurns: 1,
      startedTools: 0,
      completedTools: 0,
      failedTools: 0,
      spawnedSubAgents: 0,
    },
    ...overrides,
  } as AgentRun;
}

function conversation(overrides?: Partial<Conversation>): Conversation {
  return {
    id: 'conv-1',
    messages: [
      message({ id: 'user-1', role: 'user', content: 'Do work' }),
      message({ id: 'assistant-1', role: 'assistant', content: 'Draft completion' }),
    ],
    agentRuns: [run()],
    ...overrides,
  } as Conversation;
}

describe('terminal final response recovery selectors', () => {
  it('selects conversations with terminal runs missing a delivered final response', () => {
    const withGap = conversation();
    const withoutGap = conversation({
      id: 'conv-2',
      messages: [
        message({ id: 'user-1', role: 'user', content: 'Do work' }),
        message({
          id: 'assistant-1',
          role: 'assistant',
          content: 'Final answer',
          assistantMetadata: {
            kind: 'final',
            completionStatus: 'complete',
            finishReason: 'graph_finalized',
          },
        }),
      ],
    });

    expect(selectTerminalConversationsWithFinalResponseGaps([withGap, withoutGap])).toEqual([
      withGap,
    ]);
  });

  it('returns recoverable terminal run candidates when provider-backed synthesis is available', () => {
    expect(
      selectTerminalFinalResponseRecoveryCandidates({
        conversation: conversation(),
        hasProviderContext: true,
      }),
    ).toEqual([
      {
        conversationId: 'conv-1',
        runId: 'run-1',
        status: 'completed',
        timestamp: 10,
      },
    ]);
  });

  it('skips completed draft synthesis without a provider context', () => {
    expect(
      selectTerminalFinalResponseRecoveryCandidates({
        conversation: conversation(),
        hasProviderContext: false,
      }),
    ).toEqual([]);
  });

  it('recovers failed terminal runs even without a provider context', () => {
    const failedConversation = conversation({
      agentRuns: [run({ status: 'failed' })],
    });

    expect(
      selectTerminalFinalResponseRecoveryCandidates({
        conversation: failedConversation,
        hasProviderContext: false,
      }),
    ).toEqual([
      {
        conversationId: 'conv-1',
        runId: 'run-1',
        status: 'failed',
        timestamp: 10,
      },
    ]);
  });

  it('does not replace a delivered approval-rejection cancellation notice', () => {
    const cancelledConversation = conversation({
      messages: [
        message({ id: 'user-1', role: 'user', content: 'Send the message' }),
        message({
          id: 'assistant-1',
          role: 'assistant',
          content: 'No effect was dispatched because approval was rejected.',
          assistantMetadata: {
            kind: 'final',
            completionStatus: 'complete',
            finishReason: 'user_approval_denied',
          },
        }),
      ],
      agentRuns: [run({ status: 'cancelled', terminalReason: 'user_cancelled' })],
    });

    expect(selectTerminalConversationsWithFinalResponseGaps([cancelledConversation])).toEqual([]);
    expect(
      selectTerminalFinalResponseRecoveryCandidates({
        conversation: cancelledConversation,
        hasProviderContext: true,
      }),
    ).toEqual([]);
  });

  it('does not recover older terminal runs when a newer run is still running', () => {
    const olderRun = run({
      id: 'run-old',
      status: 'failed',
      createdAt: 1,
      updatedAt: 10,
      userMessageId: 'user-1',
    });
    const newerRunningRun = run({
      id: 'run-new',
      status: 'running',
      createdAt: 20,
      updatedAt: 30,
      userMessageId: 'user-2',
    });
    const withNewerRunningRun = conversation({
      messages: [
        message({ id: 'user-1', role: 'user', content: 'Old work', timestamp: 1 }),
        message({ id: 'assistant-1', role: 'assistant', content: 'Old draft', timestamp: 2 }),
        message({ id: 'user-2', role: 'user', content: 'New work', timestamp: 20 }),
        message({ id: 'assistant-2', role: 'assistant', content: '', timestamp: 21 }),
      ],
      agentRuns: [olderRun, newerRunningRun],
    });

    expect(selectTerminalConversationsWithFinalResponseGaps([withNewerRunningRun])).toEqual([]);
    expect(
      selectTerminalFinalResponseRecoveryCandidates({
        conversation: withNewerRunningRun,
        hasProviderContext: true,
      }),
    ).toEqual([]);
  });

  it('does not append a final across turns when a historical request anchor was compacted', () => {
    const olderCompactedRun = run({
      id: 'run-old',
      status: 'cancelled',
      createdAt: 1,
      updatedAt: 10,
      userMessageId: 'user-compacted-away',
    });
    const newerTerminalRun = run({
      id: 'run-new',
      status: 'failed',
      createdAt: 20,
      updatedAt: 30,
      userMessageId: 'user-new',
    });
    const compactedHistory = conversation({
      messages: [
        message({
          id: 'summary-old',
          role: 'system',
          content: '[Conversation Summary] Earlier work was compacted.',
          timestamp: 10,
        }),
        message({ id: 'user-new', role: 'user', content: 'New work', timestamp: 20 }),
        message({
          id: 'final-new',
          role: 'assistant',
          content: 'The newer run stopped.',
          timestamp: 30,
          assistantMetadata: {
            kind: 'final',
            completionStatus: 'complete',
            finishReason: 'fallback_from_evidence',
          },
        }),
      ],
      agentRuns: [olderCompactedRun, newerTerminalRun],
    });

    expect(selectTerminalConversationsWithFinalResponseGaps([compactedHistory])).toEqual([]);
    expect(
      selectTerminalFinalResponseRecoveryCandidates({
        conversation: compactedHistory,
        hasProviderContext: true,
      }),
    ).toEqual([]);
  });

  it('keeps timestamp recovery available for the sole compacted terminal run', () => {
    const soleCompactedRun = run({
      id: 'run-compacted',
      status: 'failed',
      createdAt: 1,
      updatedAt: 10,
      userMessageId: 'user-compacted-away',
    });
    const compactedConversation = conversation({
      messages: [
        message({
          id: 'summary-old',
          role: 'system',
          content: '[Conversation Summary] Earlier work was compacted.',
          timestamp: 2,
        }),
        message({
          id: 'assistant-draft',
          role: 'assistant',
          content: 'Partial result',
          timestamp: 3,
        }),
      ],
      agentRuns: [soleCompactedRun],
    });

    expect(selectTerminalConversationsWithFinalResponseGaps([compactedConversation])).toEqual([
      compactedConversation,
    ]);
    expect(
      selectTerminalFinalResponseRecoveryCandidates({
        conversation: compactedConversation,
        hasProviderContext: false,
      }),
    ).toEqual([
      {
        conversationId: 'conv-1',
        runId: 'run-compacted',
        status: 'failed',
        timestamp: 10,
      },
    ]);
  });
});
