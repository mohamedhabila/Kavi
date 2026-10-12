jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../../../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import { closeMemoryDb, getMemoryDb } from '../../../../src/services/memory/database';
import { resetMemoryCoreSchemaCacheForTests } from '../../../../src/services/memory/core/memorySchema';
import {
  addMemoryItem,
  deleteMemoryItemsFromConversation,
  forgetMemoryItem,
  getCurrentMemoryItem,
  listPinnedMemoryItems,
  searchMemoryItems,
  setMemoryItemPinned,
} from '../../../../src/services/memory/core/memoryItemsStore';

const expoSqlite = require('expo-sqlite') as { __resetExpoSqliteForTests: () => void };

function remember(text: string, extra: Partial<Parameters<typeof addMemoryItem>[0]> = {}) {
  return addMemoryItem({ text, conversationId: 'conv-1', now: 1_000, ...extra });
}

function search(query: string, includeSensitive = false) {
  return searchMemoryItems({ query, limit: 5, includeSensitive }).map((item) => item.text);
}

beforeEach(() => {
  closeMemoryDb();
  expoSqlite.__resetExpoSqliteForTests();
  resetMemoryCoreSchemaCacheForTests();
});

afterAll(() => {
  closeMemoryDb();
});

describe('memory items', () => {
  it('finds a saved memory by the words of a later request, in any script', () => {
    remember('Sara (the user’s sister) lives in Porto');
    remember('أفضل وقت للاجتماعات هو الصباح الباكر');
    remember('用户最喜欢的咖啡店在阿姆斯特丹');
    remember('De gebruiker houdt van fietsen in het weekend');

    expect(search('Where does my sister Sara live?')).toEqual([
      'Sara (the user’s sister) lives in Porto',
    ]);
    expect(search('متى أفضل وقت للاجتماعات؟')).toEqual(['أفضل وقت للاجتماعات هو الصباح الباكر']);
    expect(search('我最喜欢的咖啡店在哪里')).toEqual(['用户最喜欢的咖啡店在阿姆斯特丹']);
    expect(search('Wat doe ik graag in het weekend?')).toEqual([
      'De gebruiker houdt van fietsen in het weekend',
    ]);
  });

  it('ranks the memory matching more of the request first', () => {
    remember('The meeting room code is E2E-MEET-42');
    remember('The user prefers meetings in the morning');

    expect(search('What is the meeting room code?')[0]).toBe(
      'The meeting room code is E2E-MEET-42',
    );
  });

  it('acknowledges a repeated memory instead of storing it twice', () => {
    const first = remember('Prefers window seats');
    const second = remember('  Prefers window seats  ');

    expect(first.status).toBe('created');
    expect(second).toEqual({
      status: 'duplicate',
      item: expect.objectContaining({ id: (first as { item: { id: string } }).item.id }),
    });
  });

  it('refuses credentials and keeps detected personal data out of automatic recall', () => {
    expect(remember(`My API key is sk-proj-${'c'.repeat(24)}`)).toEqual({
      status: 'restricted',
    });

    const email = remember('Sara’s email is sara@example.com');
    expect(email).toMatchObject({ status: 'created', item: { sensitive: true } });
    expect(search('Sara email')).toEqual([]);
    expect(search('Sara email', true)).toEqual(['Sara’s email is sara@example.com']);
  });

  it('keeps a memory the user marked sensitive out of automatic recall', () => {
    remember('The building door code is 4417', { sensitive: true });

    expect(search('building door code')).toEqual([]);
    expect(search('building door code', true)).toEqual(['The building door code is 4417']);
  });

  it('replaces the memory a correction names and ignores an unknown id', () => {
    const old = remember('Lives in Utrecht');
    const corrected = remember('Lives in Rotterdam', {
      replaces: (old as { item: { id: string } }).item.id,
    });

    expect(corrected).toMatchObject({
      status: 'created',
      replacedId: (old as { item: { id: string } }).item.id,
    });
    expect(search('Where do I live?')).toEqual(['Lives in Rotterdam']);

    expect(remember('Works at the harbor', { replaces: 'mem_unknown' })).toMatchObject({
      status: 'created',
      replacedId: null,
    });
  });

  it('applies a memory to every request, whichever conversation saved it', () => {
    remember('Draft uses the blue palette', { conversationId: 'conv-2' });

    expect(search('blue palette')).toEqual(['Draft uses the blue palette']);
  });

  it('lists pinned memories for every request', () => {
    const name = remember('The user’s name is Mohamed', { pinned: true });
    remember('Likes tea');
    remember('Phone number +31 6 12345678', { pinned: true });

    expect(listPinnedMemoryItems({ limit: 10, includeSensitive: false })).toEqual([
      expect.objectContaining({ text: 'The user’s name is Mohamed' }),
    ]);
    expect(setMemoryItemPinned((name as { item: { id: string } }).item.id, false, 2_000)).toBe(
      true,
    );
    expect(listPinnedMemoryItems({ limit: 10, includeSensitive: false })).toEqual([]);
  });

  it('forgets a memory together with the versions it corrected', () => {
    const old = remember('Lives in Utrecht');
    const current = remember('Lives in Rotterdam', {
      replaces: (old as { item: { id: string } }).item.id,
    });
    const currentId = (current as { item: { id: string } }).item.id;

    expect(forgetMemoryItem(currentId)).toBe(true);
    expect(search('Lives in')).toEqual([]);
    expect(getCurrentMemoryItem(currentId)).toBeNull();
    expect(forgetMemoryItem(currentId)).toBe(false);
  });

  it('deletes what was remembered in a conversation when that conversation is deleted', () => {
    remember('Global fact from conversation one');
    remember('Global fact from conversation two', { conversationId: 'conv-2' });

    expect(deleteMemoryItemsFromConversation('conv-1')).toBe(1);
    expect(search('Global fact')).toEqual(['Global fact from conversation two']);
  });

  it('deletes a correction made in a deleted conversation together with what it replaced', () => {
    const old = remember('Lives in Utrecht');
    remember('Lives in Rotterdam', {
      conversationId: 'conv-2',
      replaces: (old as { item: { id: string } }).item.id,
    });

    expect(deleteMemoryItemsFromConversation('conv-2')).toBe(2);
    expect(
      getMemoryDb().getFirstSync<{ count: number }>('SELECT COUNT(*) AS count FROM memory_items')
        ?.count,
    ).toBe(0);
  });

  it('rejects empty and oversized content', () => {
    expect(remember('   ')).toEqual({ status: 'invalid', reason: 'empty' });
    expect(remember('x'.repeat(2_001))).toEqual({ status: 'invalid', reason: 'too_long' });
  });

  it('measures content in code points, so emoji count once', () => {
    // 1,500 emoji are 3,000 UTF-16 units but 1,500 characters to SQLite and JSON Schema.
    expect(remember(`Mood log ${'😀'.repeat(1_500)}`)).toMatchObject({ status: 'created' });
  });
});
