import { recoverActiveToolCallsAfterRestart } from '../../src/store/agentRuns/toolCalls';
import { AMBIGUOUS_EFFECT_RESTART_ERROR } from '../../src/services/executionJournal/toolEffectRestartProjection';
import type { Message } from '../../src/types/message';

const TIMESTAMP = 200;

function messages(): Message[] {
  return [
    { id: 'user-1', role: 'user', content: 'Create it.', timestamp: 1 },
    {
      id: 'assistant-1',
      role: 'assistant',
      content: '',
      timestamp: 2,
      toolCalls: [
        {
          id: 'tool-call-1',
          name: 'calendar_create_event',
          arguments: '{}',
          status: 'running',
          startedAt: 10,
        },
      ],
    },
  ];
}

function recover(
  resolveToolEffect: Parameters<typeof recoverActiveToolCallsAfterRestart>[0]['resolveToolEffect'],
) {
  return recoverActiveToolCallsAfterRestart({
    conversationId: 'conversation-1',
    executionRunId: 'execution-run-1',
    messages: messages(),
    run: { id: 'run-1', userMessageId: 'user-1', createdAt: 1 },
    timestamp: TIMESTAMP,
    interruptedErrorMessage: 'Interrupted by restart.',
    resolveToolEffect,
  });
}

describe('agent-run tool recovery after restart', () => {
  it('projects a durably verified effect as completed without inventing its payload', () => {
    const resolveToolEffect = jest.fn(() => ({
      kind: 'verified' as const,
      observedAt: 150,
    }));

    const recovered = recover(resolveToolEffect);
    const toolCall = recovered.messages[1]?.toolCalls?.[0];

    expect(resolveToolEffect).toHaveBeenCalledWith({
      conversationId: 'conversation-1',
      executionRunId: 'execution-run-1',
      toolCallId: 'tool-call-1',
      toolName: 'calendar_create_event',
      argumentsText: '{}',
    });
    expect(recovered).toMatchObject({ completedCount: 1, failedCount: 0 });
    expect(toolCall).toMatchObject({
      status: 'completed',
      completedAt: 150,
      updatedAt: TIMESTAMP,
      error: undefined,
    });
    expect(toolCall?.result).toContain('durably verified');
    expect(toolCall?.result).toContain('original tool response was not retained');
  });

  // Nothing ever settles an ordinary tool's interrupted effect, so waiting for that left the
  // conversation unusable forever (see scratchpad TLA+ EffectRestart: OwnerEventuallyFree).
  it('marks an interrupted effect as possibly applied instead of waiting for a reconciler', () => {
    const recovered = recover(() => ({
      kind: 'reconciliation_required',
      observedAt: 150,
      reason: 'ambiguous_effect',
    }));
    const toolCall = recovered.messages[1]?.toolCalls?.[0];

    expect(recovered).toMatchObject({ completedCount: 0, failedCount: 1 });
    expect(toolCall).toMatchObject({
      status: 'failed',
      failureKind: 'reconciliation_required',
      error: AMBIGUOUS_EFFECT_RESTART_ERROR,
      completedAt: TIMESTAMP,
    });
  });

  it('settles every call of an interrupted batch on the same launch', () => {
    const toolMessages = messages();
    toolMessages[1]?.toolCalls?.push({
      id: 'tool-call-2',
      name: 'send_email',
      arguments: '{}',
      status: 'running',
      startedAt: 20,
    });

    const recovered = recoverActiveToolCallsAfterRestart({
      conversationId: 'conversation-1',
      executionRunId: 'execution-run-1',
      messages: toolMessages,
      run: { id: 'run-1', userMessageId: 'user-1', createdAt: 1 },
      timestamp: TIMESTAMP,
      interruptedErrorMessage: 'Interrupted by restart.',
      resolveToolEffect: ({ toolCallId }) =>
        toolCallId === 'tool-call-1'
          ? { kind: 'verified', observedAt: 150 }
          : {
              kind: 'reconciliation_required',
              observedAt: 160,
              reason: 'ambiguous_effect',
            },
    });

    expect(recovered).toMatchObject({ completedCount: 1, failedCount: 1 });
    expect(recovered.messages[1]?.toolCalls).toEqual([
      expect.objectContaining({ id: 'tool-call-1', status: 'completed' }),
      expect.objectContaining({
        id: 'tool-call-2',
        status: 'failed',
        error: AMBIGUOUS_EFFECT_RESTART_ERROR,
      }),
    ]);
  });

  it('uses ordinary interruption semantics when durable dispatch never started', () => {
    const recovered = recover(() => ({ kind: 'not_dispatched' }));

    expect(recovered.messages[1]?.toolCalls?.[0]).toMatchObject({
      status: 'failed',
      error: 'Interrupted by restart.',
    });
  });
});
