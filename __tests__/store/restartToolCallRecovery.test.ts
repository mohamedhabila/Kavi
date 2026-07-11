import { recoverActiveToolCallsAfterRestart } from '../../src/store/agentRuns/toolCalls';
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
      taskId: 'run-1',
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

  it('keeps an ambiguous dispatched effect active for exact reconciliation', () => {
    const recovered = recover(() => ({
      kind: 'reconciliation_required',
      observedAt: 150,
      reason: 'ambiguous_effect',
    }));
    const toolCall = recovered.messages[1]?.toolCalls?.[0];

    expect(recovered).toMatchObject({
      completedCount: 0,
      failedCount: 0,
      reconciliationPendingCount: 1,
    });
    expect(toolCall).toMatchObject({ status: 'running' });
    expect(toolCall).not.toHaveProperty('completedAt');
    expect(toolCall?.error).toBeUndefined();
  });

  it('does not partially project a tool batch while any effect is unresolved', () => {
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

    expect(recovered).toMatchObject({
      completedCount: 0,
      failedCount: 0,
      reconciliationPendingCount: 1,
    });
    expect(recovered.messages[1]?.toolCalls).toEqual([
      expect.objectContaining({ id: 'tool-call-1', status: 'running' }),
      expect.objectContaining({ id: 'tool-call-2', status: 'running' }),
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
