jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../../../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import { closeMemoryDb } from '../../../../src/services/memory/database';
import { resetMemoryCoreSchemaCacheForTests } from '../../../../src/services/memory/core/memorySchema';
import {
  addMemoryItem,
  searchMemoryItems,
} from '../../../../src/services/memory/core/memoryItemsStore';
import {
  buildExtractionPrompt,
  extractConversationMemory,
  MAX_EXTRACTION_FAILURES,
  parseExtractionReply,
  selectExtractionWindow,
} from '../../../../src/services/memory/core/memoryExtraction';
import { readCaptureCursor } from '../../../../src/services/memory/core/memoryCaptureCursor';
import {
  indexClosedTurn,
  listMemoryTurnsAfter,
} from '../../../../src/services/memory/core/memoryTurnsStore';
import type { Message } from '../../../../src/types/message';

const expoSqlite = require('expo-sqlite') as { __resetExpoSqliteForTests: () => void };

type ThreadMessage = Pick<Message, 'id' | 'role' | 'content' | 'timestamp' | 'toolCalls'>;

const conversation: ThreadMessage[] = [
  { id: 'u1', role: 'user', content: 'My sister Sara moved to Porto last month.', timestamp: 1 },
  { id: 't1', role: 'tool', content: '{"status":"ok"}', timestamp: 2 },
  { id: 'a1', role: 'assistant', content: 'Nice! Porto is lovely.', timestamp: 3 },
  { id: 'u2', role: 'user', content: 'Remind me what she does?', timestamp: 4 },
  { id: 'a2', role: 'assistant', content: 'You have not told me yet.', timestamp: 5 },
];

/** Indexes the rounds the replies `replyIds` closed, as capture does when each turn closes. */
function indexTurns(messages: ThreadMessage[], replyIds: string[]): void {
  for (const replyMessageId of replyIds) {
    indexClosedTurn({ conversationId: 'conv-1', messages, replyMessageId });
  }
}

function turnsAfter(afterAt: number) {
  return listMemoryTurnsAfter({ conversationId: 'conv-1', afterAt, limit: 4 });
}

function reply(operations: unknown[], focus: string | null = null): string {
  return JSON.stringify({ focus, operations });
}

function run(
  call: (prompt: string) => Promise<string>,
  signal = new AbortController().signal,
  currentFocus: string | null = null,
) {
  return extractConversationMemory({
    conversationId: 'conv-1',
    currentFocus,
    call: (prompt) => call(prompt),
    signal,
    now: () => 1_000,
  });
}

function memories(query = 'Sara Porto'): string[] {
  return searchMemoryItems({ query, limit: 10, includeSensitive: true }).map((item) => item.text);
}

beforeEach(() => {
  closeMemoryDb();
  expoSqlite.__resetExpoSqliteForTests();
  resetMemoryCoreSchemaCacheForTests();
});

afterAll(() => {
  closeMemoryDb();
});

describe('extraction window', () => {
  it('takes the indexed rounds after the cursor, oldest first', () => {
    indexTurns(conversation, ['a1', 'a2']);

    expect(selectExtractionWindow(turnsAfter(0))).toEqual({
      rounds: [
        'User: My sister Sara moved to Porto last month.\nAssistant: Nice! Porto is lovely.',
        'User: Remind me what she does?\nAssistant: You have not told me yet.',
      ],
      userText: 'My sister Sara moved to Porto last month.\nRemind me what she does?',
      throughAt: 5,
      lastUserMessageId: 'u2',
    });
    expect(selectExtractionWindow(turnsAfter(3))?.rounds).toHaveLength(1);
    expect(selectExtractionWindow(turnsAfter(5))).toBeNull();
  });

  it('holds only the rounds indexed so far', () => {
    indexTurns(conversation, ['a1']);

    expect(selectExtractionWindow(turnsAfter(0))?.throughAt).toBe(3);
  });
});

describe('rounds the assistant managed itself', () => {
  const managed: ThreadMessage[] = [
    { id: 'u1', role: 'user', content: 'Remember that reviews last 30 minutes.', timestamp: 1 },
    {
      id: 'a1',
      role: 'assistant',
      content: '',
      timestamp: 2,
      toolCalls: [{ id: 'call-1', name: 'memory_remember', arguments: '{}', status: 'completed' }],
    },
    { id: 't1', role: 'tool', content: '{"ok":true,"status":"saved"}', timestamp: 3 },
    { id: 'a1b', role: 'assistant', content: 'Saved.', timestamp: 4 },
    { id: 'u2', role: 'user', content: 'My sister Sara moved to Porto.', timestamp: 5 },
    { id: 'a2', role: 'assistant', content: 'Porto is lovely.', timestamp: 6 },
  ];

  it('are passed over but read past', () => {
    indexTurns(managed, ['a1b', 'a2']);

    expect(selectExtractionWindow(turnsAfter(0))).toEqual({
      rounds: ['User: My sister Sara moved to Porto.\nAssistant: Porto is lovely.'],
      userText: 'My sister Sara moved to Porto.',
      throughAt: 6,
      lastUserMessageId: 'u2',
    });
    expect(selectExtractionWindow(turnsAfter(0).slice(0, 1))).toEqual({
      rounds: [],
      userText: '',
      throughAt: 4,
      lastUserMessageId: null,
    });
  });

  it('never reach the model, so what the assistant saved stays as it saved it', async () => {
    indexTurns(managed, ['a1b']);
    const saved = addMemoryItem({
      text: 'Design reviews last 45 minutes',
      conversationId: 'conv-1',
      now: 1,
    });
    const id = saved.status === 'created' ? saved.item.id : '';
    const call = jest.fn(async () => reply([{ op: 'update', id, text: 'update' }]));

    await expect(run(call)).resolves.toEqual({
      kind: 'extracted',
      added: 0,
      updated: 0,
      deleted: 0,
      focus: null,
    });

    expect(call).not.toHaveBeenCalled();
    expect(memories('design reviews')).toEqual(['Design reviews last 45 minutes']);
    expect(readCaptureCursor('conv-1')?.extractedThroughAt).toBe(4);
  });
});

describe('extraction reply', () => {
  it('keeps well-formed operations and drops malformed ones', () => {
    expect(
      parseExtractionReply(
        reply([
          { op: 'add', id: null, text: 'Sara lives in Porto' },
          { op: 'update', id: 'mem_1', text: 'Sara lives in Lisbon' },
          { op: 'delete', id: 'mem_2', text: null },
          { op: 'update', id: null, text: 'no id' },
          { op: 'rename', id: 'mem_3', text: 'x' },
        ]),
      ),
    ).toEqual({
      operations: [
        { op: 'add', text: 'Sara lives in Porto' },
        { op: 'update', id: 'mem_1', text: 'Sara lives in Lisbon' },
        { op: 'delete', id: 'mem_2' },
      ],
      focus: null,
    });
  });

  it('reads a new focus, keeping its words and dropping stray whitespace', () => {
    expect(parseExtractionReply(reply([], '  Porto   apartment\nsearch ')).focus).toBe(
      'Porto apartment search',
    );
    expect(parseExtractionReply(reply([], 'بحث عن شقة')).focus).toBe('بحث عن شقة');
  });

  it('keeps the current focus when the reply names none', () => {
    expect(parseExtractionReply(reply([], null)).focus).toBeNull();
    expect(parseExtractionReply(reply([], '   ')).focus).toBeNull();
    expect(parseExtractionReply(JSON.stringify({ operations: [] })).focus).toBeNull();
  });

  it('bounds a focus a model wrote at length', () => {
    const focus = parseExtractionReply(reply([], 'word '.repeat(40))).focus ?? '';
    expect(focus.length).toBeLessThanOrEqual(60);
    expect(focus.startsWith('word word')).toBe(true);
  });

  it('rejects a reply that is not the operations object', () => {
    expect(() => parseExtractionReply('Sure! Here is what I found')).toThrow(
      'memory_extraction_reply_invalid',
    );
    expect(() => parseExtractionReply('{"ops":[]}')).toThrow('memory_extraction_reply_invalid');
  });

  it('shows the model the stored memories it may update', () => {
    expect(
      buildExtractionPrompt(['User: hi'], [{ id: 'mem_1', text: 'Likes tea' }], null),
    ).toContain('- mem_1: Likes tea');
  });

  it('states the shape of an operation, so a model does not put the op name in its text', () => {
    expect(buildExtractionPrompt(['User: hi'], [], null)).toContain(
      '"text": the memory statement itself (null for delete)',
    );
  });

  it('shows the current focus, so the model keeps it unless the subject moved on', () => {
    expect(buildExtractionPrompt(['User: hi'], [], 'Porto apartment search')).toContain(
      'Current focus of the conversation: Porto apartment search',
    );
    expect(buildExtractionPrompt(['User: hi'], [], null)).toContain(
      'Current focus of the conversation: (none)',
    );
  });
});

describe('extraction run', () => {
  beforeEach(() => {
    indexTurns(conversation, ['a1', 'a2']);
  });

  it('applies the operations and moves past the window', async () => {
    const call = jest.fn(async () =>
      reply([{ op: 'add', id: null, text: 'Sara (the user’s sister) lives in Porto' }]),
    );

    await expect(run(call)).resolves.toEqual({
      kind: 'extracted',
      added: 1,
      updated: 0,
      deleted: 0,
      focus: null,
    });
    expect(memories()).toEqual(['Sara (the user’s sister) lives in Porto']);

    await expect(run(call)).resolves.toEqual({ kind: 'idle' });
    expect(call).toHaveBeenCalledTimes(1);
    expect(readCaptureCursor('conv-1')).toMatchObject({
      extractedThroughAt: 5,
      extractionFailures: 0,
    });
  });

  // Extraction can run long after the rounds; dating a memory by the run told the model a
  // fact from last week was said today.
  it('dates a memory by when it was said, not when extraction ran', async () => {
    await run(async () =>
      reply([{ op: 'add', id: null, text: 'Sara (the user’s sister) lives in Porto' }]),
    );

    const [item] = searchMemoryItems({ query: 'Sara Porto', limit: 1, includeSensitive: true });
    // The window's rounds closed at 5; the run happened at 1_000.
    expect(item).toMatchObject({ createdAt: 5, updatedAt: 5 });
    expect(readCaptureCursor('conv-1')?.extractedThroughAt).toBe(5);
  });

  it('names the focus the conversation moved to', async () => {
    await expect(
      run(
        async (prompt) => {
          expect(prompt).toContain('Current focus of the conversation: Weekend plans');
          return reply([], 'Family news');
        },
        new AbortController().signal,
        'Weekend plans',
      ),
    ).resolves.toMatchObject({ kind: 'extracted', focus: 'Family news' });
  });

  it('updates a stored memory the conversation changed', async () => {
    const stored = addMemoryItem({
      text: 'Sara lives in Lisbon',
      conversationId: 'conv-1',
      now: 1,
    });
    const id = stored.status === 'created' ? stored.item.id : '';

    await run(async (prompt) => {
      expect(prompt).toContain(`- ${id}: Sara lives in Lisbon`);
      return reply([{ op: 'update', id, text: 'Sara lives in Porto' }]);
    });

    expect(memories('Sara lives')).toEqual(['Sara lives in Porto']);
  });

  it('never lets extraction rewrite a memory the user pinned', async () => {
    const stored = addMemoryItem({
      text: 'Sara lives in Lisbon',
      conversationId: 'conv-1',
      pinned: true,
      now: 1,
    });
    const id = stored.status === 'created' ? stored.item.id : '';

    await expect(run(async () => reply([{ op: 'delete', id, text: null }]))).resolves.toMatchObject(
      { kind: 'extracted', deleted: 0 },
    );
    expect(memories('Sara lives')).toEqual(['Sara lives in Lisbon']);
  });

  it('does not count a run the foreground preempted', async () => {
    const controller = new AbortController();
    const call = async () => {
      controller.abort();
      throw new Error('aborted');
    };

    for (let attempt = 0; attempt < MAX_EXTRACTION_FAILURES + 2; attempt += 1) {
      await expect(run(call, controller.signal)).resolves.toEqual({ kind: 'preempted' });
    }
    await expect(
      run(async () => reply([{ op: 'add', id: null, text: 'Sara lives in Porto' }])),
    ).resolves.toMatchObject({ kind: 'extracted', added: 1 });
  });

  it('skips a window after repeated real failures so later turns are not blocked', async () => {
    const failing = async () => 'not json';

    for (let attempt = 1; attempt < MAX_EXTRACTION_FAILURES; attempt += 1) {
      await expect(run(failing)).resolves.toEqual({ kind: 'failed', failures: attempt });
    }
    await expect(run(failing)).resolves.toEqual({ kind: 'skipped' });
    await expect(run(failing)).resolves.toEqual({ kind: 'idle' });
  });
});
