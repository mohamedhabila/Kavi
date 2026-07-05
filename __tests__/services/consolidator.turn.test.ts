// ---------------------------------------------------------------------------
// Tests — Memory consolidator turn orchestration
// ---------------------------------------------------------------------------

jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import { getBlock, ensureDefaultBlocks } from '../../src/services/memory/blocks';
import {
  consolidateTurn,
  type ConsolidatorExtractor,
} from '../../src/services/memory/consolidator';
import { findEntityByName } from '../../src/services/memory/entities';
import { ensureFactSchema, resetFactSchemaCacheForTests } from '../../src/services/memory/schema';
import { closeMemoryDb } from '../../src/services/memory/sqlite-store';

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

describe('consolidateTurn', () => {
  const buildExtractor = (payload: unknown): ConsolidatorExtractor =>
    jest.fn().mockResolvedValue(JSON.stringify(payload));

  it('runs end-to-end and persists by default', async () => {
    const extractor = buildExtractor({
      new_facts: [{ subject: 'user', predicate: 'has_name', value: 'Mo' }],
      active_focus: 'Saying hello.',
      open_threads: [],
      notable: [],
    });
    const result = await consolidateTurn(
      {
        userMessage: 'My name is Mo.',
        assistantMessage: 'Nice to meet you, Mo.',
        now: 42,
      },
      { extractor },
    );
    expect(result.newFacts).toHaveLength(1);
    expect(getBlock('active_focus')?.content).toBe('Saying hello.');
  });

  it('skips persistence when persist=false', async () => {
    const extractor = buildExtractor({
      new_facts: [{ subject: 'user', predicate: 'has_name', value: 'Mo' }],
      active_focus: 'noop',
      open_threads: [],
      notable: [],
    });
    const result = await consolidateTurn(
      { userMessage: 'hi', assistantMessage: 'hi back' },
      { extractor, persist: false },
    );
    expect(result.newFacts).toHaveLength(1);
    const userEntity = findEntityByName('user');
    expect(userEntity).toBeNull();
    expect(getBlock('active_focus')?.content).toBe('');
  });

  it('propagates extractor failures so callers can retry the turn', async () => {
    const extractor: ConsolidatorExtractor = () => Promise.reject(new Error('network'));
    await expect(
      consolidateTurn({ userMessage: 'hi', assistantMessage: 'hi back' }, { extractor }),
    ).rejects.toThrow('network');
  });
});
