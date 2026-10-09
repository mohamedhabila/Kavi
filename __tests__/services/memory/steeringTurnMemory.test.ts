import { resolveClosedTurnEndingAt } from '../../../src/services/memory/closedTurn';
import {
  decodeIngestionSourceSnapshot,
  encodeIngestionSourceSnapshot,
  type EncodedIngestionSourceSnapshot,
} from '../../../src/services/memory/ingestionSourceSnapshot';
import { resolvePriorUserMessageIdentity } from '../../../src/services/memory/priorUserMessageIdentity';
import type { Message } from '../../../src/types/message';
import { sha256HexUtf8 } from '../../../src/utils/sha256';

// A message sent while a run is working steers that run: the run reads it at its next
// step, so it belongs to the run's turn. Memory must see one turn — request, steer, final
// answer — and keep the steer's words, instead of treating the steer as a new request
// whose turn has no answer.

const FINAL = { kind: 'final', completionStatus: 'complete', finishReason: 'stop' } as const;
const TOOL_STEP = {
  kind: 'intermediate',
  completionStatus: 'complete',
  finishReason: 'tool_calls',
} as const;

function steeredConversation(): Message[] {
  return [
    { id: 'prior-user', role: 'user', content: 'What is the capital of Peru?', timestamp: 1 },
    {
      id: 'prior-final',
      role: 'assistant',
      content: 'Lima.',
      timestamp: 2,
      assistantMetadata: FINAL,
    },
    { id: 'request', role: 'user', content: 'Plan a dinner for my team.', timestamp: 3 },
    {
      id: 'tool-step',
      role: 'assistant',
      content: '',
      timestamp: 4,
      assistantMetadata: TOOL_STEP,
      toolCalls: [{ id: 'call-1', name: 'web_search', arguments: '{}', status: 'completed' }],
    },
    { id: 'call-1-result', role: 'tool', toolCallId: 'call-1', content: 'ok', timestamp: 5 },
    {
      id: 'steer',
      role: 'user',
      content: 'Also, my sister Amira is vegetarian.',
      timestamp: 6,
      steerOfRunId: 'run-1',
    },
    {
      id: 'final',
      role: 'assistant',
      content: 'Here is a dinner plan with vegetarian options.',
      timestamp: 7,
      assistantMetadata: FINAL,
    },
  ];
}

function encodeSteeredTurn(messages: readonly Message[] = steeredConversation()) {
  return encodeIngestionSourceSnapshot({
    messages,
    sourceStartMessageId: 'request',
    sourceEndMessageId: 'final',
    priorUserMessageId: 'prior-user',
  });
}

function resealWith(
  snapshot: EncodedIngestionSourceSnapshot,
  mutate: (payload: { turnMessages: Record<string, unknown>[] }) => void,
): EncodedIngestionSourceSnapshot {
  const payload = JSON.parse(snapshot.payloadJson);
  mutate(payload);
  const canonical = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(canonical);
    if (typeof value !== 'object' || value === null) return value;
    const record = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(record)
        .sort()
        .map((key) => [key, canonical(record[key])]),
    );
  };
  const payloadJson = JSON.stringify(canonical(payload));
  return {
    snapshotVersion: 1,
    payloadJson,
    payloadSha256: sha256HexUtf8(payloadJson),
    payloadByteLength: new TextEncoder().encode(payloadJson).byteLength,
  };
}

describe('memory over a steered turn', () => {
  it('closes the turn at the request that started the run, with the steer inside it', () => {
    expect(resolveClosedTurnEndingAt(steeredConversation(), 'final')).toMatchObject({
      status: 'resolved',
      user: { id: 'request' },
      steeringUsers: [{ id: 'steer' }],
      sourceStartMessageId: 'request',
      sourceEndMessageId: 'final',
      priorUserMessageId: 'prior-user',
    });
  });

  it('opens a new turn at an unmarked user message', () => {
    const messages = steeredConversation().map(({ steerOfRunId: _steer, ...message }) => message);

    expect(resolveClosedTurnEndingAt(messages, 'final')).toMatchObject({
      status: 'resolved',
      sourceStartMessageId: 'steer',
      priorUserMessageId: 'request',
      steeringUsers: [],
    });
  });

  it('never names a steer as the prior user of the next turn', () => {
    const messages: Message[] = [
      ...steeredConversation(),
      { id: 'next', role: 'user', content: 'Thanks!', timestamp: 8 },
    ];

    expect(resolvePriorUserMessageIdentity(messages, 'next')).toEqual({
      status: 'resolved',
      priorUserMessageId: 'request',
    });
  });

  it('snapshots the steer with its marker, and the snapshot re-resolves to the same turn', () => {
    const snapshot = decodeIngestionSourceSnapshot(encodeSteeredTurn());

    expect(snapshot.turnMessages.map((message) => message.id)).toEqual([
      'request',
      'tool-step',
      'call-1-result',
      'steer',
      'final',
    ]);
    expect(snapshot.turnMessages[3]).toMatchObject({
      role: 'user',
      content: 'Also, my sister Amira is vegetarian.',
      steerOfRunId: 'run-1',
    });
    // Ingestion resolves the closed turn again from the snapshot's own messages.
    expect(resolveClosedTurnEndingAt(snapshot.turnMessages as Message[], 'final')).toMatchObject({
      status: 'resolved',
      sourceStartMessageId: 'request',
      steeringUsers: [{ id: 'steer' }],
    });
  });

  it('keeps the request and the steer at the anchor budget when the cap trims the rest', () => {
    const requestText = 'Plan a dinner for my team. '.repeat(400);
    const steerText = 'Also, my sister Amira is vegetarian. '.repeat(300);
    const bulkyResults: Message[] = Array.from({ length: 40 }, (_unused, index) => ({
      id: `bulk-result-${index}`,
      role: 'tool',
      content: 'r'.repeat(16_000),
      timestamp: 5,
    }));
    const messages = steeredConversation().flatMap((message) =>
      message.id === 'steer'
        ? [...bulkyResults, { ...message, content: steerText }]
        : [message.id === 'request' ? { ...message, content: requestText } : message],
    );
    const snapshot = decodeIngestionSourceSnapshot(encodeSteeredTurn(messages));
    const byId = new Map(snapshot.turnMessages.map((message) => [message.id, message]));

    expect(byId.get('bulk-result-0')?.content.length).toBeLessThan(steerText.length);
    expect(byId.get('request')?.content).toBe(requestText);
    expect(byId.get('steer')?.content).toBe(steerText);
  });

  it('still refuses a new request inside the turn', () => {
    const messages = steeredConversation();
    messages.splice(5, 0, { id: 'other-request', role: 'user', content: 'Hi', timestamp: 5 });

    expect(() => encodeSteeredTurn(messages)).toThrow(
      'memory_ingestion_source_snapshot_order_invalid',
    );
  });

  it('refuses a steer as the source start', () => {
    const messages = steeredConversation().map((message) =>
      message.id === 'request' ? { ...message, steerOfRunId: 'run-0' } : message,
    );

    expect(() => encodeSteeredTurn(messages)).toThrow(
      'memory_ingestion_source_snapshot_source_start_unavailable',
    );
  });

  it('refuses a steer whose run id is not an exact identity', () => {
    const messages = steeredConversation().map((message) =>
      message.id === 'steer' ? { ...message, steerOfRunId: 'run 1' } : message,
    );

    expect(() => encodeSteeredTurn(messages)).toThrow(
      'memory_ingestion_source_snapshot_message_invalid',
    );
  });

  it.each([
    [
      'a marker on a non-user message',
      (turn: Record<string, unknown>[]) => {
        turn[1]!.steerOfRunId = 'run-1';
      },
    ],
    [
      'a marker on the source start',
      (turn: Record<string, unknown>[]) => {
        turn[0]!.steerOfRunId = 'run-1';
      },
    ],
    [
      'an unmarked later user message',
      (turn: Record<string, unknown>[]) => {
        delete turn[3]!.steerOfRunId;
      },
    ],
  ])('rejects a sealed snapshot with %s', (_label, mutate) => {
    const tampered = resealWith(encodeSteeredTurn(), (payload) => mutate(payload.turnMessages));

    expect(() => decodeIngestionSourceSnapshot(tampered)).toThrow();
  });
});
