import { buildSubAgentRestartRecoveryPlan } from '../../src/services/agents/subAgentRestartRecovery';
import type { SubAgentSessionContext } from '../../src/services/agents/lifecycle/sessionContext';
import type { Message } from '../../src/types/message';
import type { SubAgentSnapshot } from '../../src/types/subAgent';

const NOW = 10_000;
const ORIGINAL_TASK = 'Wait for checkpoint one, then checkpoint two, and report exact evidence.';

function runningAgent(overrides: Partial<SubAgentSnapshot> = {}): SubAgentSnapshot {
  return {
    sessionId: 'sub-restart-1',
    parentConversationId: 'conversation-1',
    depth: 0,
    startedAt: 1_000,
    updatedAt: 9_000,
    status: 'running',
    sandboxPolicy: 'safe-only',
    ...overrides,
  };
}

function context(messages: Message[]): SubAgentSessionContext {
  return {
    config: {
      parentConversationId: 'conversation-1',
      prompt: ORIGINAL_TASK,
      tools: ['wait'],
      sandboxPolicy: 'safe-only',
    },
    provider: {
      id: 'provider-1',
      name: 'Provider',
      provider: 'openai',
      model: 'model-1',
      enabled: true,
    },
    systemPrompt: 'You are a focused worker.',
    conversationSummary: '',
    messages,
  };
}

function pendingToolMessage(name: string, argumentsText: string, id = 'call-pending'): Message {
  return {
    id: `assistant-${id}`,
    role: 'assistant',
    content: '',
    timestamp: 9_000,
    toolCalls: [
      {
        id,
        name,
        arguments: argumentsText,
        status: 'running',
        updatedAt: 9_000,
      },
    ],
  };
}

describe('sub-agent restart recovery', () => {
  it('pairs an interrupted wait with explicit failure evidence and resumes the retained task', () => {
    const messages: Message[] = [
      { id: 'user-1', role: 'user', content: ORIGINAL_TASK, timestamp: 1_000 },
      pendingToolMessage('wait', '{"ms":60000,"reason":"checkpoint 01/02"}', 'call-1'),
      {
        id: 'tool-1',
        role: 'tool',
        content: '{"status":"waited","waitedMs":60000,"reason":"checkpoint 01/02"}',
        toolCallId: 'call-1',
        timestamp: 8_000,
        toolCalls: [
          {
            id: 'call-1',
            name: 'wait',
            arguments: '{"ms":60000,"reason":"checkpoint 01/02"}',
            status: 'completed',
          },
        ],
      },
      pendingToolMessage('wait', '{"ms":60000,"reason":"checkpoint 02/02"}', 'call-2'),
    ];

    const plan = buildSubAgentRestartRecoveryPlan({
      agent: runningAgent({ iterations: 2, toolsUsed: ['wait'] }),
      context: context(messages),
      now: NOW,
    });

    expect(plan).not.toBeNull();
    expect(plan).toMatchObject({
      interruptedToolCallId: 'call-2',
      interruptedToolName: 'wait',
      recoveredAt: NOW,
      config: { prompt: ORIGINAL_TASK, depth: 0 },
    });
    const recoveryMessages = plan!.config.initialMessages!;
    const interruptedResult = recoveryMessages.at(-2)!;
    expect(interruptedResult).toMatchObject({
      role: 'tool',
      toolCallId: 'call-2',
      isError: true,
      toolCalls: [
        expect.objectContaining({
          id: 'call-2',
          name: 'wait',
          status: 'failed',
          failureKind: 'runtime_error',
        }),
      ],
    });
    expect(JSON.parse(interruptedResult.content)).toMatchObject({
      status: 'interrupted',
      code: 'app_restart',
      successful: false,
      retryable: true,
      requested: { ms: 60_000, reason: 'checkpoint 02/02' },
    });
    expect(recoveryMessages.at(-1)).toMatchObject({
      role: 'user',
      content: expect.stringContaining(ORIGINAL_TASK),
    });
  });

  it('fails closed for a side-effecting pending tool', () => {
    const plan = buildSubAgentRestartRecoveryPlan({
      agent: runningAgent(),
      context: context([
        { id: 'user-1', role: 'user', content: ORIGINAL_TASK, timestamp: 1_000 },
        pendingToolMessage('write_file', '{"path":"result.txt","content":"done"}'),
      ]),
      now: NOW,
    });

    expect(plan).toBeNull();
  });

  it('fails closed when earlier transcript evidence was truncated', () => {
    const plan = buildSubAgentRestartRecoveryPlan({
      agent: runningAgent(),
      context: context([
        {
          id: 'tool-old',
          role: 'tool',
          content: '{"status":"waited","waitedMs":60000}',
          toolCallId: 'call-old',
          timestamp: 8_000,
        },
        pendingToolMessage('wait', '{"ms":60000,"reason":"checkpoint 02/02"}'),
      ]),
      now: NOW,
    });

    expect(plan).toBeNull();
  });

  it('fails closed after the worker deadline or without explicit wait duration', () => {
    const retainedContext = context([
      { id: 'user-1', role: 'user', content: ORIGINAL_TASK, timestamp: 1_000 },
      pendingToolMessage('wait', '{}'),
    ]);

    expect(
      buildSubAgentRestartRecoveryPlan({
        agent: runningAgent(),
        context: retainedContext,
        now: NOW,
      }),
    ).toBeNull();
    expect(
      buildSubAgentRestartRecoveryPlan({
        agent: runningAgent({ deadlineAt: NOW }),
        context: context([
          { id: 'user-1', role: 'user', content: ORIGINAL_TASK, timestamp: 1_000 },
          pendingToolMessage('wait', '{"ms":60000}'),
        ]),
        now: NOW,
      }),
    ).toBeNull();
    expect(
      buildSubAgentRestartRecoveryPlan({
        agent: runningAgent({ deadlineAt: NOW + 999 }),
        context: context([
          { id: 'user-1', role: 'user', content: ORIGINAL_TASK, timestamp: 1_000 },
          pendingToolMessage('wait', '{"ms":60000}'),
        ]),
        now: NOW,
      }),
    ).toBeNull();
  });
});
