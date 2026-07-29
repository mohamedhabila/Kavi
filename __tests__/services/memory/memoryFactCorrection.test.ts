jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import { useSettingsStore } from '../../../src/store/useSettingsStore';
import { closeMemoryDb, getMemoryDb } from '../../../src/services/memory/database';
import { upsertEntity } from '../../../src/services/memory/entities';
import { recordFactWithApplicability } from '../../../src/services/memory/facts/mutations';
import { getFactById, listFacts } from '../../../src/services/memory/facts/queries';
import {
  ensureFactSchema,
  resetFactSchemaCacheForTests,
} from '../../../src/services/memory/schema';
import {
  correctMemoryFactForManagement,
  MAX_MANAGED_MEMORY_FACT_VALUE_LENGTH,
} from '../../../src/services/memory/memoryTools';

const expoSqlite = require('expo-sqlite') as { __resetExpoSqliteForTests: () => void };

function currentFact(overrides: Record<string, unknown> = {}) {
  const subject = upsertEntity({ name: 'user', type: 'self', now: 100 });
  return recordFactWithApplicability(
    {
      subjectId: subject.id,
      predicate: 'preferred_city',
      objectText: 'Amsterdam',
      attributes: { preference: true },
      confidence: 0.91,
      scope: 'conversation',
      originConversationId: 'conversation-1',
      originThreadId: 'thread-1',
      sourceMessageId: 'message-old',
      sourceRunId: 'run-old',
      sourceTurnId: 'turn-old',
      sourceSummary: 'old source',
      importance: 0.82,
      decayPolicy: 'slow',
      pinned: true,
      sourceActorId: 'actor-old',
      retrievability: 0.88,
      stability: 0.77,
      decayRate: 0.02,
      reviewState: 'auto',
      sensitivityFloor: 'normal',
      memoryKind: 'semantic_fact',
      now: 200,
      ...overrides,
    },
    { factClass: 'subjective_user', sourceAuthority: 'assistant_inferred' },
  ).fact;
}

beforeEach(() => {
  closeMemoryDb();
  expoSqlite.__resetExpoSqliteForTests();
  resetFactSchemaCacheForTests();
  useSettingsStore.setState({ disableLongTermMemory: false });
  ensureFactSchema();
});

afterEach(() => {
  useSettingsStore.setState({ disableLongTermMemory: false });
  closeMemoryDb();
});

describe('correctMemoryFactForManagement', () => {
  it('atomically corrects the exact fact while preserving user-controlled memory behavior', () => {
    const old = currentFact();

    const result = correctMemoryFactForManagement({ factId: old.id, value: '  Utrecht  ' });

    expect(result).toMatchObject({
      ok: true,
      status: 'corrected',
      supersededFactId: old.id,
      fact: {
        value: 'Utrecht',
        scope: 'conversation',
        originConversationId: 'conversation-1',
        pinned: true,
        importance: 0.82,
      },
    });
    const history = listFacts({
      subjectId: old.subjectId,
      predicate: old.predicate,
      includeInvalidated: true,
    });
    expect(history).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: old.id,
          objectText: 'Amsterdam',
          invalidAt: expect.any(Number),
        }),
        expect.objectContaining({
          objectText: 'Utrecht',
          attributes: { preference: true },
          confidence: 0.91,
          originThreadId: 'thread-1',
          importance: 0.82,
          decayPolicy: 'slow',
          pinned: true,
          retrievability: 0.88,
          stability: 0.77,
          decayRate: 0.02,
          reviewState: 'verified',
          factClass: 'subjective_user',
          sourceAuthority: 'grounded_user',
          sourceMessageId: null,
          sourceRunId: null,
          sourceTurnId: expect.stringMatching(/^memory_correction_/),
          sourceSummary: null,
          sourceActorId: null,
        }),
      ]),
    );
    const corrected = history.find((fact) => fact.objectText === 'Utrecht');
    expect(
      getMemoryDb().getFirstSync<{ count: number }>(
        'SELECT COUNT(*) AS count FROM memory_fact_contributions WHERE fact_id = ?',
        corrected?.id,
      )?.count,
    ).toBe(1);
  });

  it('treats an exact-value correction as an idempotent verification', () => {
    const fact = currentFact();

    const result = correctMemoryFactForManagement({ factId: fact.id, value: 'Amsterdam' });

    expect(result).toMatchObject({
      ok: true,
      status: 'unchanged',
      supersededFactId: null,
      fact: { id: fact.id, value: 'Amsterdam' },
    });
    expect(listFacts({ subjectId: fact.subjectId, includeInvalidated: true })).toHaveLength(1);
    expect(getFactById(fact.id)).toMatchObject({
      reviewState: 'verified',
      sourceAuthority: 'grounded_user',
    });
  });

  it('rejects stale and non-semantic targets without broadening into an insert', () => {
    const expired = currentFact({ expiresAt: 250 });
    const internal = currentFact({
      predicate: 'run_summary',
      objectText: 'Internal summary',
      memoryKind: 'summary',
      now: 300,
    });

    expect(
      correctMemoryFactForManagement({ factId: expired.id, value: 'Rotterdam' }),
    ).toMatchObject({
      ok: false,
      code: 'not_found',
    });
    expect(correctMemoryFactForManagement({ factId: internal.id, value: 'Changed' })).toMatchObject(
      {
        ok: false,
        code: 'invalid_args',
      },
    );
    expect(getFactById(expired.id)?.objectText).toBe('Amsterdam');
    expect(getFactById(internal.id)?.objectText).toBe('Internal summary');
  });

  it('rejects malformed input and disabled memory before mutation', () => {
    const fact = currentFact();
    const invalidInputs = [
      { factId: '', value: 'Utrecht' },
      { factId: fact.id, value: '   ' },
      { factId: fact.id, value: 'x'.repeat(MAX_MANAGED_MEMORY_FACT_VALUE_LENGTH + 1) },
      { factId: fact.id, value: 'Utrecht', scope: 'global' },
    ];

    for (const input of invalidInputs) {
      expect(correctMemoryFactForManagement(input as never)).toMatchObject({
        ok: false,
        code: 'invalid_args',
      });
    }
    useSettingsStore.setState({ disableLongTermMemory: true });
    expect(correctMemoryFactForManagement({ factId: fact.id, value: 'Utrecht' })).toMatchObject({
      ok: false,
      code: 'memory_disabled',
    });
    expect(getFactById(fact.id)?.objectText).toBe('Amsterdam');
  });

  it('returns a content-free restricted error without invalidating the current fact', () => {
    const fact = currentFact();
    const restrictedValue = `ghp_${'d'.repeat(36)}`;
    const result = correctMemoryFactForManagement({
      factId: fact.id,
      value: restrictedValue,
    });

    expect(result).toEqual({
      status: 'rejected',
      ok: false,
      code: 'restricted',
      error: 'This value cannot be stored in long-term memory.',
    });
    expect(JSON.stringify(result)).not.toContain(restrictedValue);
    expect(getFactById(fact.id)).toMatchObject({ objectText: 'Amsterdam', invalidAt: null });
  });
});
