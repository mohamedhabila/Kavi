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

function context(
  messages: Message[],
  transcriptRetainedFromStart = true,
  tools = ['wait'],
): SubAgentSessionContext {
  return {
    config: {
      parentConversationId: 'conversation-1',
      prompt: ORIGINAL_TASK,
      tools,
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
    transcriptRetainedFromStart,
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

  it('resumes a pending built-in read from its exact retained call boundary', () => {
    const plan = buildSubAgentRestartRecoveryPlan({
      agent: runningAgent({
        iterations: 12,
        toolsUsed: ['read_file'],
        activeToolName: 'read_file',
      }),
      context: context(
        [
          { id: 'user-1', role: 'user', content: ORIGINAL_TASK, timestamp: 1_000 },
          pendingToolMessage(
            'read_file',
            '{"path":"attachments/runtime.txt","offset":4096,"maxChars":8192}',
            'call-read',
          ),
        ],
        true,
        ['read_file'],
      ),
      now: NOW,
    });

    expect(plan).toMatchObject({
      interruptedToolCallId: 'call-read',
      interruptedToolName: 'read_file',
      recoveredAt: NOW,
      config: { prompt: ORIGINAL_TASK, depth: 0 },
    });
    const recoveryMessages = plan!.config.initialMessages!;
    expect(JSON.parse(recoveryMessages.at(-2)!.content)).toMatchObject({
      status: 'interrupted',
      code: 'app_restart',
      successful: false,
      retryable: true,
      toolName: 'read_file',
      requested: {
        path: 'attachments/runtime.txt',
        offset: 4096,
        maxChars: 8192,
      },
    });
    expect(recoveryMessages.at(-1)?.content).toContain(
      'immediately preceding effect-free read_file call was interrupted',
    );
  });

  it.each(['completed', 'failed'] as const)(
    'pairs an unpaired locally %s effect-free call before provider replay',
    (status) => {
      const unpairedRead = pendingToolMessage(
        'read_file',
        '{"path":"attachments/runtime.txt","offset":12288,"maxChars":4096}',
        `call-read-${status}`,
      );
      unpairedRead.toolCalls![0]!.status = status;

      const plan = buildSubAgentRestartRecoveryPlan({
        agent: runningAgent({ iterations: 13, toolsUsed: ['read_file'] }),
        context: context(
          [{ id: 'user-1', role: 'user', content: ORIGINAL_TASK, timestamp: 1_000 }, unpairedRead],
          true,
          ['read_file'],
        ),
        now: NOW,
      });

      expect(plan).toMatchObject({
        recoveryBoundary: 'interrupted_effect_free_call',
        interruptedToolCallId: `call-read-${status}`,
        interruptedToolName: 'read_file',
      });
      const recoveryMessages = plan!.config.initialMessages!;
      expect(recoveryMessages.at(-2)).toMatchObject({
        role: 'tool',
        toolCallId: `call-read-${status}`,
        isError: true,
        toolCalls: [expect.objectContaining({ status: 'failed' })],
      });
    },
  );

  it('pairs one interrupted effect-free call after completed siblings in the same batch', () => {
    const batch: Message = {
      id: 'assistant-read-batch',
      role: 'assistant',
      content: '',
      timestamp: 9_000,
      toolCalls: [
        {
          id: 'call-read-complete',
          name: 'read_file',
          arguments: '{"path":"attachments/one.txt","offset":0}',
          status: 'completed',
        },
        {
          id: 'call-read-interrupted',
          name: 'read_file',
          arguments: '{"path":"attachments/two.txt","offset":4096}',
          status: 'running',
        },
      ],
    };
    const completedSibling: Message = {
      id: 'tool-read-complete',
      role: 'tool',
      content: '{"status":"read_chunk","path":"attachments/one.txt","complete":true}',
      toolCallId: 'call-read-complete',
      timestamp: 9_100,
    };

    const plan = buildSubAgentRestartRecoveryPlan({
      agent: runningAgent({ iterations: 14, toolsUsed: ['read_file'] }),
      context: context(
        [
          { id: 'user-1', role: 'user', content: ORIGINAL_TASK, timestamp: 1_000 },
          batch,
          completedSibling,
        ],
        true,
        ['read_file'],
      ),
      now: NOW,
    });

    expect(plan).toMatchObject({
      recoveryBoundary: 'interrupted_effect_free_call',
      interruptedToolCallId: 'call-read-interrupted',
    });
    expect(plan!.config.initialMessages!.slice(-3)).toEqual([
      expect.objectContaining({ id: 'tool-read-complete', role: 'tool' }),
      expect.objectContaining({
        role: 'tool',
        toolCallId: 'call-read-interrupted',
        isError: true,
      }),
      expect.objectContaining({ role: 'user' }),
    ]);
  });

  it('fails closed when an unpaired call precedes a later model turn', () => {
    expect(
      buildSubAgentRestartRecoveryPlan({
        agent: runningAgent(),
        context: context(
          [
            pendingToolMessage('read_file', '{"path":"attachments/one.txt"}', 'call-old'),
            {
              id: 'assistant-later',
              role: 'assistant',
              content: 'Continuing despite the missing result.',
              timestamp: 9_500,
            },
          ],
          true,
          ['read_file'],
        ),
        now: NOW,
      }),
    ).toBeNull();
  });

  it('fails closed for an unpaired locally completed side-effecting call', () => {
    const unpairedWrite = pendingToolMessage(
      'write_file',
      '{"path":"result.txt","content":"done"}',
      'call-write-completed',
    );
    unpairedWrite.toolCalls![0]!.status = 'completed';

    expect(
      buildSubAgentRestartRecoveryPlan({
        agent: runningAgent(),
        context: context([unpairedWrite], true, ['write_file']),
        now: NOW,
      }),
    ).toBeNull();
  });

  it('recovers a compacted transcript when the entire explicit surface is effect-free', () => {
    const plan = buildSubAgentRestartRecoveryPlan({
      agent: runningAgent(),
      context: context(
        [
          {
            id: 'tool-old',
            role: 'tool',
            content: '{"status":"waited","waitedMs":60000}',
            toolCallId: 'call-old',
            timestamp: 8_000,
          },
          pendingToolMessage('wait', '{"ms":60000,"reason":"checkpoint 02/02"}'),
        ],
        false,
      ),
      now: NOW,
    });

    expect(plan).toMatchObject({
      recoveryBoundary: 'interrupted_effect_free_call',
      interruptedToolName: 'wait',
    });
    expect(plan!.config.initialMessages?.[0]).toMatchObject({
      role: 'user',
      content: ORIGINAL_TASK,
    });
    expect(plan!.config.initialMessages?.some((message) => message.id === 'tool-old')).toBe(false);
    expect(plan!.config.initialMessages?.at(-1)?.content).toContain(
      'Earlier transcript content was compacted',
    );
  });

  it('resumes a compacted quiescent read checkpoint without trusting its summary as proof', () => {
    const completedBatch: Message[] = [
      {
        id: 'orphan-tool',
        role: 'tool',
        content: '{}',
        toolCallId: 'orphan-call',
        timestamp: 7_000,
      },
      {
        id: 'assistant-read-batch',
        role: 'assistant',
        content: '',
        timestamp: 8_000,
        toolCalls: [
          {
            id: 'read-1',
            name: 'read_file',
            arguments: '{"path":"one.txt","offset":4096}',
            status: 'pending',
          },
          {
            id: 'read-2',
            name: 'read_file',
            arguments: '{"path":"two.txt","offset":8192}',
            status: 'pending',
          },
        ],
      },
      {
        id: 'tool-read-1',
        role: 'tool',
        content:
          '{"status":"read_chunk","path":"one.txt","offset":4096,"totalChars":10000,"complete":false}',
        toolCallId: 'read-1',
        timestamp: 8_100,
      },
      {
        id: 'tool-read-2',
        role: 'tool',
        content:
          '{"status":"read_chunk","path":"two.txt","offset":8192,"totalChars":12000,"complete":false}',
        toolCallId: 'read-2',
        timestamp: 8_200,
      },
    ];
    const compactedContext = context(completedBatch, false, ['read_file']);
    compactedContext.conversationSummary = 'Two sources were partially inspected.';

    const plan = buildSubAgentRestartRecoveryPlan({
      agent: runningAgent({ iterations: 67, toolsUsed: ['read_file'] }),
      context: compactedContext,
      now: NOW,
    });

    expect(plan).toMatchObject({
      recoveryBoundary: 'effect_free_checkpoint',
      recoveredAt: NOW,
    });
    const recoveryMessages = plan!.config.initialMessages!;
    expect(recoveryMessages[0]).toMatchObject({ role: 'user', content: ORIGINAL_TASK });
    expect(recoveryMessages.some((message) => message.id === 'orphan-tool')).toBe(false);
    expect(recoveryMessages.at(-1)?.content).toContain(
      'retained summary and durable read checkpoints as orientation only, not as proof',
    );
    expect(recoveryMessages.at(-1)?.content).toContain('Two sources were partially inspected.');
  });

  it('fails closed for compacted state when any allowed tool can cause effects', () => {
    const plan = buildSubAgentRestartRecoveryPlan({
      agent: runningAgent(),
      context: context([pendingToolMessage('wait', '{"ms":60000,"reason":"checkpoint"}')], false, [
        'wait',
        'write_file',
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
