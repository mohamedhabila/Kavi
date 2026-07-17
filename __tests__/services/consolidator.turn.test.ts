// ---------------------------------------------------------------------------
// Tests — Memory consolidator turn orchestration
// ---------------------------------------------------------------------------

jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import {
  consolidateTurn,
  type ConsolidatorExtractor,
  UnsupportedConsolidatorResponseError,
} from '../../src/services/memory/consolidator';
import { findEntityByName } from '../../src/services/memory/entities';
import { ensureFactSchema, resetFactSchemaCacheForTests } from '../../src/services/memory/schema';
import { closeMemoryDb } from '../../src/services/memory/database';
import { getWorkingBlock } from '../../src/services/memory/workingBlocks';

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

describe('consolidateTurn', () => {
  const buildExtractor = (payload: unknown): ConsolidatorExtractor =>
    jest.fn().mockResolvedValue(JSON.stringify(payload));

  it('extracts a valid result without writing memory state', async () => {
    const extractor = buildExtractor({
      episode_sensitivity: 'personal',
      episode_summary: null,
      new_facts: [
        {
          version: 1,
          subject_ref: { kind: 'self' },
          predicate: 'has_name',
          value: 'Mo',
          scope: 'global',
          importance: 0.8,
          confidence: 0.95,
          source_message_id: 'user-current',
          operation: 'record',
          assertion_class: 'current_direct',
          evidence_quote: 'My name is Mo.',
          sensitivity: 'personal',
        },
      ],
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
    expect(result.status).toBe('valid');
    if (result.status !== 'valid') throw new Error('expected valid outcome');
    expect(result.result.newFacts).toHaveLength(1);
    const userEntity = findEntityByName('user');
    expect(userEntity).toBeNull();
    expect(
      getWorkingBlock('active_focus', {
        conversationId: 'conv-no-persist',
        threadId: 'thread-no-persist',
      }),
    ).toBeNull();
  });

  it('returns a provider error outcome so callers can retry the turn', async () => {
    const extractor: ConsolidatorExtractor = () => Promise.reject(new Error('network'));
    await expect(
      consolidateTurn(
        {
          userMessage: 'hi',
          assistantMessage: 'hi back',
        },
        { extractor },
      ),
    ).resolves.toEqual({ status: 'provider_error', code: 'provider_request_failed' });
  });

  it('distinguishes unsupported provider response shapes', async () => {
    const extractor: ConsolidatorExtractor = () =>
      Promise.reject(new UnsupportedConsolidatorResponseError());
    await expect(
      consolidateTurn(
        {
          userMessage: 'hi',
          assistantMessage: 'hi back',
        },
        { extractor },
      ),
    ).resolves.toEqual({ status: 'provider_error', code: 'unsupported_response_shape' });
  });
});
