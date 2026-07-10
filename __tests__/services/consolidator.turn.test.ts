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
import { closeMemoryDb } from '../../src/services/memory/sqlite-store';
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

  it('runs end-to-end and persists by default', async () => {
    const extractor = buildExtractor({
      episode_summary: null,
      new_facts: [{ subject: 'user', predicate: 'has_name', value: 'Mo' }],
      active_focus: 'Saying hello.',
      open_threads: [],
      notable: [],
    });
    const result = await consolidateTurn(
      {
        userMessage: 'My name is Mo.',
        assistantMessage: 'Nice to meet you, Mo.',
        conversationId: 'conv-persist',
        threadId: 'thread-persist',
        episodeAccess: { personaId: 'default', shareability: 'thread_only' },
        now: 42,
      },
      { extractor },
    );
    expect(result.status).toBe('valid');
    if (result.status !== 'valid') throw new Error('expected valid outcome');
    expect(result.result.newFacts).toHaveLength(1);
    expect(
      getWorkingBlock('active_focus', {
        conversationId: 'conv-persist',
        threadId: 'thread-persist',
      })?.content,
    ).toBe('Saying hello.');
  });

  it('skips persistence when persist=false', async () => {
    const extractor = buildExtractor({
      episode_summary: null,
      new_facts: [{ subject: 'user', predicate: 'has_name', value: 'Mo' }],
      active_focus: 'noop',
      open_threads: [],
      notable: [],
    });
    const result = await consolidateTurn(
      {
        userMessage: 'hi',
        assistantMessage: 'hi back',
        conversationId: 'conv-no-persist',
        threadId: 'thread-no-persist',
      },
      { extractor, persist: false },
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
          conversationId: 'conv-provider-error',
          threadId: 'thread-provider-error',
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
          conversationId: 'conv-shape-error',
          threadId: 'thread-shape-error',
        },
        { extractor },
      ),
    ).resolves.toEqual({ status: 'provider_error', code: 'unsupported_response_shape' });
  });
});
