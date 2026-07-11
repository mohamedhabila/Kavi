jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import { ensureDefaultBlocks } from '../../../src/services/memory/blocks';
import { upsertEntity } from '../../../src/services/memory/entities';
import { recordFactWithApplicability } from '../../../src/services/memory/facts/mutations';
import { getFactById } from '../../../src/services/memory/facts/queries';
import { buildLivingMemorySections } from '../../../src/services/memory/livingMemoryBridge';
import * as llmFactSelector from '../../../src/services/memory/llmFactSelector';
import { readRecentMemoryRetrievalEvents } from '../../../src/services/memory/retrievalLog';
import {
  ensureFactSchema,
  resetFactSchemaCacheForTests,
} from '../../../src/services/memory/schema';
import { closeMemoryDb, getMemoryDb } from '../../../src/services/memory/sqlite-store';
import * as sqliteStore from '../../../src/services/memory/sqlite-store';
import type { Message } from '../../../src/types/message';
import { useSettingsStore } from '../../../src/store/useSettingsStore';
import { initializeMemoryPolicyObservation } from '../../../src/services/memory/policy';

const expoSqlite = require('expo-sqlite') as { __resetExpoSqliteForTests: () => void };

function userMessage(content: string, timestamp: number): Message {
  return { id: `u-${timestamp}`, role: 'user', content, timestamp } as Message;
}

beforeEach(() => {
  closeMemoryDb();
  expoSqlite.__resetExpoSqliteForTests();
  resetFactSchemaCacheForTests();
  ensureFactSchema();
  ensureDefaultBlocks();
  useSettingsStore.setState({ disableLongTermMemory: false } as never);
  initializeMemoryPolicyObservation();
});

afterEach(() => {
  useSettingsStore.setState({ disableLongTermMemory: false } as never);
  closeMemoryDb();
  jest.restoreAllMocks();
});

describe('living memory structured retrieval evidence', () => {
  it('keeps deterministic facts when semantic selection fails and records the fallback', async () => {
    const project = upsertEntity({ name: 'selector resilience', type: 'project' });
    const fact = recordFactWithApplicability(
      {
        subjectId: project.id,
        predicate: 'decision',
        objectText: 'selector resilience keeps deterministic retrieval evidence',
        scope: 'global',
        importance: 0.9,
        now: 500,
      },
      { factClass: 'workflow', sourceAuthority: 'tool_observed' },
    );
    jest.spyOn(llmFactSelector, 'createLlmMemoryFactSelector').mockReturnValue(async () => {
      throw new Error('private selector provider failure');
    });

    const out = await buildLivingMemorySections({
      messages: [userMessage('selector resilience deterministic evidence', 1_000)],
      conversationId: 'memory-selector-fallback',
      sourceThreadId: 'thread-selector-fallback',
      personaId: 'default',
      taskId: null,
      now: 2_000,
      retrievalLlm: { provider: {} as never },
      consistencyBarrier: {
        outcome: 'completed',
        durationMs: 4,
        waitedMs: 4,
        queryCount: 2,
        matchedJobCount: 1,
        queueAgeMs: 20,
        initialJobStatus: 'pending',
        finalJobStatus: 'completed_structural',
      },
    });

    expect(out.recalledFactCount).toBeGreaterThan(0);
    expect(out.retrievalEvent).toMatchObject({ status: 'recorded', code: 'recorded' });
    expect(readRecentMemoryRetrievalEvents()[0]).toMatchObject({
      outcome: 'completed',
      counts: { selectedFactIds: expect.arrayContaining([fact.fact.id]) },
      selector: { mode: 'semantic', outcome: 'deterministic_fallback' },
      barrier: { outcome: 'completed', waitMs: 4, queueAgeMs: 20 },
    });
  });

  it('keeps prompt assembly available when structured event storage fails', async () => {
    getMemoryDb().execSync(`
      CREATE TRIGGER fail_prompt_retrieval_event_insert
      BEFORE INSERT ON memory_retrieval_events
      BEGIN
        SELECT RAISE(FAIL, 'private storage failure prose');
      END;
    `);

    const out = await buildLivingMemorySections({
      messages: [userMessage('continue safely', 1_000)],
      conversationId: 'memory-storage-failure',
      sourceThreadId: 'thread-storage-failure',
      personaId: 'default',
      taskId: null,
      now: 2_000,
    });

    expect(out.timings).toBeDefined();
    expect(out.retrievalEvent).toEqual({ status: 'failed', code: 'storage_error' });
    expect(JSON.stringify(out)).not.toContain('private storage failure prose');
    expect(readRecentMemoryRetrievalEvents()).toEqual([]);
  });

  it('fails the trusted boundary before retrieval when the scope identity is malformed', async () => {
    await expect(
      buildLivingMemorySections({
        messages: [userMessage('continue safely', 1_000)],
        conversationId: 'memory-derivation-failure',
        sourceThreadId: 'invalid private thread id',
        personaId: 'default',
        taskId: null,
        now: 2_000,
      }),
    ).rejects.toThrow('memory_scope_thread_id_invalid');
    expect(readRecentMemoryRetrievalEvents()).toEqual([]);
  });

  it('does not construct a semantic selector when recall is explicitly disabled', async () => {
    const selectorFactory = jest.spyOn(llmFactSelector, 'createLlmMemoryFactSelector');

    const out = await buildLivingMemorySections({
      messages: [userMessage('private scoped query', 1_000)],
      conversationId: 'memory-disabled-selector',
      sourceThreadId: 'thread-disabled-selector',
      personaId: 'default',
      taskId: null,
      now: 2_000,
      disableRecall: true,
      retrievalLlm: { provider: {} as never },
    });

    expect(selectorFactory).not.toHaveBeenCalled();
    expect(out.recalledFactCount).toBe(0);
    expect(out.retrievalEvent).toMatchObject({ status: 'recorded', code: 'recorded' });
    expect(readRecentMemoryRetrievalEvents()[0]).toMatchObject({ outcome: 'disabled' });
  });

  it('does not access durable memory or record an event for an opt-out barrier', async () => {
    const databaseSpy = jest.spyOn(sqliteStore, 'getMemoryDb');
    const out = await buildLivingMemorySections({
      messages: [userMessage('private opt-out query', 1_000)],
      conversationId: 'memory-opt-out-barrier',
      sourceThreadId: 'thread-opt-out-barrier',
      personaId: 'default',
      taskId: null,
      now: 2_000,
      consistencyBarrier: {
        outcome: 'opt_out',
        durationMs: 0,
        waitedMs: 0,
        queryCount: 0,
        matchedJobCount: 0,
        queueAgeMs: null,
        initialJobStatus: null,
        finalJobStatus: null,
      },
    });

    expect(out).toEqual(
      expect.objectContaining({ sections: [], recalledFactCount: 0, recalledEpisodeCount: 0 }),
    );
    expect(out.retrievalEvent).toBeUndefined();
    expect(databaseSpy).not.toHaveBeenCalled();
  });

  it('discards a deferred selector result when memory is disabled before it settles', async () => {
    const project = upsertEntity({ name: 'deferred selector privacy', type: 'project' });
    const fact = recordFactWithApplicability(
      {
        subjectId: project.id,
        predicate: 'decision',
        objectText: 'deferred selector privacy evidence',
        scope: 'global',
        importance: 0.9,
        now: 500,
      },
      { factClass: 'workflow', sourceAuthority: 'tool_observed' },
    ).fact;
    let releaseSelector!: (result: { factIds: string[] }) => void;
    const selectorResult = new Promise<{ factIds: string[] }>((resolve) => {
      releaseSelector = resolve;
    });
    let selectorStarted!: () => void;
    const selectorEntered = new Promise<void>((resolve) => {
      selectorStarted = resolve;
    });
    jest.spyOn(llmFactSelector, 'createLlmMemoryFactSelector').mockReturnValue(async () => {
      selectorStarted();
      return selectorResult;
    });

    const pending = buildLivingMemorySections({
      messages: [userMessage('deferred selector privacy evidence', 1_000)],
      conversationId: 'memory-selector-opt-out',
      sourceThreadId: 'thread-selector-opt-out',
      personaId: 'default',
      taskId: null,
      now: 2_000,
      retrievalLlm: { provider: {} as never },
    });
    await selectorEntered;
    useSettingsStore.setState({ disableLongTermMemory: true } as never);
    releaseSelector({ factIds: [fact.id] });

    await expect(pending).resolves.toEqual(
      expect.objectContaining({
        sections: [],
        recalledFactCount: 0,
        recalledEpisodeCount: 0,
      }),
    );
    expect(getFactById(fact.id)?.accessCount).toBe(0);
    expect(readRecentMemoryRetrievalEvents()).toEqual([]);
  });
});
