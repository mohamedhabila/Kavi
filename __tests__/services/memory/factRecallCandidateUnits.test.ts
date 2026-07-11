jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import { runMemoryStatement } from '../../../src/services/memory/access/crud';
import { selectIndexedRecallLexicalUnits } from '../../../src/services/memory/factRecallCandidateUnits';
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

afterEach(() => {
  closeMemoryDb();
  expoSqlite.__resetExpoSqliteForTests();
});

function insertUnitStat(unit: string, factCount: number): void {
  runMemoryStatement(
    `INSERT INTO memory_fact_term_stats(unit, memory_kind, fact_count, total_weight)
       VALUES (?, 'agent_run', ?, ?)`,
    unit,
    factCount,
    factCount,
  );
}

describe('selectIndexedRecallLexicalUnits', () => {
  it('keeps long indexed recall fanout bounded to the most discriminative units', () => {
    const units = Array.from({ length: 30 }, (_, index) => `qrecall${index}`);
    units.forEach((unit, index) => insertUnitStat(unit, 1_000 - index));

    const selected = selectIndexedRecallLexicalUnits(units, []);

    expect(selected).toHaveLength(24);
    expect(selected).toEqual(units.slice(6).reverse());
    expect(selected).not.toContain('qrecall0');
    expect(selected).not.toContain('qrecall5');
  });

  it('preserves explicit anchors before applying corpus-frequency ranking', () => {
    const units = Array.from({ length: 30 }, (_, index) => `qanchor${index}`);
    units.forEach((unit, index) => insertUnitStat(unit, index === 0 ? 50_000 : index + 1));

    const selected = selectIndexedRecallLexicalUnits(units, ['qanchor0']);

    expect(selected).toHaveLength(24);
    expect(selected[0]).toBe('qanchor0');
    expect(selected).toContain('qanchor1');
    expect(selected).not.toContain('qanchor29');
  });
});
