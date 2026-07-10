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
import { findEntityByName } from '../../src/services/memory/entities';
import {
  queryMemoryFactsForManagement,
  executeMemoryRemember,
  executeMemoryPin,
  executeMemoryUnpin,
  executeMemoryForget,
  executeMemoryInvalidate,
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
    const result = rememberOk({
      subject: 'user',
      predicate: 'lives_in',
      value: 'Berlin',
      scope: 'global',
    });
    expect(result.status).toBe('created');
    expect(result.fact.value).toBe('Berlin');
    expect(result.superseded).toEqual([]);
  });

  it('reports duplicate on identical re-record', () => {
    rememberOk({ subject: 'user', predicate: 'lives_in', value: 'Berlin', scope: 'global' });
    const second = rememberOk({
      subject: 'user',
      predicate: 'lives_in',
      value: 'Berlin',
      scope: 'global',
    });
    expect(second.status).toBe('duplicate');
  });

  it('preserves a mixed-case predicate label through remember and recall', () => {
    const remembered = rememberOk({
      subject: 'user',
      predicate: 'Preferred_Display_Name',
      value: 'Mo',
      scope: 'global',
    });
    expect(remembered.fact.predicate).toBe('Preferred_Display_Name');

    const recall = queryMemoryFactsForManagement({
      subject: 'user',
      predicate: 'Preferred_Display_Name',
    });
    expect(recall.ok).toBe(true);
    if (recall.ok) {
      expect(recall.facts).toEqual([
        expect.objectContaining({ predicate: 'Preferred_Display_Name', value: 'Mo' }),
      ]);
    }
  });

  it('supersedes prior fact by default for the same subject and predicate', () => {
    rememberOk({ subject: 'user', predicate: 'lives_in', value: 'Berlin', scope: 'global' });
    const next = rememberOk({
      subject: 'user',
      predicate: 'lives_in',
      value: 'Munich',
      scope: 'global',
    });

    expect(next.status).toBe('created');
    expect(next.superseded).toHaveLength(1);
    expect(next.superseded[0].value).toBe('Berlin');

    const recall = queryMemoryFactsForManagement({ subject: 'user', predicate: 'lives_in' });
    expect(recall.ok).toBe(true);
    if (recall.ok) {
      expect(recall.facts.map((fact) => fact.value)).toEqual(['Munich']);
    }
  });

  it('ignores provider-supplied supersedePrior=false and keeps current state singular', () => {
    rememberOk({ subject: 'user', predicate: 'lives_in', value: 'Berlin', scope: 'global' });
    const next = rememberOk({
      subject: 'user',
      predicate: 'lives_in',
      value: 'Munich',
      scope: 'global',
      supersedePrior: false,
    } as Parameters<typeof executeMemoryRemember>[0] & { supersedePrior: false });

    expect(next.status).toBe('created');
    expect(next.superseded).toHaveLength(1);
    expect(next.superseded[0].value).toBe('Berlin');

    const recall = queryMemoryFactsForManagement({ subject: 'user', predicate: 'lives_in' });
    expect(recall.ok).toBe(true);
    if (recall.ok) {
      expect(recall.facts.map((fact) => fact.value)).toEqual(['Munich']);
    }
  });

  it('supersedes prior fact on current-state updates', () => {
    rememberOk({ subject: 'user', predicate: 'lives_in', value: 'Berlin', scope: 'global' });
    const next = rememberOk({
      subject: 'user',
      predicate: 'lives_in',
      value: 'Munich',
      scope: 'global',
    });
    expect(next.status).toBe('created');
    expect(next.superseded).toHaveLength(1);
    expect(next.superseded[0].value).toBe('Berlin');
  });

  it('keeps durable scopes isolated during supersession', () => {
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
    expect(next.superseded).toEqual([]);

    const recall = queryMemoryFactsForManagement({ subject: 'user', predicate: 'lives_in' });
    expect(recall.ok).toBe(true);
    if (recall.ok) {
      expect(recall.facts.map((fact) => fact.value).sort()).toEqual(['Berlin', 'Munich']);
    }
  });

  it('keeps session-scoped task facts isolated from durable supersession', () => {
    rememberOk({
      subject: 'release-task',
      predicate: 'next_step',
      value: 'Run staging validation',
      scope: 'session',
      originConversationId: 'conv-1',
      originThreadId: 'thread-1',
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

    const recall = queryMemoryFactsForManagement({
      subject: 'release-task',
      predicate: 'next_step',
    });
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
      scope: 'global',
    } as any);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('invalid_args');
  });

  it('requires code-owned persona identity and serializes the exact binding', () => {
    const missing = executeMemoryRemember({
      subject: 'user',
      predicate: 'assistant_tone',
      value: 'warm',
      scope: 'persona',
    });
    expect(missing).toMatchObject({ ok: false, code: 'invalid_args' });
    expect(findEntityByName('user')).toBeNull();

    const recorded = executeMemoryRemember(
      {
        subject: 'user',
        predicate: 'assistant_tone',
        value: 'warm',
        scope: 'persona',
      },
      { personaId: 'assistant-persona' },
    );
    expect(recorded).toMatchObject({
      ok: true,
      fact: { scope: 'persona', personaId: 'assistant-persona' },
    });
  });

  it('rejects an incomplete session before creating its subject entity', () => {
    const result = executeMemoryRemember({
      subject: 'rejected-session',
      predicate: 'draft_state',
      value: 'open',
      scope: 'session',
      originConversationId: 'conversation-1',
    });

    expect(result).toMatchObject({ ok: false, code: 'invalid_args' });
    expect(findEntityByName('rejected-session')).toBeNull();
  });
});

describe('executeMemoryRecall', () => {
  it('returns empty facts for unknown subject (not error)', () => {
    const result = queryMemoryFactsForManagement({ subject: 'ghost' });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.facts).toEqual([]);
  });

  it('lists facts for a known subject', () => {
    rememberOk({ subject: 'user', predicate: 'lives_in', value: 'Berlin', scope: 'global' });
    rememberOk({ subject: 'user', predicate: 'role', value: 'Engineer', scope: 'global' });
    const result = queryMemoryFactsForManagement({ subject: 'user' });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.facts).toHaveLength(2);
  });

  it('filters by predicate', () => {
    rememberOk({ subject: 'user', predicate: 'lives_in', value: 'Berlin', scope: 'global' });
    rememberOk({ subject: 'user', predicate: 'role', value: 'Engineer', scope: 'global' });
    const result = queryMemoryFactsForManagement({ subject: 'user', predicate: 'role' });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.facts).toHaveLength(1);
      expect(result.facts[0].predicate).toBe('role');
    }
  });

  it('rejects empty filter set', () => {
    const result = queryMemoryFactsForManagement({});
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('invalid_args');
  });
});

describe('executeMemoryPin / executeMemoryUnpin', () => {
  it('pins then unpins an existing fact', () => {
    const created = rememberOk({
      subject: 'user',
      predicate: 'lives_in',
      value: 'Berlin',
      scope: 'global',
    });
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
  it('withdraws the fact without echoing its private value', () => {
    const created = rememberOk({
      subject: 'user',
      predicate: 'lives_in',
      value: 'Berlin',
      scope: 'global',
    });
    const forgotten = executeMemoryForget({ factId: created.fact.id });
    expect(forgotten.ok).toBe(true);
    if (forgotten.ok) {
      expect(forgotten.action).toBe('withdrawal');
      expect(forgotten.receipt.status).toBe('withdrawn');
      expect(forgotten.receipt.factId).toBe(created.fact.id);
      expect(JSON.stringify(forgotten)).not.toContain('Berlin');
    }
    const recall = queryMemoryFactsForManagement({ all: true, includeHistory: true });
    if (recall.ok) expect(recall.facts).toHaveLength(0);
  });

  it.each(['delete', 'invalidate'])('rejects the removed mode=%s contract', (mode) => {
    const created = rememberOk({
      subject: 'user',
      predicate: 'lives_in',
      value: 'Berlin',
      scope: 'global',
    });
    const result = executeMemoryForget({ factId: created.fact.id, mode } as never);
    expect(result).toEqual(expect.objectContaining({ ok: false, code: 'invalid_args' }));
  });

  it('keeps correction history through the separate invalidation action', () => {
    const created = rememberOk({
      subject: 'user',
      predicate: 'lives_in',
      value: 'Berlin',
      scope: 'global',
    });
    const result = executeMemoryInvalidate({ factId: created.fact.id });
    expect(result).toEqual(
      expect.objectContaining({
        ok: true,
        action: 'invalidation',
        factId: created.fact.id,
        status: 'invalidated',
      }),
    );
    const recall = queryMemoryFactsForManagement({ all: true, includeHistory: true });
    expect(recall.ok).toBe(true);
    if (recall.ok) {
      expect(recall.facts).toEqual([
        expect.objectContaining({ value: 'Berlin', invalidAt: expect.any(Number) }),
      ]);
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
