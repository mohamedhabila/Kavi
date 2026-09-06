// ---------------------------------------------------------------------------
// Tests — memory_* tool executors: subject-filter grapheme safety
// ---------------------------------------------------------------------------

jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import { closeMemoryDb } from '../../src/services/memory/database';
import { ensureFactSchema, resetFactSchemaCacheForTests } from '../../src/services/memory/schema';
import { useSettingsStore } from '../../src/store/useSettingsStore';
import { queryMemoryFactsForManagement } from '../../src/services/memory/memoryTools';
import {
  DEVANAGARI_COMBINING_TEXT,
  SURROGATE_PAIR_EMOJI,
  ZWJ_FAMILY_EMOJI,
  expectGraphemeSafe,
} from '../helpers/graphemeSafetyProbes';

const expoSqlite = require('expo-sqlite') as { __resetExpoSqliteForTests: () => void };

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

describe('queryMemoryFactsForManagement subject grapheme safety', () => {
  it('never splits a grapheme cluster when the 80-char subject cut lands inside a probe', () => {
    const probes = [SURROGATE_PAIR_EMOJI, ZWJ_FAMILY_EMOJI, DEVANAGARI_COMBINING_TEXT];
    for (const probe of probes) {
      const subject = `${'s'.repeat(70)}${probe.repeat(15)}`;
      const result = queryMemoryFactsForManagement({ subject });
      expect(result.ok).toBe(true);
      if (result.ok) expectGraphemeSafe(result.subject ?? '');
    }
  });
});
