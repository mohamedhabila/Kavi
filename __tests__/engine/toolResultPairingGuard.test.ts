// ---------------------------------------------------------------------------
// Tests — Tool Result Pairing Guard
// ---------------------------------------------------------------------------

import {
  extractToolResultId,
  ensureToolResultPairing,
  deduplicateToolResults,
} from '../../src/engine/toolResultPairingGuard';
import type { Message } from '../../src/types/message';

// ── Helpers ──────────────────────────────────────────────────────────────

const makeAssistantMsg = (
  id: string,
  content: string,
  toolCalls?: Array<{ id: string; name: string; arguments: string }>,
): Message => ({
  id,
  role: 'assistant',
  content,
  toolCalls: toolCalls?.map((tc) => ({ ...tc, status: 'completed' as const })),
  timestamp: Date.now(),
});

const makeToolMsg = (
  id: string,
  toolCallId: string,
  content: string,
  isError = false,
): Message => ({
  id,
  role: 'tool',
  content,
  toolCallId,
  toolCalls: [
    {
      id: toolCallId,
      name: 'test_tool',
      arguments: '{}',
      status: isError ? ('failed' as const) : ('completed' as const),
    },
  ],
  timestamp: Date.now(),
  isError,
});

const makeUserMsg = (id: string, content: string): Message => ({
  id,
  role: 'user',
  content,
  timestamp: Date.now(),
});

const makeSystemMsg = (id: string, content: string): Message => ({
  id,
  role: 'system',
  content,
  timestamp: Date.now(),
});

// ── extractToolResultId ──────────────────────────────────────────────────

describe('extractToolResultId', () => {
  it('returns undefined for non-tool messages', () => {
    expect(extractToolResultId(makeUserMsg('u1', 'hi'))).toBeUndefined();
    expect(extractToolResultId(makeAssistantMsg('a1', 'hi'))).toBeUndefined();
  });

  it('extracts toolCallId from tool message', () => {
    const msg = makeToolMsg('t1', 'tc_1', 'result');
    expect(extractToolResultId(msg)).toBe('tc_1');
  });

  it('returns undefined when toolCallId is empty', () => {
    const msg: Message = {
      id: 't1',
      role: 'tool',
      content: 'x',
      toolCallId: '',
      timestamp: Date.now(),
    };
    expect(extractToolResultId(msg)).toBeUndefined();
  });
});

describe('ensureToolResultPairing for running tool calls', () => {
  it('repairs running orphaned tool calls with an in-progress result instead of a failed error', () => {
    const messages: Message[] = [
      {
        ...makeAssistantMsg('a1', '', [
          { id: 'tc_1', name: 'slow_tool', arguments: '{"id":"job-1"}' },
        ]),
        toolCalls: [
          {
            id: 'tc_1',
            name: 'slow_tool',
            arguments: '{"id":"job-1"}',
            status: 'running' as const,
          },
        ],
      },
    ];

    const result = ensureToolResultPairing(messages);
    const synthetic = result.find(
      (message) => message.role === 'tool' && message.toolCallId === 'tc_1',
    );

    expect(synthetic?.isError).toBeUndefined();
    expect(JSON.parse(synthetic?.content || '{}')).toEqual(
      expect.objectContaining({
        status: 'running',
        toolCallId: 'tc_1',
        toolName: 'slow_tool',
      }),
    );
  });
});

// ── ensureToolResultPairing ──────────────────────────────────────────────

describe('ensureToolResultPairing', () => {
  it('returns messages unchanged when no orphans', () => {
    const messages = [
      makeUserMsg('u1', 'hello'),
      makeAssistantMsg('a1', '', [{ id: 'tc_1', name: 'read_file', arguments: '{}' }]),
      makeToolMsg('t1', 'tc_1', 'result'),
    ];
    const result = ensureToolResultPairing(messages);
    expect(result).toHaveLength(3);
    expect(result).toEqual(messages);
  });

  it('inserts synthetic result for orphaned tool call', () => {
    const messages = [
      makeAssistantMsg('a1', '', [
        { id: 'tc_1', name: 'read_file', arguments: '{}' },
        { id: 'tc_2', name: 'write_file', arguments: '{}' },
      ]),
      makeToolMsg('t1', 'tc_1', 'result'),
    ];
    const result = ensureToolResultPairing(messages);
    expect(result).toHaveLength(3);
    // Synthetic result should be inserted after the last tool result
    const synthetic = result[2];
    expect(synthetic.role).toBe('tool');
    expect(synthetic.toolCallId).toBe('tc_2');
    expect(synthetic.isError).toBe(true);
  });

  it('inserts synthetic right after assistant message when no tool results exist', () => {
    const messages = [
      makeAssistantMsg('a1', '', [{ id: 'tc_1', name: 'read_file', arguments: '{}' }]),
      makeUserMsg('u1', 'next message'),
    ];
    const result = ensureToolResultPairing(messages);
    // Should insert synthetic after assistant msg, before user msg
    expect(result.length).toBeGreaterThan(messages.length);
    const syntheticIdx = result.findIndex((m) => m.toolCallId === 'tc_1' && m.isError);
    expect(syntheticIdx).toBeGreaterThan(0);
  });

  it('preserves message order for non-orphaned messages', () => {
    const messages = [
      makeUserMsg('u1', 'hello'),
      makeAssistantMsg('a1', 'response', [{ id: 'tc_1', name: 'tool1', arguments: '{}' }]),
      makeToolMsg('t1', 'tc_1', 'result'),
      makeUserMsg('u2', 'follow up'),
      makeAssistantMsg('a2', 'more'),
    ];
    const result = ensureToolResultPairing(messages);
    expect(result).toEqual(messages);
  });

  it('handles multiple orphans from different assistant messages', () => {
    const messages = [
      makeAssistantMsg('a1', '', [{ id: 'tc_1', name: 'read', arguments: '{}' }]),
      // orphan tc_1
      makeAssistantMsg('a2', '', [{ id: 'tc_2', name: 'search', arguments: '{}' }]),
      // orphan tc_2
    ];
    const result = ensureToolResultPairing(messages);
    const synthetics = result.filter((m) => m.isError && m.id.startsWith('msg_synthetic'));
    expect(synthetics).toHaveLength(2);
    expect(synthetics.map((s) => s.toolCallId).sort()).toEqual(['tc_1', 'tc_2']);
  });

  it('does not attach an orphan from a repeated provider-local id to an earlier paired turn', () => {
    const messages = [
      makeAssistantMsg('a1', '', [{ id: 'gemini-call-0', name: 'read_file', arguments: '{}' }]),
      makeToolMsg('t1', 'gemini-call-0', 'first result'),
      makeAssistantMsg('a2', '', [{ id: 'gemini-call-0', name: 'read_file', arguments: '{}' }]),
    ];
    const result = ensureToolResultPairing(messages);
    const syntheticResults = result.filter(
      (message) => message.role === 'tool' && message.id.startsWith('msg_synthetic'),
    );

    expect(syntheticResults).toHaveLength(1);
    expect(result.indexOf(syntheticResults[0])).toBeGreaterThan(
      result.findIndex((message) => message.id === 'a2'),
    );
    expect(result.filter((message) => message.content === 'first result')).toHaveLength(1);
  });
});

// ── deduplicateToolResults ───────────────────────────────────────────────

describe('deduplicateToolResults', () => {
  it('returns messages unchanged when no duplicates', () => {
    const messages = [
      makeUserMsg('u1', 'hello'),
      makeAssistantMsg('a1', '', [{ id: 'tc_1', name: 'read', arguments: '{}' }]),
      makeToolMsg('t1', 'tc_1', 'result'),
    ];
    const result = deduplicateToolResults(messages);
    expect(result).toHaveLength(3);
  });

  it('removes duplicate tool results, keeping the last one', () => {
    const messages = [
      makeAssistantMsg('a1', '', [{ id: 'tc_1', name: 'read', arguments: '{}' }]),
      makeToolMsg('t1', 'tc_1', 'first result'),
      makeToolMsg('t2', 'tc_1', 'second result'),
    ];
    const result = deduplicateToolResults(messages);
    expect(result).toHaveLength(2); // assistant + one tool msg
    const toolMsg = result.find((m) => m.role === 'tool');
    expect(toolMsg?.content).toBe('second result');
  });

  it('does not deduplicate tool results with different IDs', () => {
    const messages = [makeToolMsg('t1', 'tc_1', 'r1'), makeToolMsg('t2', 'tc_2', 'r2')];
    const result = deduplicateToolResults(messages);
    expect(result).toHaveLength(2);
  });

  it('preserves non-tool messages', () => {
    const messages = [
      makeUserMsg('u1', 'hi'),
      makeAssistantMsg('a1', 'hello'),
      makeSystemMsg('s1', 'warning'),
    ];
    const result = deduplicateToolResults(messages);
    expect(result).toHaveLength(3);
  });

  it('handles three duplicates, keeps last', () => {
    const messages = [
      makeToolMsg('t1', 'tc_1', 'first'),
      makeToolMsg('t2', 'tc_1', 'second'),
      makeToolMsg('t3', 'tc_1', 'third'),
    ];
    const result = deduplicateToolResults(messages);
    expect(result).toHaveLength(1);
    expect(result[0].content).toBe('third');
  });

  it('preserves repeated provider-local tool ids across separate assistant turns', () => {
    const messages = [
      makeAssistantMsg('a1', '', [{ id: 'gemini-call-0', name: 'read_file', arguments: '{}' }]),
      makeToolMsg('t1', 'gemini-call-0', 'first turn result'),
      makeAssistantMsg('a2', '', [{ id: 'gemini-call-0', name: 'text_search', arguments: '{}' }]),
      makeToolMsg('t2', 'gemini-call-0', 'second turn result'),
    ];

    const result = deduplicateToolResults(messages);

    expect(result).toHaveLength(4);
    expect(
      result.filter((message) => message.role === 'tool').map((message) => message.content),
    ).toEqual(['first turn result', 'second turn result']);
  });
});
