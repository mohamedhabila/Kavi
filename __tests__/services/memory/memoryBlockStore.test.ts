jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import {
  BlockOverflowError,
  clearBlock,
  DEFAULT_MEMORY_BLOCKS,
  editBlock,
  ensureDefaultBlocks,
  getBlock,
  listBlocks,
  upsertBlock,
} from '../../../src/services/memory/blocks';
import {
  ensureFactSchema,
  resetFactSchemaCacheForTests,
} from '../../../src/services/memory/schema';
import { closeMemoryDb } from '../../../src/services/memory/database';

const expoSqlite = require('expo-sqlite') as { __resetExpoSqliteForTests: () => void };

beforeEach(() => {
  closeMemoryDb();
  expoSqlite.__resetExpoSqliteForTests();
  resetFactSchemaCacheForTests();
  ensureFactSchema();
});

describe('memory blocks', () => {
  it('ensureDefaultBlocks creates the catalog idempotently', () => {
    ensureDefaultBlocks();
    const labels = listBlocks()
      .map((b) => b.label)
      .sort();
    expect(labels).toEqual([...DEFAULT_MEMORY_BLOCKS.map((d) => d.label)].sort());
    ensureDefaultBlocks();
    expect(listBlocks()).toHaveLength(DEFAULT_MEMORY_BLOCKS.length);
  });

  it('editBlock appends with a newline by default and respects char_limit', () => {
    ensureDefaultBlocks();
    const first = editBlock('active_focus', 'Drafting RFC');
    expect(first.content).toBe('Drafting RFC');
    const second = editBlock('active_focus', 'reviewed by Alice');
    expect(second.content).toBe('Drafting RFC\nreviewed by Alice');
  });

  it('editBlock with replace=true overwrites content', () => {
    ensureDefaultBlocks();
    editBlock('active_focus', 'old');
    const replaced = editBlock('active_focus', 'new', { replace: true });
    expect(replaced.content).toBe('new');
  });

  it('editBlock throws BlockOverflowError when exceeding char_limit', () => {
    ensureDefaultBlocks();
    const block = getBlock('active_focus')!;
    const oversized = 'x'.repeat(block.charLimit + 1);
    expect(() => editBlock('active_focus', oversized, { replace: true })).toThrow(
      BlockOverflowError,
    );
  });

  it('editBlock throws on unknown block label', () => {
    expect(() => editBlock('nonexistent', 'hi')).toThrow(/not found/);
  });

  it('upsertBlock creates a custom block then updates it', () => {
    upsertBlock({
      label: 'goals',
      content: 'ship single thread',
      charLimit: 200,
      description: 'top-of-mind goals',
      pinned: true,
      personaId: null,
    });
    expect(getBlock('goals')?.content).toBe('ship single thread');
    upsertBlock({
      label: 'goals',
      content: 'ship single thread + memory',
      charLimit: 200,
      description: 'top-of-mind goals',
      pinned: true,
      personaId: null,
    });
    expect(getBlock('goals')?.content).toBe('ship single thread + memory');
  });

  it('clearBlock empties the content but leaves the row', () => {
    ensureDefaultBlocks();
    editBlock('open_threads', 'follow up with Bob');
    expect(getBlock('open_threads')?.content).not.toBe('');
    expect(clearBlock('open_threads')).toBe(true);
    expect(getBlock('open_threads')?.content).toBe('');
  });

  it('listBlocks returns pinned blocks first', () => {
    ensureDefaultBlocks();
    const list = listBlocks();
    const pinnedFirst = list.findIndex((b) => !b.pinned);
    const lastPinned = [...list].reverse().findIndex((b) => b.pinned);
    expect(pinnedFirst).toBeGreaterThanOrEqual(0);
    const idxOfFirstUnpinned = list.findIndex((b) => !b.pinned);
    if (idxOfFirstUnpinned >= 0) {
      for (let index = idxOfFirstUnpinned; index < list.length; index += 1) {
        expect(list[index].pinned).toBe(false);
      }
    }
    expect(lastPinned).toBeGreaterThanOrEqual(0);
  });
});
