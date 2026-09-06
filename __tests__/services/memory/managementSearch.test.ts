jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import { closeMemoryDb } from '../../../src/services/memory/database';
import { upsertEntity } from '../../../src/services/memory/entities';
import { searchMemoryFactsForManagement } from '../../../src/services/memory/facts/managementSearch';
import { recordFact } from '../../../src/services/memory/facts/mutations';
import {
  ensureFactSchema,
  resetFactSchemaCacheForTests,
} from '../../../src/services/memory/schema';
import {
  DEVANAGARI_COMBINING_TEXT,
  SURROGATE_PAIR_EMOJI,
  ZWJ_FAMILY_EMOJI,
  expectGraphemeSafe,
} from '../../helpers/graphemeSafetyProbes';

const expoSqlite = require('expo-sqlite') as { __resetExpoSqliteForTests: () => void };

describe('management memory search', () => {
  beforeEach(() => {
    closeMemoryDb();
    expoSqlite.__resetExpoSqliteForTests();
    resetFactSchemaCacheForTests();
    ensureFactSchema();
  });

  afterEach(() => {
    closeMemoryDb();
    expoSqlite.__resetExpoSqliteForTests();
  });

  it('finds a matching fact older than the first 100 current facts', () => {
    const subject = upsertEntity({ name: 'Archive Project', type: 'project' });
    const target = recordFact({
      subjectId: subject.id,
      predicate: 'archive_marker',
      objectText: 'buried cobalt needle',
      scope: 'global',
      now: 1,
    }).fact;
    for (let index = 0; index < 120; index += 1) {
      recordFact({
        subjectId: subject.id,
        predicate: `recent_note_${index}`,
        objectText: `routine recent value ${index}`,
        scope: 'global',
        now: 10_000 + index,
      });
    }

    const result = searchMemoryFactsForManagement('cobalt', 10);

    expect(result.totalCurrentFacts).toBe(121);
    expect(result.totalMatches).toBe(1);
    expect(result.facts.map((fact) => fact.id)).toEqual([target.id]);
  });

  it('returns a bounded deterministic page with the full match count', () => {
    const subject = upsertEntity({ name: 'Release Project', type: 'project' });
    for (let index = 0; index < 25; index += 1) {
      recordFact({
        subjectId: subject.id,
        predicate: `release_note_${index}`,
        objectText: `shared release marker ${index}`,
        scope: 'global',
        now: index + 1,
      });
    }

    const result = searchMemoryFactsForManagement('release', 7);

    expect(result.totalMatches).toBe(25);
    expect(result.facts).toHaveLength(7);
    expect(result.facts.map((fact) => fact.updatedAt)).toEqual([25, 24, 23, 22, 21, 20, 19]);
  });

  it('can constrain product search to semantic and pinned memories', () => {
    const subject = upsertEntity({ name: 'User', type: 'self' });
    const pinned = recordFact({
      subjectId: subject.id,
      predicate: 'preferred_editor',
      objectText: 'shared marker Nova',
      scope: 'global',
      pinned: true,
      memoryKind: 'semantic_fact',
      now: 1,
    }).fact;
    recordFact({
      subjectId: subject.id,
      predicate: 'secondary_editor',
      objectText: 'shared marker Zed',
      scope: 'global',
      memoryKind: 'semantic_fact',
      now: 2,
    });
    recordFact({
      subjectId: subject.id,
      predicate: 'run_summary',
      objectText: 'shared marker internal',
      scope: 'global',
      pinned: true,
      memoryKind: 'summary',
      now: 3,
    });

    const result = searchMemoryFactsForManagement('shared marker', {
      limit: 10,
      memoryKind: 'semantic_fact',
      pinnedOnly: true,
    });

    expect(result.totalCurrentFacts).toBe(1);
    expect(result.totalMatches).toBe(1);
    expect(result.facts.map((fact) => fact.id)).toEqual([pinned.id]);
  });

  it('never splits a grapheme cluster when the 200-char query cut lands inside a probe', () => {
    const subject = upsertEntity({ name: 'Probe Project', type: 'project' });
    recordFact({
      subjectId: subject.id,
      predicate: 'note',
      objectText: 'unrelated value',
      scope: 'global',
      now: 1,
    });
    const probes = [SURROGATE_PAIR_EMOJI, ZWJ_FAMILY_EMOJI, DEVANAGARI_COMBINING_TEXT];
    for (const probe of probes) {
      const rawQuery = `${'q'.repeat(190)}${probe.repeat(15)}`;
      expect(() => searchMemoryFactsForManagement(rawQuery, 10)).not.toThrow();
      const result = searchMemoryFactsForManagement(rawQuery, 10);
      expectGraphemeSafe(result.query);
    }
  });
});
