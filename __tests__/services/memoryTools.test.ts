// ---------------------------------------------------------------------------
// Tests — memory_* tool executors
// ---------------------------------------------------------------------------

jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import { closeMemoryDb, getMemoryDb } from '../../src/services/memory/database';
import { ensureFactSchema, resetFactSchemaCacheForTests } from '../../src/services/memory/schema';
import { findEntityByName } from '../../src/services/memory/entities';
import { listFacts } from '../../src/services/memory/facts/queries';
import { useSettingsStore } from '../../src/store/useSettingsStore';
import {
  queryMemoryFactsForManagement,
  executeMemoryRecall,
  executeMemoryRemember,
  executeMemoryPin,
  executeMemoryUnpin,
  executeMemoryForget,
  executeMemoryInvalidate,
  setMemoryFactPinnedForManagement,
  forgetMemoryFactForManagement,
} from '../../src/services/memory/memoryTools';
import { memoryRememberExecution } from '../helpers/memoryRememberExecution';

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
  useSettingsStore.setState({ disableLongTermMemory: false });
});

afterEach(() => {
  jest.restoreAllMocks();
  closeMemoryDb();
  expoSqlite.__resetExpoSqliteForTests();
  useSettingsStore.setState({ disableLongTermMemory: false });
});

function groundedRequest(
  userMessageId: string,
  userMessageText: string,
  priorUserMessageId?: string,
) {
  return memoryRememberExecution({ userMessageId, userMessageText, priorUserMessageId });
}

function rememberOk(
  args: Parameters<typeof executeMemoryRemember>[0],
  context: Parameters<typeof executeMemoryRemember>[1],
) {
  const result = executeMemoryRemember(args, context);
  if (!result.ok) throw new Error(`expected ok, got ${JSON.stringify(result)}`);
  return result;
}

function explicitOverride(factId: string) {
  return getMemoryDb().getFirstSync<{
    pinned_override: number | null;
    pinned_at: number | null;
    explicit_invalidated_at: number | null;
  }>(
    `SELECT pinned_override, pinned_at, explicit_invalidated_at
       FROM memory_fact_explicit_overrides WHERE fact_id = ? LIMIT 1`,
    factId,
  );
}

describe('executeMemoryRemember', () => {
  it('fails before direct-service writes when long-term memory is disabled', () => {
    useSettingsStore.setState({ disableLongTermMemory: true });

    const result = executeMemoryRemember(
      {
        subject: 'disabled-subject',
        predicate: 'private_value',
        value: 'must-not-persist',
        scope: 'global',
      },
      groundedRequest('user-disabled', 'disabled-subject private value is must-not-persist.'),
    );

    expect(result).toMatchObject({ ok: false, code: 'memory_disabled' });
    expect(findEntityByName('disabled-subject')).toBeNull();
    expect(listFacts()).toEqual([]);
  });

  it('records a new fact and creates the entity', () => {
    const result = rememberOk(
      { subject: 'user', predicate: 'Preferred_Display_Name', value: 'Berlin', scope: 'global' },
      groundedRequest('user-lives-berlin', 'My preferred display name is Berlin.'),
    );
    expect(result.status).toBe('created');
    expect(result.fact.value).toBe('Berlin');
    expect(result.superseded).toEqual([]);
    expect(listFacts()).toEqual([
      expect.objectContaining({ factClass: 'subjective_user', sourceAuthority: 'grounded_user' }),
    ]);
  });

  it('reports duplicate on identical re-record', () => {
    rememberOk(
      { subject: 'user', predicate: 'role', value: 'Berlin', scope: 'global' },
      groundedRequest('user-berlin-first', 'My role is Berlin.'),
    );
    const second = rememberOk(
      {
        subject: 'user',
        predicate: 'role',
        value: 'Berlin',
        scope: 'global',
      },
      groundedRequest('user-berlin', 'My role is Berlin.'),
    );
    expect(second.status).toBe('duplicate');
  });

  it('preserves a mixed-case predicate label through remember and recall', () => {
    const remembered = rememberOk(
      {
        subject: 'user',
        predicate: 'Preferred_Display_Name',
        value: 'Mo',
        scope: 'global',
      },
      groundedRequest('user-display-name', 'My preferred display name is Mo.'),
    );
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
    rememberOk(
      { subject: 'user', predicate: 'role', value: 'Berlin', scope: 'global' },
      groundedRequest('user-residence-berlin', 'My role is Berlin.'),
    );
    const next = rememberOk(
      {
        subject: 'user',
        predicate: 'role',
        value: 'Munich',
        scope: 'global',
      },
      groundedRequest('user-munich', 'My role is Munich.'),
    );

    expect(next.status).toBe('created');
    expect(next.superseded).toEqual([{ id: expect.any(String), invalidAt: expect.any(Number) }]);
    expect(Object.keys(next.superseded[0]).sort()).toEqual(['id', 'invalidAt']);

    const recall = queryMemoryFactsForManagement({ subject: 'user', predicate: 'role' });
    expect(recall.ok).toBe(true);
    if (recall.ok) {
      expect(recall.facts.map((fact) => fact.value)).toEqual(['Munich']);
    }
  });

  it('ignores provider-supplied supersedePrior=false and keeps current state singular', () => {
    rememberOk(
      { subject: 'user', predicate: 'role', value: 'Berlin', scope: 'global' },
      groundedRequest('user-residence-berlin', 'My role is Berlin.'),
    );
    const next = rememberOk(
      {
        subject: 'user',
        predicate: 'role',
        value: 'Munich',
        scope: 'global',
        supersedePrior: false,
      } as Parameters<typeof executeMemoryRemember>[0] & { supersedePrior: false },
      groundedRequest('user-munich', 'My role is Munich.'),
    );

    expect(next.status).toBe('created');
    expect(next.superseded).toEqual([{ id: expect.any(String), invalidAt: expect.any(Number) }]);
    expect(Object.keys(next.superseded[0]).sort()).toEqual(['id', 'invalidAt']);

    const recall = queryMemoryFactsForManagement({ subject: 'user', predicate: 'role' });
    expect(recall.ok).toBe(true);
    if (recall.ok) {
      expect(recall.facts.map((fact) => fact.value)).toEqual(['Munich']);
    }
  });

  it('rejects an ungrounded current-state change without invalidating the prior fact', () => {
    rememberOk(
      { subject: 'user', predicate: 'Preferred_Display_Name', value: 'Berlin', scope: 'global' },
      groundedRequest('user-lives-berlin', 'My preferred display name is Berlin.'),
    );
    const next = executeMemoryRemember(
      { subject: 'user', predicate: 'Preferred_Display_Name', value: 'Munich', scope: 'global' },
      groundedRequest('user-unrelated', 'Please remember something for later.'),
    );
    expect(next).toMatchObject({ ok: false, code: 'grounding_required' });
    expect(
      queryMemoryFactsForManagement({ subject: 'user', predicate: 'Preferred_Display_Name' }),
    ).toMatchObject({ ok: true, facts: [expect.objectContaining({ value: 'Berlin' })] });
  });

  it('rejects laundering a current fact into a different durable scope', () => {
    rememberOk(
      { subject: 'user', predicate: 'Preferred_Display_Name', value: 'Berlin', scope: 'global' },
      groundedRequest('user-global-berlin', 'My preferred display name is Berlin.'),
    );
    const next = executeMemoryRemember(
      {
        subject: 'user',
        predicate: 'Preferred_Display_Name',
        value: 'Munich',
        scope: 'conversation',
        originConversationId: 'conv-1',
        originThreadId: 'thread-1',
      },
      memoryRememberExecution({
        memoryConversationId: 'conv-1',
        sourceThreadId: 'thread-1',
        userMessageId: 'user-conversation-munich',
        userMessageText: 'My preferred display name is Munich.',
      }),
    );

    expect(next).toMatchObject({ ok: false, code: 'grounding_required' });

    const recall = queryMemoryFactsForManagement({
      subject: 'user',
      predicate: 'Preferred_Display_Name',
    });
    expect(recall.ok).toBe(true);
    if (recall.ok) {
      expect(recall.facts.map((fact) => fact.value)).toEqual(['Berlin']);
    }
  });

  it('rejects laundering a task fact into a durable conversation scope', () => {
    rememberOk(
      {
        subject: 'release-task',
        predicate: 'next_step',
        value: 'Run staging validation',
        scope: 'session',
        originConversationId: 'conv-1',
        originThreadId: 'thread-1',
        originTaskId: 'task-1',
      },
      memoryRememberExecution({
        memoryConversationId: 'conv-1',
        sourceThreadId: 'thread-1',
        taskId: 'task-1',
        userMessageId: 'user-staging-next-step',
        userMessageText: 'release-task next_step is Run staging validation.',
      }),
    );
    const next = executeMemoryRemember(
      {
        subject: 'release-task',
        predicate: 'next_step',
        value: 'Run production validation',
        scope: 'conversation',
        originConversationId: 'conv-1',
        originThreadId: 'thread-1',
      },
      memoryRememberExecution({
        memoryConversationId: 'conv-1',
        sourceThreadId: 'thread-1',
        userMessageId: 'user-production-next-step',
        userMessageText: 'release-task next_step is Run production validation.',
      }),
    );

    expect(next).toMatchObject({ ok: false, code: 'grounding_required' });

    const recall = queryMemoryFactsForManagement({
      subject: 'release-task',
      predicate: 'next_step',
    });
    expect(recall.ok).toBe(true);
    if (recall.ok) {
      expect(recall.facts.map((fact) => fact.value)).toEqual(['Run staging validation']);
    }
  });

  it('rejects missing required args', () => {
    const result = executeMemoryRemember(
      { subject: '', predicate: 'p', value: 'v', scope: 'global' } as any,
      groundedRequest('user-invalid-subject', 'My p is v.'),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('invalid_args');
  });

  it('requires code-owned persona identity and serializes the exact binding', () => {
    const missing = executeMemoryRemember(
      { subject: 'user', predicate: 'role', value: 'warm', scope: 'persona' },
      groundedRequest('user-tone-missing-persona', 'My role is warm.'),
    );
    expect(missing).toMatchObject({ ok: false, code: 'invalid_args' });
    expect(findEntityByName('user')).toBeNull();

    const recorded = executeMemoryRemember(
      {
        subject: 'user',
        predicate: 'role',
        value: 'warm',
        scope: 'persona',
      },
      memoryRememberExecution({
        userMessageId: 'user-tone-recorded',
        userMessageText: 'My role is warm.',
        personaId: 'assistant-persona',
      }),
    );
    expect(recorded).toMatchObject({
      ok: true,
      fact: { scope: 'persona', personaId: 'assistant-persona' },
    });
  });

  it('rejects an incomplete session before creating its subject entity', () => {
    const result = executeMemoryRemember(
      {
        subject: 'rejected-session',
        predicate: 'draft_state',
        value: 'open',
        scope: 'session',
        originConversationId: 'conversation-1',
      },
      groundedRequest('user-rejected-session', 'rejected-session draft state is open.'),
    );

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
    rememberOk(
      { subject: 'user', predicate: 'Preferred_Display_Name', value: 'Berlin', scope: 'global' },
      groundedRequest('user-recall-lives', 'My preferred display name is Berlin.'),
    );
    rememberOk(
      { subject: 'user', predicate: 'role', value: 'Engineer', scope: 'global' },
      groundedRequest('user-recall-role', 'My role is Engineer.'),
    );
    const result = queryMemoryFactsForManagement({ subject: 'user' });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.facts).toHaveLength(2);
  });

  it('filters by predicate', () => {
    rememberOk(
      { subject: 'user', predicate: 'Preferred_Display_Name', value: 'Berlin', scope: 'global' },
      groundedRequest('user-filter-lives', 'My preferred display name is Berlin.'),
    );
    rememberOk(
      { subject: 'user', predicate: 'role', value: 'Engineer', scope: 'global' },
      groundedRequest('user-filter-role', 'My role is Engineer.'),
    );
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
    const created = rememberOk(
      { subject: 'user', predicate: 'Preferred_Display_Name', value: 'Berlin', scope: 'global' },
      groundedRequest('user-pin-lives', 'My preferred display name is Berlin.'),
    );
    const actionNow = Date.now() + 1_000;
    jest.spyOn(Date, 'now').mockReturnValue(actionNow);
    const pinned = executeMemoryPin({ factId: created.fact.id }, MEMORY_ACTION_SCOPE);
    expect(pinned.ok).toBe(true);
    if (pinned.ok) expect(pinned.fact.pinned).toBe(true);
    expect(explicitOverride(created.fact.id)).toMatchObject({
      pinned_override: 1,
      pinned_at: actionNow,
    });

    const unpinned = executeMemoryUnpin({ factId: created.fact.id }, MEMORY_ACTION_SCOPE);
    expect(unpinned.ok).toBe(true);
    if (unpinned.ok) expect(unpinned.fact.pinned).toBe(false);
    expect(explicitOverride(created.fact.id)).toMatchObject({
      pinned_override: 0,
      pinned_at: actionNow + 1,
    });
  });

  it('validates arguments before disabled-memory policy and performs no disabled writes', () => {
    const created = rememberOk(
      { subject: 'user', predicate: 'role', value: 'Engineer', scope: 'global' },
      groundedRequest('user-disabled-actions-role', 'My role is Engineer.'),
    );
    useSettingsStore.setState({ disableLongTermMemory: true });

    expect(executeMemoryPin({ factId: ' ' }, MEMORY_ACTION_SCOPE)).toMatchObject({
      ok: false,
      code: 'invalid_args',
    });
    for (const result of [
      executeMemoryPin({ factId: created.fact.id }, MEMORY_ACTION_SCOPE),
      executeMemoryUnpin({ factId: created.fact.id }, MEMORY_ACTION_SCOPE),
      executeMemoryInvalidate({ factId: created.fact.id }, MEMORY_ACTION_SCOPE),
    ]) {
      expect(result).toMatchObject({ ok: false, code: 'memory_disabled' });
    }
    expect(explicitOverride(created.fact.id)).toBeNull();
    expect(
      getMemoryDb().getFirstSync<{ pinned: number; invalid_at: number | null }>(
        'SELECT pinned, invalid_at FROM memory_facts WHERE id = ?',
        created.fact.id,
      ),
    ).toEqual({ pinned: 0, invalid_at: null });
  });

  it('rejects a malformed execution scope before creating explicit intent', () => {
    const created = rememberOk(
      { subject: 'user', predicate: 'role', value: 'Engineer', scope: 'global' },
      groundedRequest('user-invalid-action-scope-role', 'My role is Engineer.'),
    );

    expect(
      executeMemoryPin(
        { factId: created.fact.id },
        { ...MEMORY_ACTION_SCOPE, sourceThreadId: ' thread-request ' },
      ),
    ).toMatchObject({ ok: false, code: 'invalid_args' });
    expect(explicitOverride(created.fact.id)).toBeNull();
  });

  it('returns not_found for unknown id', () => {
    const result = executeMemoryPin({ factId: 'nope' }, MEMORY_ACTION_SCOPE);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('not_found');
  });

  it('keeps whole-vault UI pin management on an explicit non-agent path', () => {
    const created = rememberOk(
      {
        subject: 'ui-project',
        predicate: 'status',
        value: 'ready',
        scope: 'conversation',
        originConversationId: 'other-root',
        originThreadId: 'other-thread',
      },
      memoryRememberExecution({
        memoryConversationId: 'other-root',
        sourceThreadId: 'other-thread',
        userMessageId: 'user-ui-project-ready',
        userMessageText: 'ui-project status is ready.',
      }),
    );

    expect(setMemoryFactPinnedForManagement({ factId: created.fact.id }, true)).toMatchObject({
      ok: true,
      fact: { id: created.fact.id, pinned: true },
    });
  });

  it('rejects a foreign-owner fact from whole-vault pin management', () => {
    const created = rememberOk(
      { subject: 'user', predicate: 'role', value: 'Engineer', scope: 'global' },
      groundedRequest('user-foreign-owner-role', 'My role is Engineer.'),
    );
    getMemoryDb().runSync(
      "UPDATE memory_facts SET memory_owner_id = 'foreign-owner' WHERE id = ?",
      created.fact.id,
    );

    expect(setMemoryFactPinnedForManagement({ factId: created.fact.id }, true)).toMatchObject({
      ok: false,
      code: 'permission_denied',
    });
    expect(explicitOverride(created.fact.id)).toBeNull();
  });
});

describe('executeMemoryForget', () => {
  it('withdraws the fact without echoing its private value', () => {
    const created = rememberOk(
      { subject: 'user', predicate: 'Preferred_Display_Name', value: 'Berlin', scope: 'global' },
      groundedRequest('user-forget-lives', 'My preferred display name is Berlin.'),
    );
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
    const created = rememberOk(
      { subject: 'user', predicate: 'Preferred_Display_Name', value: 'Berlin', scope: 'global' },
      groundedRequest(`user-forget-mode-${mode}`, 'My preferred display name is Berlin.'),
    );
    const result = executeMemoryForget(
      { factId: created.fact.id, mode } as never,
      MEMORY_ACTION_SCOPE,
    );
    expect(result).toEqual(expect.objectContaining({ ok: false, code: 'invalid_args' }));
  });

  it('keeps correction history through the separate invalidation action', () => {
    const created = rememberOk(
      { subject: 'user', predicate: 'Preferred_Display_Name', value: 'Berlin', scope: 'global' },
      groundedRequest('user-invalidate-lives', 'My preferred display name is Berlin.'),
    );
    const firstInvalidatedAt = Date.now() + 1_000;
    const now = jest.spyOn(Date, 'now').mockReturnValue(firstInvalidatedAt);
    const result = executeMemoryInvalidate({ factId: created.fact.id }, MEMORY_ACTION_SCOPE);
    expect(result).toEqual(
      expect.objectContaining({
        ok: true,
        action: 'invalidation',
        factId: created.fact.id,
        status: 'invalidated',
      }),
    );
    now.mockReturnValue(firstInvalidatedAt + 1_000);
    expect(executeMemoryInvalidate({ factId: created.fact.id }, MEMORY_ACTION_SCOPE)).toMatchObject(
      {
        ok: true,
        invalidatedAt: firstInvalidatedAt,
        status: 'invalidated',
      },
    );
    expect(explicitOverride(created.fact.id)).toMatchObject({
      explicit_invalidated_at: firstInvalidatedAt,
    });
    const recall = queryMemoryFactsForManagement({ all: true, includeHistory: true });
    expect(recall.ok).toBe(true);
    if (recall.ok) {
      expect(recall.facts).toEqual([
        expect.objectContaining({ value: 'Berlin', invalidAt: expect.any(Number) }),
      ]);
    }
  });

  it('does not relabel a system-invalidated fact as explicit user intent', () => {
    const created = rememberOk(
      { subject: 'user', predicate: 'role', value: 'Engineer', scope: 'global' },
      groundedRequest('user-system-invalid-role', 'My role is Engineer.'),
    );
    const invalidatedAt = Date.now();
    getMemoryDb().runSync(
      'UPDATE memory_facts SET invalid_at = ?, updated_at = ? WHERE id = ?',
      invalidatedAt,
      invalidatedAt,
      created.fact.id,
    );

    expect(executeMemoryInvalidate({ factId: created.fact.id }, MEMORY_ACTION_SCOPE)).toMatchObject(
      {
        ok: false,
        code: 'not_found',
      },
    );
    expect(explicitOverride(created.fact.id)).toBeNull();
  });

  it('keeps invalidation immediate while advancing logical order past a regressed clock', () => {
    const created = rememberOk(
      { subject: 'user', predicate: 'role', value: 'Engineer', scope: 'global' },
      groundedRequest('user-clock-skew-role', 'My role is Engineer.'),
    );
    const durableNow = Date.now() + 10_000;
    const semanticNow = durableNow - 5_000;
    getMemoryDb().runSync(
      'UPDATE memory_facts SET updated_at = ? WHERE id = ?',
      durableNow,
      created.fact.id,
    );
    const now = jest.spyOn(Date, 'now').mockReturnValue(semanticNow);

    expect(executeMemoryInvalidate({ factId: created.fact.id }, MEMORY_ACTION_SCOPE)).toMatchObject(
      {
        ok: true,
        status: 'invalidated',
        invalidatedAt: semanticNow,
      },
    );
    expect(explicitOverride(created.fact.id)).toMatchObject({
      explicit_invalidated_at: semanticNow,
    });
    expect(
      getMemoryDb().getFirstSync<{ invalid_at: number; updated_at: number }>(
        'SELECT invalid_at, updated_at FROM memory_facts WHERE id = ?',
        created.fact.id,
      ),
    ).toEqual({ invalid_at: semanticNow, updated_at: durableNow });

    now.mockReturnValue(semanticNow - 1_000);
    expect(executeMemoryInvalidate({ factId: created.fact.id }, MEMORY_ACTION_SCOPE)).toMatchObject(
      {
        ok: true,
        status: 'invalidated',
        invalidatedAt: semanticNow,
      },
    );
    const recall = executeMemoryRecall(
      { all: true },
      { ...MEMORY_ACTION_SCOPE, now: semanticNow - 1_000 },
    );
    expect(recall).toMatchObject({ ok: true, facts: [] });
  });

  it('keeps whole-vault UI withdrawal on an explicit non-agent path', () => {
    const created = rememberOk(
      {
        subject: 'ui-private-project',
        predicate: 'private_note',
        value: 'remove-me',
        scope: 'conversation',
        originConversationId: 'other-root',
        originThreadId: 'other-thread',
      },
      memoryRememberExecution({
        memoryConversationId: 'other-root',
        sourceThreadId: 'other-thread',
        userMessageId: 'user-ui-private-note',
        userMessageText: 'ui-private-project private_note is remove-me.',
      }),
    );

    expect(forgetMemoryFactForManagement({ factId: created.fact.id })).toMatchObject({
      ok: true,
      action: 'withdrawal',
      factId: created.fact.id,
    });
  });
});
