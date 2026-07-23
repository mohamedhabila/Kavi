jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import { closeMemoryDb } from '../../../src/services/memory/database';
import { upsertEntity } from '../../../src/services/memory/entities';
import { recordFactWithApplicability } from '../../../src/services/memory/facts/mutations';
import { queryMemoryFactsForManagement } from '../../../src/services/memory/memoryTools';
import {
  ensureFactSchema,
  resetFactSchemaCacheForTests,
} from '../../../src/services/memory/schema';

const expoSqlite = require('expo-sqlite') as { __resetExpoSqliteForTests: () => void };

function recordMemory(predicate: string, value: string, now: number) {
  const subject = upsertEntity({ name: 'user', type: 'self', now });
  return recordFactWithApplicability(
    {
      subjectId: subject.id,
      predicate,
      objectText: value,
      scope: 'global',
      sensitivityFloor: 'normal',
      memoryKind: 'semantic_fact',
      now,
    },
    { factClass: 'subjective_user', sourceAuthority: 'grounded_user' },
  ).fact;
}

beforeEach(() => {
  closeMemoryDb();
  expoSqlite.__resetExpoSqliteForTests();
  resetFactSchemaCacheForTests();
  ensureFactSchema();
});

afterEach(() => {
  closeMemoryDb();
});

describe('memory management query search', () => {
  it('finds a remembered value through the screen-facing query boundary', () => {
    recordMemory('role', 'Reliability Engineer', 1);
    recordMemory('city', 'Utrecht', 2);

    const result = queryMemoryFactsForManagement({
      search: 'reliability',
      memoryKind: 'semantic_fact',
      limit: 10,
    });

    expect(result).toMatchObject({
      ok: true,
      subject: null,
      facts: [expect.objectContaining({ predicate: 'role', value: 'Reliability Engineer' })],
    });
  });

  it('rejects ambiguous search and exact-filter combinations', () => {
    recordMemory('role', 'Reliability Engineer', 1);

    expect(
      queryMemoryFactsForManagement({ search: 'reliability', subject: 'user' }),
    ).toMatchObject({ ok: false, code: 'invalid_args' });
  });
});
