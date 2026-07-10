jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import { replaceCurrentFact } from '../../../src/services/memory/facts/exactReplacement';
import { recordFact, setFactLocalSimilarity } from '../../../src/services/memory/facts/mutations';
import { getFactById } from '../../../src/services/memory/facts/queries';
import {
  createCurrentLocalSimilarityVector,
  LOCAL_SIMILARITY_DIMENSIONS,
  LOCAL_SIMILARITY_MODEL,
} from '../../../src/services/memory/localSimilarity';
import {
  ensureFactSchema,
  resetFactSchemaCacheForTests,
} from '../../../src/services/memory/schema';
import { closeMemoryDb, getMemoryDb } from '../../../src/services/memory/sqlite-store';

const expoSqlite = require('expo-sqlite') as { __resetExpoSqliteForTests: () => void };

beforeEach(() => {
  closeMemoryDb();
  expoSqlite.__resetExpoSqliteForTests();
  resetFactSchemaCacheForTests();
  ensureFactSchema();
});

afterEach(() => {
  closeMemoryDb();
});

describe('fact local-similarity persistence', () => {
  it('stores the current vector identity with every new fact', () => {
    const created = recordFact({
      subjectId: 'profile',
      predicate: 'preferred_editor',
      objectText: 'Neovim with Lua',
      scope: 'global',
      now: 10,
    });
    const row = getMemoryDb().getFirstSync<{
      local_similarity_model: string;
      local_similarity_dimensions: number;
      local_similarity_vector: string;
    }>(
      `SELECT local_similarity_model, local_similarity_dimensions, local_similarity_vector
         FROM memory_facts
        WHERE id = ?`,
      created.fact.id,
    );

    expect(created.fact.localSimilarity).toMatchObject({
      model: LOCAL_SIMILARITY_MODEL,
      dimensions: LOCAL_SIMILARITY_DIMENSIONS,
    });
    expect(created.fact.localSimilarity?.values).toHaveLength(LOCAL_SIMILARITY_DIMENSIONS);
    expect(row).toMatchObject({
      local_similarity_model: LOCAL_SIMILARITY_MODEL,
      local_similarity_dimensions: LOCAL_SIMILARITY_DIMENSIONS,
    });
    expect(JSON.parse(row!.local_similarity_vector)).toEqual(created.fact.localSimilarity?.values);
  });

  it('writes a replacement vector from replacement content in the same transaction', () => {
    const current = recordFact({
      subjectId: 'profile',
      predicate: 'preferred_editor',
      objectText: 'Vim',
      scope: 'global',
      now: 10,
    }).fact;
    const replacement = replaceCurrentFact({
      expectedCurrentFactId: current.id,
      subjectId: 'profile',
      predicate: 'preferred_editor',
      objectText: 'Helix',
      scope: 'global',
      now: 20,
    });

    expect(replacement.status).toBe('created');
    if (replacement.status !== 'created') throw new Error('replacement_not_created');
    expect(replacement.fact.localSimilarity).toEqual(
      createCurrentLocalSimilarityVector('preferred_editor\nHelix'),
    );
    expect(replacement.fact.localSimilarity).not.toEqual(current.localSimilarity);
    expect(getFactById(current.id)?.invalidAt).toBe(20);
  });

  it('rejects incompatible identities and malformed values before touching storage', () => {
    const fact = recordFact({
      subjectId: 'profile',
      predicate: 'preferred_editor',
      objectText: 'Neovim',
      scope: 'global',
      now: 10,
    }).fact;
    const current = fact.localSimilarity!;

    expect(() =>
      setFactLocalSimilarity(fact.id, { ...current, model: 'unicode-char-ngram-v2' } as never, 20),
    ).toThrow('memory_local_similarity_model_invalid');
    expect(() =>
      setFactLocalSimilarity(fact.id, { ...current, dimensions: 128 } as never, 20),
    ).toThrow('memory_local_similarity_dimensions_invalid');
    expect(() => setFactLocalSimilarity(fact.id, { ...current, values: [Number.NaN] }, 20)).toThrow(
      'memory_local_similarity_vector_invalid',
    );
    expect(getFactById(fact.id)?.localSimilarity).toEqual(current);
  });

  it('has no fact-level legacy embedding column or read alias', () => {
    const columns = getMemoryDb()
      .getAllSync<{ name: string }>('PRAGMA table_info(memory_facts)')
      .map((column) => column.name);

    expect(columns).toEqual(
      expect.arrayContaining([
        'local_similarity_model',
        'local_similarity_dimensions',
        'local_similarity_vector',
      ]),
    );
    expect(columns).not.toContain('embedding');
  });
});
