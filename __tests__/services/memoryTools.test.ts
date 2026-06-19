// ---------------------------------------------------------------------------
// Tests — memory_* tool executors
// ---------------------------------------------------------------------------

jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import { closeMemoryDb } from '../../src/services/memory/sqlite-store';
import { ensureFactSchema, resetFactSchemaCacheForTests } from '../../src/services/memory/schema';
import { ensureDefaultBlocks } from '../../src/services/memory/blocks';
import {
  executeMemoryRecall,
  executeMemoryRemember,
  executeMemoryPin,
  executeMemoryUnpin,
  executeMemoryForget,
  executeMemoryBlockRead,
  executeMemoryBlockEdit,
} from '../../src/services/memory/memoryTools';

const expoSqlite = require('expo-sqlite') as { __resetExpoSqliteForTests: () => void };

beforeEach(() => {
  closeMemoryDb();
  expoSqlite.__resetExpoSqliteForTests();
  resetFactSchemaCacheForTests();
  ensureFactSchema();
  ensureDefaultBlocks();
});

afterEach(() => {
  closeMemoryDb();
  expoSqlite.__resetExpoSqliteForTests();
});

function rememberOk(args: Parameters<typeof executeMemoryRemember>[0]) {
  const result = executeMemoryRemember(args);
  if (!result.ok) throw new Error(`expected ok, got ${JSON.stringify(result)}`);
  return result;
}

describe('executeMemoryRemember', () => {
  it('records a new fact and creates the entity', () => {
    const result = rememberOk({ subject: 'user', predicate: 'lives_in', value: 'Berlin' });
    expect(result.status).toBe('created');
    expect(result.fact.value).toBe('Berlin');
    expect(result.superseded).toEqual([]);
  });

  it('reports duplicate on identical re-record', () => {
    rememberOk({ subject: 'user', predicate: 'lives_in', value: 'Berlin' });
    const second = rememberOk({ subject: 'user', predicate: 'lives_in', value: 'Berlin' });
    expect(second.status).toBe('duplicate');
  });

  it('supersedes prior fact by default for the same subject and predicate', () => {
    rememberOk({ subject: 'user', predicate: 'lives_in', value: 'Berlin' });
    const next = rememberOk({
      subject: 'user',
      predicate: 'lives_in',
      value: 'Munich',
    });

    expect(next.status).toBe('created');
    expect(next.superseded).toHaveLength(1);
    expect(next.superseded[0].value).toBe('Berlin');

    const recall = executeMemoryRecall({ subject: 'user', predicate: 'lives_in' });
    expect(recall.ok).toBe(true);
    if (recall.ok) {
      expect(recall.facts.map((fact) => fact.value)).toEqual(['Munich']);
    }
  });

  it('ignores provider-supplied supersedePrior=false and keeps current state singular', () => {
    rememberOk({ subject: 'user', predicate: 'lives_in', value: 'Berlin' });
    const next = rememberOk({
      subject: 'user',
      predicate: 'lives_in',
      value: 'Munich',
      supersedePrior: false,
    } as Parameters<typeof executeMemoryRemember>[0] & { supersedePrior: false });

    expect(next.status).toBe('created');
    expect(next.superseded).toHaveLength(1);
    expect(next.superseded[0].value).toBe('Berlin');

    const recall = executeMemoryRecall({ subject: 'user', predicate: 'lives_in' });
    expect(recall.ok).toBe(true);
    if (recall.ok) {
      expect(recall.facts.map((fact) => fact.value)).toEqual(['Munich']);
    }
  });

  it('supersedes prior fact on current-state updates', () => {
    rememberOk({ subject: 'user', predicate: 'lives_in', value: 'Berlin' });
    const next = rememberOk({
      subject: 'user',
      predicate: 'lives_in',
      value: 'Munich',
    });
    expect(next.status).toBe('created');
    expect(next.superseded).toHaveLength(1);
    expect(next.superseded[0].value).toBe('Berlin');
  });

  it('supersedes prior durable facts across provider-selected non-session scopes', () => {
    rememberOk({
      subject: 'user',
      predicate: 'lives_in',
      value: 'Berlin',
      scope: 'global',
    });
    const next = rememberOk({
      subject: 'user',
      predicate: 'lives_in',
      value: 'Munich',
      scope: 'conversation',
      originConversationId: 'conv-1',
    });

    expect(next.status).toBe('created');
    expect(next.superseded.map((fact) => fact.value)).toEqual(['Berlin']);

    const recall = executeMemoryRecall({ subject: 'user', predicate: 'lives_in' });
    expect(recall.ok).toBe(true);
    if (recall.ok) {
      expect(recall.facts.map((fact) => fact.value)).toEqual(['Munich']);
    }
  });

  it('keeps session-scoped task facts isolated from durable supersession', () => {
    rememberOk({
      subject: 'release-task',
      predicate: 'next_step',
      value: 'Run staging validation',
      scope: 'session',
      originConversationId: 'conv-1',
      originTaskId: 'task-1',
    });
    const next = rememberOk({
      subject: 'release-task',
      predicate: 'next_step',
      value: 'Run production validation',
      scope: 'conversation',
      originConversationId: 'conv-1',
    });

    expect(next.status).toBe('created');
    expect(next.superseded).toEqual([]);

    const recall = executeMemoryRecall({ subject: 'release-task', predicate: 'next_step' });
    expect(recall.ok).toBe(true);
    if (recall.ok) {
      expect(recall.facts.map((fact) => fact.value).sort()).toEqual([
        'Run production validation',
        'Run staging validation',
      ]);
    }
  });

  it('rejects missing required args', () => {
    const result = executeMemoryRemember({
      subject: '',
      predicate: 'p',
      value: 'v',
    } as any);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('invalid_args');
  });
});

describe('executeMemoryRecall', () => {
  it('returns empty facts for unknown subject (not error)', () => {
    const result = executeMemoryRecall({ subject: 'ghost' });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.facts).toEqual([]);
  });

  it('lists facts for a known subject', () => {
    rememberOk({ subject: 'user', predicate: 'lives_in', value: 'Berlin' });
    rememberOk({ subject: 'user', predicate: 'role', value: 'Engineer' });
    const result = executeMemoryRecall({ subject: 'user' });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.facts).toHaveLength(2);
  });

  it('filters by predicate', () => {
    rememberOk({ subject: 'user', predicate: 'lives_in', value: 'Berlin' });
    rememberOk({ subject: 'user', predicate: 'role', value: 'Engineer' });
    const result = executeMemoryRecall({ subject: 'user', predicate: 'role' });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.facts).toHaveLength(1);
      expect(result.facts[0].predicate).toBe('role');
    }
  });

  it('rejects empty filter set', () => {
    const result = executeMemoryRecall({});
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('invalid_args');
  });
});

describe('executeMemoryPin / executeMemoryUnpin', () => {
  it('pins then unpins an existing fact', () => {
    const created = rememberOk({ subject: 'user', predicate: 'lives_in', value: 'Berlin' });
    const pinned = executeMemoryPin({ factId: created.fact.id });
    expect(pinned.ok).toBe(true);
    if (pinned.ok) expect(pinned.fact.pinned).toBe(true);

    const unpinned = executeMemoryUnpin({ factId: created.fact.id });
    expect(unpinned.ok).toBe(true);
    if (unpinned.ok) expect(unpinned.fact.pinned).toBe(false);
  });

  it('returns not_found for unknown id', () => {
    const result = executeMemoryPin({ factId: 'nope' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('not_found');
  });
});

describe('executeMemoryForget', () => {
  it('soft-deletes by default and the fact disappears from default recall', () => {
    const created = rememberOk({ subject: 'user', predicate: 'lives_in', value: 'Berlin' });
    const forgotten = executeMemoryForget({ factId: created.fact.id });
    expect(forgotten.ok).toBe(true);
    if (forgotten.ok) {
      expect(forgotten.mode).toBe('delete');
      expect(forgotten.fact.deletedAt).toBeGreaterThan(0);
    }
    const recall = executeMemoryRecall({ subject: 'user' });
    if (recall.ok) expect(recall.facts).toHaveLength(0);
  });

  it('invalidates without deleting when mode=invalidate', () => {
    const created = rememberOk({ subject: 'user', predicate: 'lives_in', value: 'Berlin' });
    const result = executeMemoryForget({ factId: created.fact.id, mode: 'invalidate' });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.mode).toBe('invalidate');
      expect(result.fact.invalidAt).toBeGreaterThan(0);
      expect(result.fact.deletedAt).toBeNull();
    }
  });
});

describe('executeMemoryBlockRead / executeMemoryBlockEdit', () => {
  it('lists all default blocks when no label given', () => {
    const result = executeMemoryBlockRead({});
    expect(result.ok).toBe(true);
    if (result.ok) {
      const labels = result.blocks.map((b) => b.label);
      expect(labels).toEqual(expect.arrayContaining(['profile', 'persona', 'active_focus']));
    }
  });

  it('returns unknown_block for missing label', () => {
    const result = executeMemoryBlockRead({ label: 'does_not_exist' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('unknown_block');
  });

  it('replaces block content by default', () => {
    const result = executeMemoryBlockEdit({ label: 'profile', content: 'Name: Mo' });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.block.content).toBe('Name: Mo');

    const reread = executeMemoryBlockRead({ label: 'profile' });
    if (reread.ok) expect(reread.blocks[0].content).toBe('Name: Mo');
  });

  it('appends with newline when replace=false', () => {
    executeMemoryBlockEdit({ label: 'open_threads', content: 'find a SIM card' });
    executeMemoryBlockEdit({
      label: 'open_threads',
      content: 'register address',
      replace: false,
    });
    const result = executeMemoryBlockRead({ label: 'open_threads' });
    if (result.ok) {
      expect(result.blocks[0].content).toBe('find a SIM card\nregister address');
    }
  });

  it('returns block_overflow when content exceeds limit', () => {
    const long = 'x'.repeat(5000);
    const result = executeMemoryBlockEdit({ label: 'profile', content: long });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('block_overflow');
  });

  it('returns invalid_args when content is missing', () => {
    const result = executeMemoryBlockEdit({ label: 'profile' } as any);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('invalid_args');
  });
});
