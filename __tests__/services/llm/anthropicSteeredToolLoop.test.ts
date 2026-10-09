import { canContinueAnthropicThinking as canEngineContinueAnthropicThinking } from '../../../src/engine/orchestratorMessageFormatting';
import { isToolLoopInProgress } from '../../../src/engine/orchestratorToolTranscript';
import { sanitizeAnthropicRequestOptions } from '../../../src/services/llm/providers/anthropic/requestOptions';
import {
  canContinueAnthropicThinking,
  isAnthropicToolLoopInProgress,
} from '../../../src/services/llm/providers/anthropic/toolReplay';
import type { ChatCompletionMessage } from '../../../src/services/llm/support/contracts';
import type { Message } from '../../../src/types/message';

// The Anthropic adapter sends a user message that follows tool results inside the same
// user turn as those results. A message that steered a running run arrives exactly
// there, so the tool loop is still open: the last assistant tool-use turn needs its
// thinking replayed, or thinking must be off for the request.

const TOOL_CALL = {
  id: 'call-1',
  type: 'function',
  function: { name: 'web_search', arguments: '{}' },
};

function steeredToolTurn(assistant: ChatCompletionMessage): ChatCompletionMessage[] {
  return [
    { role: 'user', content: 'Plan a dinner for my team.' },
    assistant,
    { role: 'tool', tool_call_id: 'call-1', content: 'ok' },
    { role: 'user', content: 'Make it vegetarian.' },
  ] as ChatCompletionMessage[];
}

const PLAIN_TOOL_USE = { role: 'assistant', content: '', tool_calls: [TOOL_CALL] } as never;
const THINKING_TOOL_USE = {
  role: 'assistant',
  content: [
    { type: 'thinking', thinking: 'Search first.', signature: 'signed-thinking' },
    { type: 'tool_use', id: 'call-1', name: 'web_search', input: {} },
  ],
} as never;

describe('a user message inside the tool-result turn', () => {
  it('keeps the tool loop open', () => {
    expect(isAnthropicToolLoopInProgress(steeredToolTurn(PLAIN_TOOL_USE))).toBe(true);
  });

  it('still closes the loop at a user message after a final answer', () => {
    expect(
      isAnthropicToolLoopInProgress([
        { role: 'user', content: 'Hi' },
        { role: 'assistant', content: 'Hello!' },
        { role: 'user', content: 'Plan a dinner.' },
      ] as ChatCompletionMessage[]),
    ).toBe(false);
  });

  it('continues the thinking of the tool-use turn it follows', () => {
    expect(canContinueAnthropicThinking(steeredToolTurn(THINKING_TOOL_USE))).toBe(true);
    expect(canContinueAnthropicThinking(steeredToolTurn(PLAIN_TOOL_USE))).toBe(false);
  });

  it('turns thinking off when the tool-use turn has no thinking to replay', () => {
    const options = sanitizeAnthropicRequestOptions({
      model: 'claude-sonnet-4-5',
      messages: steeredToolTurn(PLAIN_TOOL_USE),
      options: { thinking: { type: 'enabled', budget_tokens: 2048 }, maxTokens: 8192 },
      buildAnthropicOutputConfig: () => undefined,
    });

    expect(options.thinking).toBeUndefined();
  });

  it('is seen the same way by the engine before formatting', () => {
    const messages: Message[] = [
      { id: 'request', role: 'user', content: 'Plan a dinner.', timestamp: 1 },
      {
        id: 'step',
        role: 'assistant',
        content: '',
        timestamp: 2,
        toolCalls: [{ id: 'call-1', name: 'web_search', arguments: '{}' }],
      },
      { id: 'result', role: 'tool', toolCallId: 'call-1', content: 'ok', timestamp: 3 },
      { id: 'steer', role: 'user', content: 'Vegetarian.', timestamp: 4, steerOfRunId: 'run-1' },
    ];

    expect(isToolLoopInProgress(messages)).toBe(true);
    messages[1] = {
      ...messages[1]!,
      providerReplay: {
        anthropicBlocks: [
          { type: 'thinking', thinking: 'Search first.', signature: 'signed-thinking' },
          { type: 'tool_use', id: 'call-1', name: 'web_search', input: {} },
        ],
      },
    };
    expect(canEngineContinueAnthropicThinking(messages)).toBe(true);
  });
});
