import { resolveForegroundTerminalMemorySource } from '../../../src/engine/graph/foregroundRun/terminalMemorySource';
import type { AgentRun } from '../../../src/types/agentRun';
import type { Conversation } from '../../../src/types/conversation';
import type { Message } from '../../../src/types/message';

function finalAssistant(
  id: string,
  timestamp: number,
  completionStatus: 'complete' | 'incomplete' = 'complete',
  finishReason = 'stop',
): Message {
  return {
    id,
    role: 'assistant',
    content: `${id} content`,
    timestamp,
    assistantMetadata: { kind: 'final', completionStatus, finishReason },
  };
}

function trackedRun(overrides: Partial<AgentRun> = {}): AgentRun {
  return {
    id: 'run-current',
    userMessageId: 'user-current',
    goal: 'Complete the current request',
    status: 'completed',
    createdAt: 10,
    updatedAt: 20,
    currentPhase: 'deliver',
    phases: [],
    checkpoints: [],
    summary: {
      assistantTurns: 1,
      startedTools: 0,
      completedTools: 0,
      failedTools: 0,
      spawnedSubAgents: 0,
    },
    ...overrides,
  };
}

function conversation(params: { messages: Message[]; runs?: AgentRun[] }): Conversation {
  return {
    id: 'conversation',
    title: 'Conversation',
    messages: params.messages,
    providerId: 'provider',
    systemPrompt: '',
    createdAt: 1,
    updatedAt: 2,
    ...(params.runs ? { agentRuns: params.runs } : {}),
  };
}

describe('resolveForegroundTerminalMemorySource', () => {
  it('returns the replacement final from the exact tracked run', () => {
    const replacement = finalAssistant('assistant-replacement', 13);
    const value = conversation({
      runs: [trackedRun()],
      messages: [
        { id: 'user-current', role: 'user', content: 'Do it', timestamp: 10 },
        finalAssistant('assistant-original', 11),
        replacement,
      ],
    });

    expect(
      resolveForegroundTerminalMemorySource({
        conversation: value,
        currentAssistantMessageId: 'assistant-original',
        runId: 'run-current',
        status: 'succeeded',
      }),
    ).toBe(replacement);
  });

  it('skips a yielded projection while its tracked run remains running', () => {
    const value = conversation({
      runs: [trackedRun({ status: 'running' })],
      messages: [
        { id: 'user-current', role: 'user', content: 'Wait for it', timestamp: 10 },
        finalAssistant('assistant-yielded', 11, 'complete', 'yielded'),
      ],
    });

    expect(
      resolveForegroundTerminalMemorySource({
        conversation: value,
        currentAssistantMessageId: 'assistant-yielded',
        runId: 'run-current',
        status: 'succeeded',
      }),
    ).toBeUndefined();
  });

  it('skips a complete-looking fallback while the tracked run remains open', () => {
    const value = conversation({
      runs: [trackedRun({ status: 'running' })],
      messages: [
        { id: 'user-current', role: 'user', content: 'Wait for it', timestamp: 10 },
        finalAssistant('assistant-temporary-fallback', 11),
      ],
    });

    expect(
      resolveForegroundTerminalMemorySource({
        conversation: value,
        currentAssistantMessageId: 'assistant-temporary-fallback',
        runId: 'run-current',
        status: 'succeeded',
      }),
    ).toBeUndefined();
  });

  it('throws when a terminal successful tracked run has no exact final projection', () => {
    const value = conversation({
      runs: [
        trackedRun({
          controlGraph: { status: 'finalized' } as AgentRun['controlGraph'],
        }),
      ],
      messages: [
        { id: 'user-prior', role: 'user', content: 'Prior', timestamp: 1 },
        finalAssistant('assistant-prior', 2),
        { id: 'user-current', role: 'user', content: 'Current', timestamp: 10 },
        finalAssistant('assistant-incomplete', 11, 'incomplete'),
      ],
    });

    expect(() =>
      resolveForegroundTerminalMemorySource({
        conversation: value,
        currentAssistantMessageId: 'assistant-incomplete',
        runId: 'run-current',
        status: 'succeeded',
      }),
    ).toThrow('foreground_terminal_memory_agent_final_unavailable');
  });

  it('publishes an exact complete final even when the foreground run failed', () => {
    const complete = finalAssistant('assistant-complete', 11);
    const value = conversation({
      runs: [trackedRun({ status: 'failed' })],
      messages: [{ id: 'user-current', role: 'user', content: 'Current', timestamp: 10 }, complete],
    });

    expect(
      resolveForegroundTerminalMemorySource({
        conversation: value,
        currentAssistantMessageId: complete.id,
        runId: 'run-current',
        status: 'failed',
      }),
    ).toBe(complete);
  });

  it('skips a failed run whose latest owning projection is incomplete', () => {
    const value = conversation({
      runs: [trackedRun({ status: 'failed' })],
      messages: [
        { id: 'user-current', role: 'user', content: 'Current', timestamp: 10 },
        finalAssistant('assistant-older-complete', 11),
        finalAssistant('assistant-latest-incomplete', 12, 'incomplete'),
      ],
    });

    expect(
      resolveForegroundTerminalMemorySource({
        conversation: value,
        currentAssistantMessageId: 'assistant-latest-incomplete',
        runId: 'run-current',
        status: 'failed',
      }),
    ).toBeUndefined();
  });

  it('skips an incomplete source when terminal review succeeded after the run failed', () => {
    const value = conversation({
      runs: [trackedRun({ status: 'failed' })],
      messages: [
        { id: 'user-current', role: 'user', content: 'Current', timestamp: 10 },
        finalAssistant('assistant-incomplete', 11, 'incomplete'),
      ],
    });

    expect(
      resolveForegroundTerminalMemorySource({
        conversation: value,
        currentAssistantMessageId: 'assistant-incomplete',
        runId: 'run-current',
        status: 'succeeded',
      }),
    ).toBeUndefined();
  });

  it('never publishes a cancelled foreground turn', () => {
    const value = conversation({
      runs: [trackedRun({ status: 'cancelled' })],
      messages: [
        { id: 'user-current', role: 'user', content: 'Current', timestamp: 10 },
        finalAssistant('assistant-complete', 11),
      ],
    });

    expect(
      resolveForegroundTerminalMemorySource({
        conversation: value,
        currentAssistantMessageId: 'assistant-complete',
        runId: 'run-current',
        status: 'cancelled',
      }),
    ).toBeUndefined();
  });

  it('returns only the exact closed assistant identity for an untracked turn', () => {
    const current = finalAssistant('assistant-current', 4);
    const value = conversation({
      messages: [
        { id: 'user-prior', role: 'user', content: 'Prior', timestamp: 1 },
        finalAssistant('assistant-prior', 2),
        { id: 'user-current', role: 'user', content: 'Current', timestamp: 3 },
        current,
      ],
    });

    expect(
      resolveForegroundTerminalMemorySource({
        conversation: value,
        currentAssistantMessageId: current.id,
        status: 'succeeded',
      }),
    ).toBe(current);
  });

  it('skips an untracked reply that is not one closed final ending its turn', () => {
    const user: Message = { id: 'user-current', role: 'user', content: 'Current', timestamp: 3 };
    const current = finalAssistant('assistant-current', 4);
    const resolve = (messages: Message[], id = current.id) =>
      resolveForegroundTerminalMemorySource({
        conversation: conversation({ messages }),
        currentAssistantMessageId: id,
        status: 'succeeded',
      });

    expect(resolve([user, current, { ...current, timestamp: 5 }])).toBeUndefined();
    expect(resolve([user, current], user.id)).toBeUndefined();
    expect(resolve([user, current, finalAssistant('assistant-later', 5)])).toBeUndefined();
    expect(
      resolve([
        user,
        current,
        { id: 'tool-later', role: 'tool', content: '{}', timestamp: 5, toolCallId: 'call-1' },
      ]),
    ).toBeUndefined();
    expect(
      resolve([
        user,
        current,
        { id: 'user-next', role: 'user', content: 'Next', timestamp: 6 },
        finalAssistant('assistant-next', 7),
      ]),
    ).toBe(current);
    expect(
      resolve([
        user,
        current,
        {
          ...finalAssistant('sub-agent-event', 5),
          subAgentEvent: { type: 'sub-agent' } as NonNullable<Message['subAgentEvent']>,
        },
      ]),
    ).toBe(current);
  });

  it('skips a successful untracked turn whose exact current assistant is not closed', () => {
    const value = conversation({
      messages: [
        { id: 'user-prior', role: 'user', content: 'Prior', timestamp: 1 },
        finalAssistant('assistant-prior', 2),
        { id: 'user-current', role: 'user', content: 'Current', timestamp: 3 },
        finalAssistant('assistant-current', 4, 'incomplete'),
      ],
    });

    expect(
      resolveForegroundTerminalMemorySource({
        conversation: value,
        currentAssistantMessageId: 'assistant-current',
        status: 'succeeded',
      }),
    ).toBeUndefined();
  });

  it('skips an incomplete untracked source after foreground failure', () => {
    const value = conversation({
      messages: [
        { id: 'user-current', role: 'user', content: 'Current', timestamp: 3 },
        finalAssistant('assistant-current', 4, 'incomplete'),
      ],
    });

    expect(
      resolveForegroundTerminalMemorySource({
        conversation: value,
        currentAssistantMessageId: 'assistant-current',
        status: 'failed',
      }),
    ).toBeUndefined();
  });
});
