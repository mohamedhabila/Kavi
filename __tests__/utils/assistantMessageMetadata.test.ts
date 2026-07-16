import {
  buildAssistantMessageMetadata,
  hasCompleteFinalAssistantMetadata,
  hasTerminalAssistantCompletionMetadata,
  isValidAssistantMessageMetadata,
  MISSING_ASSISTANT_COMPLETION_FINISH_REASON,
} from '../../src/utils/assistantMessageMetadata';
import { Message } from '../../src/types/message';

const timestamp = 1_700_000_000_000;

function makeMessage(overrides: Partial<Message>): Message {
  return {
    id: 'message-id',
    role: 'assistant',
    content: '',
    timestamp,
    ...overrides,
  };
}

describe('assistantMessageMetadata', () => {
  it('requires explicit metadata for a complete final assistant message', () => {
    const message = makeMessage({
      id: 'assistant-final',
      role: 'assistant',
      content: 'Final answer',
    });

    expect(hasCompleteFinalAssistantMetadata(message)).toBe(false);
    expect(
      hasCompleteFinalAssistantMetadata({
        ...message,
        assistantMetadata: buildAssistantMessageMetadata('final', {
          completionStatus: 'complete',
          finishReason: 'stop',
        }),
      }),
    ).toBe(true);
  });

  it('fails closed when a producer omits typed finish metadata', () => {
    const metadata = buildAssistantMessageMetadata('final', {
      completionStatus: 'complete',
    });

    expect(metadata).toEqual({
      kind: 'final',
      completionStatus: 'incomplete',
      finishReason: MISSING_ASSISTANT_COMPLETION_FINISH_REASON,
    });
    expect(
      hasCompleteFinalAssistantMetadata(
        makeMessage({ content: 'Visible but not typed.', assistantMetadata: metadata }),
      ),
    ).toBe(false);
  });

  it('fails closed for syntactically valid but unknown complete dispositions', () => {
    const metadata = buildAssistantMessageMetadata('final', {
      completionStatus: 'complete',
      finishReason: 'plausible_but_unowned_success',
    });
    const forgedMessage = makeMessage({
      content: 'A forged complete response.',
      assistantMetadata: {
        kind: 'final',
        completionStatus: 'complete',
        finishReason: 'plausible_but_unowned_success',
      },
    });

    expect(metadata).toEqual({
      kind: 'final',
      completionStatus: 'incomplete',
      finishReason: MISSING_ASSISTANT_COMPLETION_FINISH_REASON,
    });
    expect(isValidAssistantMessageMetadata(forgedMessage.assistantMetadata)).toBe(false);
    expect(hasTerminalAssistantCompletionMetadata(forgedMessage)).toBe(false);
  });

  it('requires a nonempty plain final before terminal closure', () => {
    const metadata = buildAssistantMessageMetadata('final', {
      completionStatus: 'complete',
      finishReason: 'stop',
    });

    expect(
      hasTerminalAssistantCompletionMetadata(makeMessage({ assistantMetadata: metadata })),
    ).toBe(false);
    expect(
      hasTerminalAssistantCompletionMetadata(
        makeMessage({
          content: 'Calling a tool is not a final response.',
          assistantMetadata: metadata,
          toolCalls: [{ id: 'call-1', name: 'calendar_list', arguments: '{}', status: 'pending' }],
        }),
      ),
    ).toBe(false);
  });

  it('does not admit a tool handoff disposition as final-response metadata', () => {
    const metadata = buildAssistantMessageMetadata('final', {
      completionStatus: 'complete',
      finishReason: 'tool_calls',
    });

    expect(metadata).toEqual({
      kind: 'final',
      completionStatus: 'incomplete',
      finishReason: MISSING_ASSISTANT_COMPLETION_FINISH_REASON,
    });
    expect(
      isValidAssistantMessageMetadata({
        kind: 'intermediate',
        completionStatus: 'complete',
        finishReason: 'tool_calls',
      }),
    ).toBe(true);
  });

  it.each([
    "I've reached the maximum number of tool iterations. Here's what I've accomplished so far.",
    'Waiting for 2 background workers to finish.',
    'Esperando a que terminen 2 trabajadores en segundo plano.',
    'في انتظار انتهاء عاملين في الخلفية.',
  ])('uses typed completion instead of response-language heuristics: %s', (content) => {
    const message = makeMessage({
      content,
      assistantMetadata: buildAssistantMessageMetadata('final', {
        completionStatus: 'complete',
        finishReason: 'stop',
      }),
    });

    expect(hasCompleteFinalAssistantMetadata(message)).toBe(true);
    expect(hasTerminalAssistantCompletionMetadata(message)).toBe(true);
  });

  it('rejects typed non-delivery independently of the response language', () => {
    const message = makeMessage({
      content: 'تم إنجاز العمل بالكامل والتحقق منه.',
      assistantMetadata: buildAssistantMessageMetadata('final', {
        completionStatus: 'complete',
        finishReason: 'max_iterations',
      }),
    });

    expect(hasCompleteFinalAssistantMetadata(message)).toBe(false);
    expect(hasTerminalAssistantCompletionMetadata(message)).toBe(false);
  });

  it('does not infer completion from untyped prose', () => {
    const message = makeMessage({
      content: 'Waiting for 1 background worker to finish.',
    });

    expect(hasCompleteFinalAssistantMetadata(message)).toBe(false);
    expect(hasTerminalAssistantCompletionMetadata(message)).toBe(false);
  });
});
