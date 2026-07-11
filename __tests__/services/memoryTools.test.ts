// ---------------------------------------------------------------------------
// Tests — memory_* tool executors
// ---------------------------------------------------------------------------

jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import { closeMemoryDb } from '../../src/services/memory/database';
import { ensureFactSchema, resetFactSchemaCacheForTests } from '../../src/services/memory/schema';
import { ensureDefaultBlocks } from '../../src/services/memory/blocks';
import { findEntityByName } from '../../src/services/memory/entities';
import { listFacts } from '../../src/services/memory/facts/queries';
import { useSettingsStore } from '../../src/store/useSettingsStore';
import {
  queryMemoryFactsForManagement,
  executeMemoryRemember,
  executeMemoryPin,
  executeMemoryUnpin,
  executeMemoryForget,
  executeMemoryInvalidate,
  setMemoryFactPinnedForManagement,
  forgetMemoryFactForManagement,
  executeMemoryBlockRead,
  executeMemoryBlockEdit,
} from '../../src/services/memory/memoryTools';

const expoSqlite = require('expo-sqlite') as { __resetExpoSqliteForTests: () => void };

const MEMORY_ACTION_SCOPE = {
  memoryConversationId: 'conversation-request',
  sourceThreadId: 'thread-request',
  personaId: 'default',
  taskId: null,
} as const;

beforeEach(() => {
  closeMemoryDb();
  expoSqlite.__resetExpoSqliteForTests();
  resetFactSchemaCacheForTests();
  ensureFactSchema();
  ensureDefaultBlocks();
  useSettingsStore.setState({ disableLongTermMemory: false });
});

afterEach(() => {
  closeMemoryDb();
  expoSqlite.__resetExpoSqliteForTests();
  useSettingsStore.setState({ disableLongTermMemory: false });
});

function groundedRequest(userMessageId: string, userMessageText: string) {
  return {
    requestEvidence: {
      memoryConversationId: 'conversation-request',
      sourceThreadId: 'thread-request',
      taskId: null,
      userMessageId,
      userMessageText,
    },
  };
}

function rememberOk(
  args: Parameters<typeof executeMemoryRemember>[0],
  context?: Parameters<typeof executeMemoryRemember>[1],
) {
  const result = executeMemoryRemember(args, context);
  if (!result.ok) throw new Error(`expected ok, got ${JSON.stringify(result)}`);
  return result;
}

describe('executeMemoryRemember', () => {
  it('fails before direct-service writes when long-term memory is disabled', () => {
    useSettingsStore.setState({ disableLongTermMemory: true });

    const result = executeMemoryRemember({
      subject: 'disabled-subject',
      predicate: 'private_value',
      value: 'must-not-persist',
      scope: 'global',
    });

    expect(result).toMatchObject({ ok: false, code: 'memory_disabled' });
    expect(findEntityByName('disabled-subject')).toBeNull();
    expect(listFacts()).toEqual([]);
  });

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
    expect(listFacts()).toEqual([
      expect.objectContaining({ factClass: 'unknown', sourceAuthority: 'assistant_inferred' }),
    ]);
  });

  it('reports duplicate on identical re-record', () => {
    rememberOk({ subject: 'user', predicate: 'lives_in', value: 'Berlin', scope: 'global' });
    const second = rememberOk(
      {
        subject: 'user',
        predicate: 'lives_in',
        value: 'Berlin',
        scope: 'global',
      },
      groundedRequest('user-berlin', 'I live in Berlin.'),
    );
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

  it('supersedes an exact prior fact only from grounded current-user evidence', () => {
    rememberOk({ subject: 'user', predicate: 'lives_in', value: 'Berlin', scope: 'global' });
    const next = rememberOk(
      {
        subject: 'user',
        predicate: 'lives_in',
        value: 'Munich',
        scope: 'global',
      },
      groundedRequest('user-munich', 'I live in Munich.'),
    );

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
    const next = rememberOk(
      {
        subject: 'user',
        predicate: 'lives_in',
        value: 'Munich',
        scope: 'global',
        supersedePrior: false,
      } as Parameters<typeof executeMemoryRemember>[0] & { supersedePrior: false },
      groundedRequest('user-munich', 'I live in Munich.'),
    );

    expect(next.status).toBe('created');
    expect(next.superseded).toHaveLength(1);
    expect(next.superseded[0].value).toBe('Berlin');

    const recall = queryMemoryFactsForManagement({ subject: 'user', predicate: 'lives_in' });
    expect(recall.ok).toBe(true);
    if (recall.ok) {
      expect(recall.facts.map((fact) => fact.value)).toEqual(['Munich']);
    }
  });

  it('rejects an ungrounded current-state change without invalidating the prior fact', () => {
    rememberOk({ subject: 'user', predicate: 'lives_in', value: 'Berlin', scope: 'global' });
    const next = executeMemoryRemember({
      subject: 'user',
      predicate: 'lives_in',
      value: 'Munich',
      scope: 'global',
    });
    expect(next).toMatchObject({ ok: false, code: 'grounding_required' });
    expect(queryMemoryFactsForManagement({ subject: 'user', predicate: 'lives_in' })).toMatchObject(
      { ok: true, facts: [expect.objectContaining({ value: 'Berlin' })] },
    );
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
    const pinned = executeMemoryPin({ factId: created.fact.id }, MEMORY_ACTION_SCOPE);
    expect(pinned.ok).toBe(true);
    if (pinned.ok) expect(pinned.fact.pinned).toBe(true);

    const unpinned = executeMemoryUnpin({ factId: created.fact.id }, MEMORY_ACTION_SCOPE);
    expect(unpinned.ok).toBe(true);
    if (unpinned.ok) expect(unpinned.fact.pinned).toBe(false);
  });

  it('returns not_found for unknown id', () => {
    const result = executeMemoryPin({ factId: 'nope' }, MEMORY_ACTION_SCOPE);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('not_found');
  });

  it('keeps whole-vault UI pin management on an explicit non-agent path', () => {
    const created = rememberOk({
      subject: 'ui-project',
      predicate: 'status',
      value: 'ready',
      scope: 'conversation',
      originConversationId: 'other-root',
      originThreadId: 'other-thread',
    });

    expect(setMemoryFactPinnedForManagement({ factId: created.fact.id }, true)).toMatchObject({
      ok: true,
      fact: { id: created.fact.id, pinned: true },
    });
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
    const forgotten = executeMemoryForget({ factId: created.fact.id }, MEMORY_ACTION_SCOPE);
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
    const result = executeMemoryForget(
      { factId: created.fact.id, mode } as never,
      MEMORY_ACTION_SCOPE,
    );
    expect(result).toEqual(expect.objectContaining({ ok: false, code: 'invalid_args' }));
  });

  it('keeps correction history through the separate invalidation action', () => {
    const created = rememberOk({
      subject: 'user',
      predicate: 'lives_in',
      value: 'Berlin',
      scope: 'global',
    });
    const result = executeMemoryInvalidate({ factId: created.fact.id }, MEMORY_ACTION_SCOPE);
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

  it('keeps whole-vault UI withdrawal on an explicit non-agent path', () => {
    const created = rememberOk({
      subject: 'ui-private-project',
      predicate: 'secret',
      value: 'remove-me',
      scope: 'conversation',
      originConversationId: 'other-root',
      originThreadId: 'other-thread',
    });

    expect(forgetMemoryFactForManagement({ factId: created.fact.id })).toMatchObject({
      ok: true,
      action: 'withdrawal',
      factId: created.fact.id,
    });
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
