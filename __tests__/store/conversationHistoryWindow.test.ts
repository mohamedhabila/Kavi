import {
  CONVERSATION_HISTORY_TOKEN_LIMIT,
  CONVERSATION_HISTORY_TOKEN_TARGET,
  estimateStoredMessageTokens,
  selectHistoryWindow,
} from '../../src/store/conversationHistoryWindow';
import { estimateImageInputTokens } from '../../src/services/context/contentTokens';
import type { Message } from '../../src/types/message';

// The one conversation's live history was capped at 500 messages: a few days of chat, or a
// single long task, whatever the messages held. It is bounded by tokens now, and cut only
// where a turn opens.

const TURN_TEXT = 'word '.repeat(4_000);

function user(id: string, overrides: Partial<Message> = {}): Message {
  return { id, role: 'user', content: TURN_TEXT, timestamp: 1, ...overrides };
}

function assistant(id: string, overrides: Partial<Message> = {}): Message {
  return { id, role: 'assistant', content: 'Done.', timestamp: 1, ...overrides };
}

function tokens(messages: ReadonlyArray<Message>): number {
  return messages.reduce((total, message) => total + estimateStoredMessageTokens(message), 0);
}

/** Whole turns (user + assistant) until the history is just over the limit. */
function historyOverLimit(): Message[] {
  const messages: Message[] = [];
  for (let turn = 0; tokens(messages) <= CONVERSATION_HISTORY_TOKEN_LIMIT; turn += 1) {
    messages.push(user(`u${turn}`), assistant(`a${turn}`));
  }
  return messages;
}

describe('selectHistoryWindow', () => {
  it('keeps a history within the limit as it is', () => {
    const messages = [user('u0'), assistant('a0')];

    const { kept, leaving } = selectHistoryWindow(messages);

    expect(kept).toEqual(messages);
    expect(leaving).toEqual([]);
  });

  it('cuts an oversized history at a turn, back under the target', () => {
    const messages = historyOverLimit();

    const { kept, leaving } = selectHistoryWindow(messages);

    expect(tokens(kept)).toBeLessThanOrEqual(CONVERSATION_HISTORY_TOKEN_TARGET);
    expect(kept[0]!.role).toBe('user');
    expect([...leaving, ...kept]).toEqual(messages);
    // The earliest turn that fits: one more turn would not.
    const previousTurnStart = messages.indexOf(kept[0]!) - 2;
    expect(tokens(messages.slice(previousTurnStart))).toBeGreaterThan(
      CONVERSATION_HISTORY_TOKEN_TARGET,
    );
  });

  it('keeps the newest turn whole however large it is', () => {
    const huge = user('u-huge', {
      content: 'word '.repeat(Math.ceil(CONVERSATION_HISTORY_TOKEN_LIMIT / 1.5)),
    });
    const messages = [user('u0'), assistant('a0'), huge, assistant('a-huge')];
    expect(tokens(messages)).toBeGreaterThan(CONVERSATION_HISTORY_TOKEN_LIMIT);

    const { kept, leaving } = selectHistoryWindow(messages);

    expect(kept.map((message) => message.id)).toEqual(['u-huge', 'a-huge']);
    expect(leaving.map((message) => message.id)).toEqual(['u0', 'a0']);
  });

  it('keeps a history that is one turn, even over the limit', () => {
    const messages = [
      user('u0', { content: 'word '.repeat(CONVERSATION_HISTORY_TOKEN_LIMIT) }),
      assistant('a0'),
    ];

    expect(selectHistoryWindow(messages).leaving).toEqual([]);
  });

  it('keeps protected messages from before the cut, in order', () => {
    const messages = historyOverLimit();

    const { kept, leaving } = selectHistoryWindow(messages, new Set(['u1']));

    expect(kept[0]!.id).toBe('u1');
    expect(leaving.some((message) => message.id === 'u1')).toBe(false);
    expect(leaving[0]!.id).toBe('u0');
  });

  it('never cuts at a steering message, so a run keeps what steered it', () => {
    const messages = historyOverLimit();
    const unsteered = selectHistoryWindow(messages).kept[0]!;
    const steered = messages.map((message) =>
      message.id === unsteered.id ? { ...message, steerOfRunId: 'run-1' } : message,
    );

    const cutAt = selectHistoryWindow(steered).kept[0]!;

    expect(cutAt.role).toBe('user');
    expect(cutAt.steerOfRunId).toBeUndefined();
    expect(steered.indexOf(cutAt)).toBeGreaterThan(messages.indexOf(unsteered));
  });

  it('leaves no tool result without its call', () => {
    const messages: Message[] = [];
    for (let turn = 0; tokens(messages) <= CONVERSATION_HISTORY_TOKEN_LIMIT; turn += 1) {
      messages.push(
        user(`u${turn}`),
        assistant(`a${turn}`, {
          content: '',
          toolCalls: [
            { id: `call-${turn}`, name: 'web_search', arguments: '{}', status: 'completed' },
          ],
        }),
        { id: `t${turn}`, role: 'tool', toolCallId: `call-${turn}`, content: 'ok', timestamp: 1 },
        assistant(`f${turn}`),
      );
    }

    const { kept } = selectHistoryWindow(messages);

    const calls = new Set(kept.flatMap((message) => message.toolCalls ?? []).map((c) => c.id));
    const results = kept.filter((message) => message.role === 'tool');
    expect(results.length).toBeGreaterThan(0);
    expect(results.every((message) => calls.has(message.toolCallId!))).toBe(true);
  });
});

describe('estimateStoredMessageTokens', () => {
  it('counts what a request carries: enriched text, tool calls and images', () => {
    const plain = estimateStoredMessageTokens(user('u0', { content: 'hi' }));
    const enriched = estimateStoredMessageTokens(
      user('u1', { content: 'hi', enrichedContent: `hi\n${TURN_TEXT}` }),
    );
    const withImage = estimateStoredMessageTokens(
      user('u2', {
        content: 'hi',
        attachments: [
          {
            id: 'img',
            type: 'image',
            uri: 'file:///a.jpg',
            name: 'a',
            mimeType: 'image/jpeg',
            size: 1,
          },
        ],
      }),
    );
    const withCall = estimateStoredMessageTokens(
      assistant('a0', {
        content: 'hi',
        toolCalls: [
          {
            id: 'c',
            name: 'web_search',
            arguments: JSON.stringify({ q: TURN_TEXT }),
            status: 'completed',
          },
        ],
      }),
    );

    expect(enriched).toBeGreaterThan(plain + 1_000);
    expect(withImage).toBe(plain + estimateImageInputTokens());
    expect(withCall).toBeGreaterThan(plain + 1_000);
  });
});
