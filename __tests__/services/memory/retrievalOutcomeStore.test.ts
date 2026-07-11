jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import { upsertEntity } from '../../../src/services/memory/entities';
import { recordFact } from '../../../src/services/memory/facts/mutations';
import { recordPromptAssemblyRetrievalEvent } from '../../../src/services/memory/promptAssemblyRetrievalEvent';
import {
  readExplicitMemoryRetrievalFeedback,
  recordExplicitMemoryRetrievalFeedback,
  type MemoryRetrievalFeedbackTarget,
} from '../../../src/services/memory/retrievalOutcomeStore';
import {
  ensureFactSchema,
  resetFactSchemaCacheForTests,
} from '../../../src/services/memory/schema';
import { closeMemoryDb, getMemoryDb } from '../../../src/services/memory/database';

const expoSqlite = require('expo-sqlite') as { __resetExpoSqliteForTests: () => void };

const EMPTY_EXPANSION = {
  outcome: 'not_requested' as const,
  requestedSourceCount: 0,
  acceptedSourceCount: 0,
  sourceWithEvidenceCount: 0,
  emittedEvidenceCount: 0,
  promptBudgetDroppedCount: 0,
  promptChars: 0,
  durationMs: 0,
};

beforeEach(() => {
  closeMemoryDb();
  expoSqlite.__resetExpoSqliteForTests();
  resetFactSchemaCacheForTests();
  ensureFactSchema();
});

afterEach(() => {
  closeMemoryDb();
});

async function createPromptRetrievalEvent(params: {
  memoryConversationId?: string;
  sourceThreadId?: string;
  selectedFactIds?: string[];
  selectedEpisodeIds?: string[];
}) {
  const result = await recordPromptAssemblyRetrievalEvent({
    query: 'What did I tell you before?',
    memoryConversationId: params.memoryConversationId ?? 'private-root-sentinel',
    sourceThreadId: params.sourceThreadId ?? 'private-thread-sentinel',
    taskScopePresent: false,
    state: 'completed',
    selectedFactIds: params.selectedFactIds ?? ['fact-selected-1'],
    selectedEpisodeIds: params.selectedEpisodeIds ?? [],
    expansion: EMPTY_EXPANSION,
    createdAt: 50,
  });
  if (result.status !== 'recorded') {
    throw new Error(`retrieval fixture failed: ${result.code}`);
  }
  return result.eventId;
}

function makeTarget(retrievalEventId: string): MemoryRetrievalFeedbackTarget {
  return {
    retrievalEventId,
    memoryConversationId: 'private-root-sentinel',
    sourceThreadId: 'private-thread-sentinel',
    assistantMessageId: 'private-assistant-message-sentinel',
  };
}

describe('explicit memory retrieval feedback', () => {
  it('stores only hashed target identities and never mutates selected facts', async () => {
    const entity = upsertEntity({ name: 'release', type: 'project', now: 1 });
    const fact = recordFact({
      subjectId: entity.id,
      predicate: 'release_channel',
      objectText: 'stable',
      memoryKind: 'semantic_fact',
      scope: 'global',
      now: 2,
    });
    const factBefore = getMemoryDb().getFirstSync<Record<string, unknown>>(
      'SELECT * FROM memory_facts WHERE id = ?',
      fact.fact.id,
    );
    const eventId = await createPromptRetrievalEvent({ selectedFactIds: [fact.fact.id] });

    await expect(
      recordExplicitMemoryRetrievalFeedback({
        target: makeTarget(eventId),
        outcome: 'helpful',
        recordedAt: 100,
      }),
    ).resolves.toEqual({
      status: 'recorded',
      outcome: 'helpful',
      createdAt: 100,
      updatedAt: 100,
    });
    await expect(readExplicitMemoryRetrievalFeedback(makeTarget(eventId))).resolves.toEqual({
      status: 'found',
      outcome: 'helpful',
      updatedAt: 100,
    });

    const rawRows = getMemoryDb().getAllSync<Record<string, unknown>>(
      'SELECT * FROM memory_retrieval_outcomes',
    );
    const serializedRows = JSON.stringify(rawRows);
    expect(serializedRows).not.toContain('private-root-sentinel');
    expect(serializedRows).not.toContain('private-thread-sentinel');
    expect(serializedRows).not.toContain('private-assistant-message-sentinel');
    expect(rawRows[0]).toEqual(
      expect.objectContaining({
        retrieval_event_id: eventId,
        outcome: 'helpful',
        evidence_source: 'user_explicit',
        contract_version: 1,
        memory_conversation_id_hash: expect.stringMatching(/^[a-f0-9]{64}$/u),
        source_thread_id_hash: expect.stringMatching(/^[a-f0-9]{64}$/u),
        assistant_message_id_hash: expect.stringMatching(/^[a-f0-9]{64}$/u),
      }),
    );
    expect(
      getMemoryDb().getFirstSync<Record<string, unknown>>(
        'SELECT * FROM memory_facts WHERE id = ?',
        fact.fact.id,
      ),
    ).toEqual(factBefore);
    expect(
      getMemoryDb().getFirstSync<{ count: number }>(
        'SELECT COUNT(*) AS count FROM memory_fact_observations',
      )?.count,
    ).toBe(0);
  });

  it('is idempotent for retries and records an explicit changed choice', async () => {
    const eventId = await createPromptRetrievalEvent({});
    const target = makeTarget(eventId);

    await recordExplicitMemoryRetrievalFeedback({ target, outcome: 'helpful', recordedAt: 100 });
    await expect(
      recordExplicitMemoryRetrievalFeedback({ target, outcome: 'helpful', recordedAt: 200 }),
    ).resolves.toEqual({
      status: 'unchanged',
      outcome: 'helpful',
      createdAt: 100,
      updatedAt: 100,
    });
    await expect(
      recordExplicitMemoryRetrievalFeedback({ target, outcome: 'wrong', recordedAt: 250 }),
    ).resolves.toEqual({
      status: 'updated',
      outcome: 'wrong',
      createdAt: 100,
      updatedAt: 250,
    });
    expect(
      getMemoryDb().getFirstSync<{ count: number }>(
        'SELECT COUNT(*) AS count FROM memory_retrieval_outcomes',
      )?.count,
    ).toBe(1);
  });

  it('fails closed across owner, conversation, thread, message, and event boundaries', async () => {
    const eventId = await createPromptRetrievalEvent({});
    const target = makeTarget(eventId);
    await recordExplicitMemoryRetrievalFeedback({ target, outcome: 'helpful', recordedAt: 100 });

    for (const crossedTarget of [
      { ...target, memoryConversationId: 'other-root' },
      { ...target, sourceThreadId: 'other-thread' },
      { ...target, assistantMessageId: 'other-message' },
      { ...target, retrievalEventId: 'retrieval_event_missing_1_abc' },
    ]) {
      await expect(
        recordExplicitMemoryRetrievalFeedback({
          target: crossedTarget,
          outcome: 'irrelevant',
          recordedAt: 200,
        }),
      ).resolves.toEqual({ status: 'rejected', code: 'not_recordable' });
      await expect(readExplicitMemoryRetrievalFeedback(crossedTarget)).resolves.toEqual({
        status: 'not_found',
      });
    }

    getMemoryDb().runSync(
      "UPDATE memory_retrieval_outcomes SET memory_owner_id = 'vault_owner_other'",
    );
    await expect(
      recordExplicitMemoryRetrievalFeedback({ target, outcome: 'wrong', recordedAt: 300 }),
    ).resolves.toEqual({ status: 'rejected', code: 'not_recordable' });
    await expect(readExplicitMemoryRetrievalFeedback(target)).resolves.toEqual({
      status: 'not_found',
    });
  });

  it('rejects malformed, unselected, and non-user-enum input without a write', async () => {
    const noSelectionEventId = await createPromptRetrievalEvent({
      selectedFactIds: [],
      selectedEpisodeIds: [],
    });
    await expect(
      recordExplicitMemoryRetrievalFeedback({
        target: makeTarget(noSelectionEventId),
        outcome: 'helpful',
      }),
    ).resolves.toEqual({ status: 'rejected', code: 'not_recordable' });
    await expect(
      recordExplicitMemoryRetrievalFeedback({
        target: { ...makeTarget(noSelectionEventId), assistantMessageId: 'invalid message id' },
        outcome: 'helpful',
      }),
    ).resolves.toEqual({ status: 'rejected', code: 'invalid_input' });
    await expect(
      recordExplicitMemoryRetrievalFeedback({
        target: makeTarget(noSelectionEventId),
        outcome: 'positive' as any,
      }),
    ).resolves.toEqual({ status: 'rejected', code: 'invalid_input' });
    await expect(
      recordExplicitMemoryRetrievalFeedback({
        target: makeTarget(noSelectionEventId),
        outcome: 'helpful',
        recordedAt: -1,
      }),
    ).resolves.toEqual({ status: 'rejected', code: 'invalid_input' });
    expect(
      getMemoryDb().getFirstSync<{ count: number }>(
        'SELECT COUNT(*) AS count FROM memory_retrieval_outcomes',
      )?.count,
    ).toBe(0);
  });

  it('deletes feedback when its bounded retrieval event is retired', async () => {
    const eventId = await createPromptRetrievalEvent({});
    await recordExplicitMemoryRetrievalFeedback({
      target: makeTarget(eventId),
      outcome: 'irrelevant',
      recordedAt: 100,
    });

    getMemoryDb().runSync('DELETE FROM memory_retrieval_events WHERE id = ?', eventId);

    expect(
      getMemoryDb().getFirstSync<{ count: number }>(
        'SELECT COUNT(*) AS count FROM memory_retrieval_outcomes',
      )?.count,
    ).toBe(0);
  });
});
