jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import { memoryRememberArgs, memoryRememberExecution } from '../../helpers/memoryRememberExecution';
import { closeMemoryDb, getMemoryDb } from '../../../src/services/memory/database';
import { findEntityByName } from '../../../src/services/memory/entities';
import { listFacts } from '../../../src/services/memory/facts/queries';
import { executeMemoryRemember } from '../../../src/services/memory/memoryTools';
import {
  ensureFactSchema,
  resetFactSchemaCacheForTests,
} from '../../../src/services/memory/schema';
import { useSettingsStore } from '../../../src/store/useSettingsStore';

const expoSqlite = require('expo-sqlite') as { __resetExpoSqliteForTests: () => void };

function rememberDisplayName(input: {
  value: string;
  userMessageId: string;
  claimedAt: number;
  pinned?: boolean;
}) {
  const userMessageText = `表示名の主体🧑は${input.value}`;
  return executeMemoryRemember(
    memoryRememberArgs({
      userMessageText,
      subjectRef: { kind: 'self' },
      predicate: 'preferred display name',
      value: input.value,
      scope: 'global',
      operation: input.claimedAt === 100 || input.claimedAt === 200 ? 'record' : 'replace_current',
      ...(input.pinned !== undefined ? { pinned: input.pinned } : {}),
    }),
    memoryRememberExecution({
      userMessageId: input.userMessageId,
      userMessageText,
      claimedAt: input.claimedAt,
    }),
  );
}

function replacementPinnedIntent(successorFactId: string): number | null {
  return (
    getMemoryDb().getFirstSync<{ pinned_input_explicit: number }>(
      `SELECT pinned_input_explicit
         FROM memory_fact_contribution_supersession_snapshots
        WHERE successor_fact_id = ?`,
      successorFactId,
    )?.pinned_input_explicit ?? null
  );
}

beforeEach(() => {
  closeMemoryDb();
  expoSqlite.__resetExpoSqliteForTests();
  resetFactSchemaCacheForTests();
  ensureFactSchema();
  useSettingsStore.setState({ disableLongTermMemory: false });
});

afterEach(() => {
  closeMemoryDb();
  expoSqlite.__resetExpoSqliteForTests();
  useSettingsStore.setState({ disableLongTermMemory: false });
});

describe('memory_remember pinned input', () => {
  it('preserves omission so a replacement inherits the current pin', () => {
    expect(
      rememberDisplayName({
        value: 'Mo',
        userMessageId: 'user-display-name-mo',
        claimedAt: 100,
        pinned: true,
      }),
    ).toMatchObject({ ok: true, fact: { pinned: true } });

    const replacement = rememberDisplayName({
      value: 'Mina',
      userMessageId: 'user-display-name-mina',
      claimedAt: 101,
    });

    expect(replacement).toMatchObject({ ok: true, fact: { pinned: true } });
    expect(replacementPinnedIntent(replacement.ok ? replacement.fact.id : '')).toBe(0);
  });

  it('preserves explicit false so a replacement can clear the inherited pin', () => {
    expect(
      rememberDisplayName({
        value: 'Mo',
        userMessageId: 'user-display-name-mo',
        claimedAt: 200,
        pinned: true,
      }),
    ).toMatchObject({ ok: true, fact: { pinned: true } });

    const replacement = rememberDisplayName({
      value: 'Mina',
      userMessageId: 'user-display-name-mina',
      claimedAt: 201,
      pinned: false,
    });

    expect(replacement).toMatchObject({ ok: true, fact: { pinned: false } });
    expect(replacementPinnedIntent(replacement.ok ? replacement.fact.id : '')).toBe(1);
  });

  it('rejects a provided non-boolean pin before writing memory state', () => {
    const userMessageText = 'malformed-pin-subject status ready';
    const malformed = memoryRememberArgs({
      userMessageText,
      subjectRef: { kind: 'named', label: 'malformed-pin-subject' },
      predicate: 'status',
      value: 'ready',
      scope: 'global',
    }) as unknown as { pinned: string };
    malformed.pinned = 'false';
    const result = executeMemoryRemember(
      malformed as unknown as Parameters<typeof executeMemoryRemember>[0],
      memoryRememberExecution({
        userMessageId: 'user-malformed-pin',
        userMessageText,
        claimedAt: 300,
      }),
    );

    expect(result).toMatchObject({
      ok: false,
      code: 'invalid_args',
      error: 'pinned must be a boolean',
    });
    expect(findEntityByName('malformed-pin-subject')).toBeNull();
    expect(listFacts()).toEqual([]);
    expect(
      getMemoryDb().getFirstSync<{ count: number }>(
        'SELECT COUNT(*) AS count FROM memory_fact_contributions',
      ),
    ).toEqual({ count: 0 });
  });
});
