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
  type ExtractionMessage,
} from '../../../../src/services/memory/core/memoryExtraction';
import { readCaptureCursor } from '../../../../src/services/memory/core/memoryCaptureCursor';

const expoSqlite = require('expo-sqlite') as { __resetExpoSqliteForTests: () => void };

const conversation: ExtractionMessage[] = [
  { id: 'u1', role: 'user', content: 'My sister Sara moved to Porto last month.', timestamp: 1 },
  { id: 't1', role: 'tool', content: '{"status":"ok"}', timestamp: 2 },
  { id: 'a1', role: 'assistant', content: 'Nice! Porto is lovely.', timestamp: 3 },
  { id: 'u2', role: 'user', content: 'Remind me what she does?', timestamp: 4 },
  { id: 'a2', role: 'assistant', content: 'You have not told me yet.', timestamp: 5 },
];

function readThrough(id: string) {
  const message = conversation.find((candidate) => candidate.id === id)!;
  return { extractedThroughId: id, extractedThroughAt: message.timestamp };
}

function reply(operations: unknown[]): string {
  return JSON.stringify({ operations });
}

function run(
  call: (prompt: string) => Promise<string>,
  signal = new AbortController().signal,
  through = 'a2',
) {
  return extractConversationMemory({
    conversationId: 'conv-1',
    messages: conversation,
    closedThroughMessageId: through,
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
  it('takes the closed user and assistant rounds after the cursor, skipping tool output', () => {
    expect(selectExtractionWindow(conversation, null, 'a2')).toEqual({
      rounds: [
        'User: My sister Sara moved to Porto last month.\nAssistant: Nice! Porto is lovely.',
        'User: Remind me what she does?\nAssistant: You have not told me yet.',
      ],
      userText: 'My sister Sara moved to Porto last month.\nRemind me what she does?',
      lastMessage: conversation[4],
      lastUserMessageId: 'u2',
    });
    expect(selectExtractionWindow(conversation, readThrough('a1'), 'a2')?.rounds).toHaveLength(1);
    expect(selectExtractionWindow(conversation, readThrough('a2'), 'a2')).toBeNull();
  });

  it('stops at the rounds a turn has closed', () => {
    expect(selectExtractionWindow(conversation, null, 'a1')?.lastMessage.id).toBe('a1');
  });

  it('resumes after the cursor time when the message it read is gone', () => {
    const rewound = conversation.filter((message) => message.id !== 'a1');

    expect(
      selectExtractionWindow(rewound, { extractedThroughId: 'a1', extractedThroughAt: 3 }, 'a2')
        ?.rounds,
    ).toEqual(['User: Remind me what she does?\nAssistant: You have not told me yet.']);
  });
});

describe('rounds the assistant managed itself', () => {
  const managed: ExtractionMessage[] = [
    { id: 'u1', role: 'user', content: 'Remember that reviews last 30 minutes.', timestamp: 1 },
    {
      id: 'a1',
      role: 'assistant',
      content: '',
      timestamp: 2,
      toolCalls: [{ name: 'memory_remember' }],
    },
    { id: 't1', role: 'tool', content: '{"ok":true,"status":"saved"}', timestamp: 3 },
    { id: 'a1b', role: 'assistant', content: 'Saved.', timestamp: 4 },
    { id: 'u2', role: 'user', content: 'My sister Sara moved to Porto.', timestamp: 5 },
    { id: 'a2', role: 'assistant', content: 'Porto is lovely.', timestamp: 6 },
  ];

  it('are passed over but read past', () => {
    expect(selectExtractionWindow(managed, null, 'a2')).toEqual({
      rounds: ['User: My sister Sara moved to Porto.\nAssistant: Porto is lovely.'],
      userText: 'My sister Sara moved to Porto.',
      lastMessage: managed[5],
      lastUserMessageId: 'u2',
    });
    expect(selectExtractionWindow(managed, null, 'a1b')).toMatchObject({
      rounds: [],
      lastMessage: managed[3],
      lastUserMessageId: null,
    });
  });

  it('never reach the model, so what the assistant saved stays as it saved it', async () => {
    const saved = addMemoryItem({
      text: 'Design reviews last 45 minutes',
      conversationId: 'conv-1',
      now: 1,
    });
    const id = saved.status === 'created' ? saved.item.id : '';
    const call = jest.fn(async () => reply([{ op: 'update', id, text: 'update' }]));

    await expect(
      extractConversationMemory({
        conversationId: 'conv-1',
        messages: managed,
        closedThroughMessageId: 'a1b',
        call,
        signal: new AbortController().signal,
        now: () => 1_000,
      }),
    ).resolves.toEqual({ kind: 'extracted', added: 0, updated: 0, deleted: 0 });

    expect(call).not.toHaveBeenCalled();
    expect(memories('design reviews')).toEqual(['Design reviews last 45 minutes']);
    expect(readCaptureCursor('conv-1')?.extractedThroughId).toBe('a1b');
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
    ).toEqual([
      { op: 'add', text: 'Sara lives in Porto' },
      { op: 'update', id: 'mem_1', text: 'Sara lives in Lisbon' },
      { op: 'delete', id: 'mem_2' },
    ]);
  });

  it('rejects a reply that is not the operations object', () => {
    expect(() => parseExtractionReply('Sure! Here is what I found')).toThrow(
      'memory_extraction_reply_invalid',
    );
    expect(() => parseExtractionReply('{"ops":[]}')).toThrow('memory_extraction_reply_invalid');
  });

  it('shows the model the stored memories it may update', () => {
    expect(buildExtractionPrompt(['User: hi'], [{ id: 'mem_1', text: 'Likes tea' }])).toContain(
      '- mem_1: Likes tea',
    );
  });

  it('states the shape of an operation, so a model does not put the op name in its text', () => {
    expect(buildExtractionPrompt(['User: hi'], [])).toContain(
      '"text": the memory statement itself (null for delete)',
    );
  });
});

describe('extraction run', () => {
  it('applies the operations and moves past the window', async () => {
    const call = jest.fn(async () =>
      reply([{ op: 'add', id: null, text: 'Sara (the user’s sister) lives in Porto' }]),
    );

    await expect(run(call)).resolves.toEqual({
      kind: 'extracted',
      added: 1,
      updated: 0,
      deleted: 0,
    });
    expect(memories()).toEqual(['Sara (the user’s sister) lives in Porto']);

    await expect(run(call)).resolves.toEqual({ kind: 'idle' });
    expect(call).toHaveBeenCalledTimes(1);
    expect(readCaptureCursor('conv-1')).toMatchObject({
      extractedThroughId: 'a2',
      extractedThroughAt: 5,
      extractionFailures: 0,
    });
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
