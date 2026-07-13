jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import { closeMemoryDb, getMemoryDb } from '../../../src/services/memory/database';
import { upsertEntity } from '../../../src/services/memory/entities';
import { admitLegacyFactContributions } from '../../../src/services/memory/factContributionAdmission';
import { buildLegacyFactAdmissionProofIndex } from '../../../src/services/memory/factContributionAdmissionProof';
import { enqueueIngestionJob } from '../../../src/services/memory/ingestionQueueStore';
import { encodeIngestionSourceSnapshot } from '../../../src/services/memory/ingestionSourceSnapshot';
import {
  addFactEvidence,
  recordThreadLocalEpisode,
} from '../../../src/services/memory/episodes/mutations';
import { recordFactWithApplicability } from '../../../src/services/memory/facts/mutations';
import type { MemoryFact, MemoryFactScope } from '../../../src/services/memory/facts/types';
import {
  ensureFactSchema,
  resetFactSchemaCacheForTests,
} from '../../../src/services/memory/schema';

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

function reopenLegacyBoundary(): void {
  getMemoryDb().execSync(`
    DROP TRIGGER IF EXISTS trg_memory_fact_contribution_admission_immutable;
    DROP TRIGGER IF EXISTS trg_memory_fact_contribution_admission_insert_immutable;
    DROP TRIGGER IF EXISTS trg_memory_fact_contribution_admission_delete_immutable;
    DELETE FROM memory_fact_contribution_admission;
  `);
}

function legacyFact(input: {
  predicate: string;
  objectText: string;
  scope: MemoryFactScope;
  messageId?: string;
  turnId?: string;
  conversationId?: string;
  threadId?: string;
  taskId?: string;
  now?: number;
}): MemoryFact {
  const now = input.now ?? 100;
  const subject = upsertEntity({ name: 'user', type: 'self', now });
  return recordFactWithApplicability(
    {
      subjectId: subject.id,
      predicate: input.predicate,
      objectText: input.objectText,
      scope: input.scope,
      sourceMessageId: input.messageId ?? null,
      sourceTurnId: input.turnId ?? null,
      originConversationId: input.conversationId ?? null,
      originThreadId: input.threadId ?? null,
      originTaskId: input.taskId ?? null,
      now,
    },
    { factClass: 'subjective_user', sourceAuthority: 'grounded_user' },
  ).fact;
}

function attachScopedEvidence(input: {
  factId: string;
  messageId: string;
  assistantTurnId?: string;
  conversationId: string;
  threadId: string;
  taskId?: string;
  now: number;
}): void {
  const assistantTurnId = input.assistantTurnId ?? `${input.messageId}-assistant`;
  const episode = recordThreadLocalEpisode({
    conversationId: input.conversationId,
    threadId: input.threadId,
    taskId: input.taskId ?? null,
    summary: 'Exact legacy source evidence.',
    messageIds: [input.messageId, assistantTurnId],
    sourceStartMessageId: input.messageId,
    sourceEndMessageId: assistantTurnId,
    now: input.now,
  });
  addFactEvidence({
    factId: input.factId,
    episodeId: episode!.id,
    messageId: input.messageId,
    role: 'user',
    quote: 'Exact evidence.',
    now: input.now,
  });
}

function enqueueExactSourceJob(input: {
  memoryConversationId: string;
  sourceThreadId: string;
  messageId: string;
  turnId: string;
  taskId?: string;
}): NonNullable<ReturnType<typeof enqueueIngestionJob>> {
  const messages = [
    { id: input.messageId, role: 'user' as const, content: 'Remember indexed.', timestamp: 90 },
    {
      id: input.turnId,
      role: 'assistant' as const,
      content: 'Remembered.',
      timestamp: 100,
      assistantMetadata: {
        kind: 'final' as const,
        completionStatus: 'complete' as const,
        finishReason: 'stop',
      },
    },
  ];
  const job = enqueueIngestionJob({
    personaId: 'default',
    threadId: input.sourceThreadId,
    threadTitle: null,
    memoryConversationId: input.memoryConversationId,
    taskId: input.taskId ?? null,
    priorUserMessageId: null,
    sourceStartMessageId: input.messageId,
    sourceEndMessageId: input.turnId,
    sourceSnapshot: encodeIngestionSourceSnapshot({
      messages,
      priorUserMessageId: null,
      sourceStartMessageId: input.messageId,
      sourceEndMessageId: input.turnId,
    }),
    sourceRunId: null,
    sourceAt: 100,
    chatProviderId: null,
    chatModel: null,
    reason: 'turn_completed',
    providerEnrichment: false,
    now: 100,
  });
  if (!job) throw new Error('expected exact-source ingestion job');
  return job;
}

function insertReceipt(input: {
  jobId: string;
  deterministicFactIds?: string[];
  invalidatedFactIdsJson?: string;
}): void {
  getMemoryDb().runSync(
    `INSERT INTO memory_ingestion_receipts(
       job_id, attempt_number, episode_id, deterministic_fact_ids_json,
       provider_fact_ids_json, invalidated_fact_ids_json,
       bridged_evidence_fact_ids_json, agent_run_memory_fact_ids_json,
       active_focus_updated, open_threads_updated, provider_outcome,
       provider_outcome_code, persisted_at
     ) VALUES (?, 1, NULL, ?, '[]', ?, '[]', '[]', 0, 0, 'structural_only', NULL, 100)`,
    input.jobId,
    JSON.stringify(input.deterministicFactIds ?? []),
    input.invalidatedFactIdsJson ?? '[]',
  );
}

function insertRetrievalEvent(input: { id: string; factIds: string[] }): void {
  getMemoryDb().runSync(
    `INSERT INTO memory_retrieval_events(
       id, operation, mode, outcome, query_hash, query_length, query_unit_count,
       task_scope_present, candidate_fact_count, selected_fact_count,
       selected_fact_ids_json, candidate_episode_count, selected_episode_count,
       selected_episode_ids_json, plan_ms, fact_recall_ms, episode_recall_ms,
       candidate_fetch_ms, score_ms, selector_ms, total_ms, selector_mode,
       selector_outcome, created_at
     ) VALUES (?, 'explicit_search', 'query', 'completed', ?, 1, 1, 0, ?, ?, ?,
               0, 0, '[]', 0, 0, 0, 0, 0, 0, 0, 'deterministic', 'not_requested', 100)`,
    input.id,
    '0'.repeat(64),
    input.factIds.length,
    input.factIds.length,
    JSON.stringify(input.factIds),
  );
}

describe('legacy fact contribution admission', () => {
  it('admits an exact conversation fact in place with stable aliases and payload time', () => {
    const fact = legacyFact({
      predicate: 'preferred_tone',
      objectText: 'brief',
      scope: 'conversation',
      messageId: 'legacy-user-message',
      turnId: 'legacy-assistant-turn',
      conversationId: 'legacy-conversation',
      threadId: 'legacy-thread',
      now: 100,
    });
    attachScopedEvidence({
      factId: fact.id,
      messageId: 'legacy-user-message',
      assistantTurnId: 'legacy-assistant-turn',
      conversationId: 'legacy-conversation',
      threadId: 'legacy-thread',
      now: 110,
    });
    reopenLegacyBoundary();

    expect(admitLegacyFactContributions(getMemoryDb(), 500)).toEqual({
      status: 'completed',
      version: 1,
      completedAt: 500,
      admittedCount: 1,
      quarantinedCount: 0,
    });
    expect(
      getMemoryDb().getFirstSync<{
        fact_id: string;
        producer_id: string;
        contributed_at: number;
      }>('SELECT fact_id, producer_id, contributed_at FROM memory_fact_contributions'),
    ).toEqual({
      fact_id: fact.id,
      producer_id: 'legacy_fact_snapshot_v1',
      contributed_at: 100,
    });
    expect(
      getMemoryDb().getAllSync<{ source_kind: string; source_id: string }>(
        `SELECT source_kind, source_id FROM memory_fact_contribution_sources
          ORDER BY source_kind ASC`,
      ),
    ).toEqual([
      { source_kind: 'message', source_id: 'legacy-user-message' },
      { source_kind: 'turn', source_id: 'legacy-assistant-turn' },
    ]);
    expect(
      getMemoryDb().getFirstSync<{ deleted_at: number | null }>(
        'SELECT deleted_at FROM memory_facts WHERE id = ?',
        fact.id,
      ),
    ).toEqual({ deleted_at: null });
    expect(admitLegacyFactContributions(getMemoryDb(), 900)).toMatchObject({
      status: 'already_completed',
      completedAt: 500,
    });
  });

  it('admits global memory only when linked evidence proves one exact source scope', () => {
    const fact = legacyFact({
      predicate: 'favorite_color',
      objectText: 'blue',
      scope: 'global',
      messageId: 'global-user-message',
      now: 100,
    });
    attachScopedEvidence({
      factId: fact.id,
      messageId: 'global-user-message',
      conversationId: 'global-source-conversation',
      threadId: 'global-source-thread',
      now: 110,
    });
    reopenLegacyBoundary();

    expect(admitLegacyFactContributions(getMemoryDb(), 500)).toMatchObject({
      admittedCount: 1,
      quarantinedCount: 0,
    });
    expect(
      getMemoryDb().getFirstSync<{
        memory_conversation_id: string;
        source_thread_id: string;
        task_id: string;
      }>(
        `SELECT memory_conversation_id, source_thread_id, task_id
           FROM memory_fact_contributions`,
      ),
    ).toEqual({
      memory_conversation_id: 'global-source-conversation',
      source_thread_id: 'global-source-thread',
      task_id: '',
    });
  });

  it('uses an exact linked episode end to prove a global fact turn alias', () => {
    const fact = legacyFact({
      predicate: 'episode_proven_turn',
      objectText: 'exact',
      scope: 'global',
      messageId: 'episode-proven-message',
      turnId: 'episode-proven-message-assistant',
    });
    attachScopedEvidence({
      factId: fact.id,
      messageId: 'episode-proven-message',
      conversationId: 'episode-proven-conversation',
      threadId: 'episode-proven-thread',
      now: 110,
    });
    reopenLegacyBoundary();

    expect(admitLegacyFactContributions(getMemoryDb(), 500)).toMatchObject({
      admittedCount: 1,
      quarantinedCount: 0,
    });
    expect(
      getMemoryDb().getAllSync<{ source_kind: string; source_id: string }>(
        `SELECT source_kind, source_id FROM memory_fact_contribution_sources
          ORDER BY source_kind ASC`,
      ),
    ).toEqual([
      { source_kind: 'message', source_id: 'episode-proven-message' },
      { source_kind: 'turn', source_id: 'episode-proven-message-assistant' },
    ]);
  });

  it('does not use a linked episode to prove a mismatched turn alias', () => {
    const fact = legacyFact({
      predicate: 'episode_mismatched_turn',
      objectText: 'reject',
      scope: 'global',
      messageId: 'episode-mismatch-message',
      turnId: 'different-assistant-turn',
    });
    attachScopedEvidence({
      factId: fact.id,
      messageId: 'episode-mismatch-message',
      conversationId: 'episode-mismatch-conversation',
      threadId: 'episode-mismatch-thread',
      now: 110,
    });
    reopenLegacyBoundary();

    expect(admitLegacyFactContributions(getMemoryDb(), 500)).toMatchObject({
      admittedCount: 0,
      quarantinedCount: 1,
    });
    expect(
      getMemoryDb().getFirstSync<{ reason: string }>(
        'SELECT reason FROM memory_fact_legacy_quarantine WHERE fact_id = ?',
        fact.id,
      ),
    ).toEqual({ reason: 'source_scope_unproven' });
  });

  it('uses the canonical ingestion-job source index without guessing a global fact scope', () => {
    legacyFact({
      predicate: 'job_proven_preference',
      objectText: 'indexed',
      scope: 'global',
      messageId: 'job-user-message',
      turnId: 'job-assistant-turn',
      now: 100,
    });
    enqueueExactSourceJob({
      memoryConversationId: 'job-source-conversation',
      sourceThreadId: 'job-source-thread',
      messageId: 'job-user-message',
      turnId: 'job-assistant-turn',
    });
    reopenLegacyBoundary();

    expect(admitLegacyFactContributions(getMemoryDb(), 500)).toMatchObject({
      admittedCount: 1,
      quarantinedCount: 0,
    });
    expect(
      getMemoryDb().getFirstSync<{
        memory_conversation_id: string;
        source_thread_id: string;
      }>('SELECT memory_conversation_id, source_thread_id FROM memory_fact_contributions'),
    ).toEqual({
      memory_conversation_id: 'job-source-conversation',
      source_thread_id: 'job-source-thread',
    });
  });

  it('quarantines one stale receipt scope without rolling back unrelated admission', () => {
    const conflicting = legacyFact({
      predicate: 'stale_receipt_scope',
      objectText: 'must not move scopes',
      scope: 'conversation',
      messageId: 'origin-only-message',
      turnId: 'origin-only-turn',
      conversationId: 'origin-only-conversation',
      threadId: 'origin-only-thread',
    });
    attachScopedEvidence({
      factId: conflicting.id,
      messageId: 'origin-only-message',
      assistantTurnId: 'origin-only-turn',
      conversationId: 'origin-only-conversation',
      threadId: 'origin-only-thread',
      now: 110,
    });
    const independent = legacyFact({
      predicate: 'independent_valid_fact',
      objectText: 'survives',
      scope: 'conversation',
      messageId: 'independent-message',
      turnId: 'independent-turn',
      conversationId: 'independent-conversation',
      threadId: 'independent-thread',
    });
    attachScopedEvidence({
      factId: independent.id,
      messageId: 'independent-message',
      assistantTurnId: 'independent-turn',
      conversationId: 'independent-conversation',
      threadId: 'independent-thread',
      now: 110,
    });
    const staleJob = enqueueExactSourceJob({
      memoryConversationId: 'stale-receipt-conversation',
      sourceThreadId: 'stale-receipt-thread',
      messageId: 'stale-job-message',
      turnId: 'stale-job-turn',
    });
    insertReceipt({ jobId: staleJob.id, deterministicFactIds: [conflicting.id] });
    reopenLegacyBoundary();

    expect(admitLegacyFactContributions(getMemoryDb(), 500)).toMatchObject({
      admittedCount: 1,
      quarantinedCount: 1,
    });
    expect(
      getMemoryDb().getFirstSync<{ reason: string }>(
        'SELECT reason FROM memory_fact_legacy_quarantine WHERE fact_id = ?',
        conflicting.id,
      ),
    ).toEqual({ reason: 'source_scope_ambiguous' });
    expect(
      getMemoryDb().getFirstSync<{ count: number }>(
        'SELECT COUNT(*) AS count FROM memory_fact_contribution_admission',
      )?.count,
    ).toBe(1);
  });

  it('never treats invalidated or structurally invalid receipts as contribution support', () => {
    const invalidatedOnlyFact = legacyFact({
      predicate: 'invalidated_only_receipt',
      objectText: 'not production support',
      scope: 'global',
      messageId: 'invalidated-only-message',
    });
    const invalidatedJob = enqueueExactSourceJob({
      memoryConversationId: 'invalidated-job-conversation',
      sourceThreadId: 'invalidated-job-thread',
      messageId: 'invalidated-job-message',
      turnId: 'invalidated-job-turn',
    });
    insertReceipt({
      jobId: invalidatedJob.id,
      invalidatedFactIdsJson: JSON.stringify([invalidatedOnlyFact.id]),
    });

    const malformedFact = legacyFact({
      predicate: 'malformed_receipt',
      objectText: 'ignored as a unit',
      scope: 'global',
      messageId: 'malformed-receipt-message',
    });
    const malformedJob = enqueueExactSourceJob({
      memoryConversationId: 'malformed-job-conversation',
      sourceThreadId: 'malformed-job-thread',
      messageId: 'malformed-job-message',
      turnId: 'malformed-job-turn',
    });
    insertReceipt({
      jobId: malformedJob.id,
      deterministicFactIds: [malformedFact.id],
      invalidatedFactIdsJson: 'not-json',
    });

    const proofIndex = buildLegacyFactAdmissionProofIndex(getMemoryDb());
    expect(proofIndex.receiptJobIdsByFactId.has(invalidatedOnlyFact.id)).toBe(false);
    expect(proofIndex.receiptJobIdsByFactId.has(malformedFact.id)).toBe(false);
  });

  it('quarantines a global fact when linked evidence cannot prove every alias', () => {
    const fact = legacyFact({
      predicate: 'mismatched_evidence',
      objectText: 'unproven source',
      scope: 'global',
      messageId: 'original-unscoped-message',
    });
    attachScopedEvidence({
      factId: fact.id,
      messageId: 'different-scoped-message',
      conversationId: 'evidence-conversation',
      threadId: 'evidence-thread',
      now: 110,
    });
    reopenLegacyBoundary();

    expect(admitLegacyFactContributions(getMemoryDb(), 500)).toMatchObject({
      admittedCount: 0,
      quarantinedCount: 1,
    });
    expect(
      getMemoryDb().getFirstSync<{ reason: string }>(
        'SELECT reason FROM memory_fact_legacy_quarantine WHERE fact_id = ?',
        fact.id,
      ),
    ).toEqual({ reason: 'source_scope_unproven' });
  });

  it('keeps scrubbed retrieval identifiers and selected counts consistent', () => {
    const rejected = legacyFact({
      predicate: 'retrieval_rejected',
      objectText: 'unproven',
      scope: 'global',
      messageId: 'retrieval-rejected-message',
    });
    const retained = legacyFact({
      predicate: 'retrieval_retained',
      objectText: 'proven',
      scope: 'conversation',
      messageId: 'retrieval-retained-message',
      turnId: 'retrieval-retained-turn',
      conversationId: 'retrieval-conversation',
      threadId: 'retrieval-thread',
    });
    attachScopedEvidence({
      factId: retained.id,
      messageId: 'retrieval-retained-message',
      assistantTurnId: 'retrieval-retained-turn',
      conversationId: 'retrieval-conversation',
      threadId: 'retrieval-thread',
      now: 110,
    });
    insertRetrievalEvent({
      id: 'retrieval_event_mixed',
      factIds: [rejected.id, retained.id],
    });
    insertRetrievalEvent({ id: 'retrieval_event_empty', factIds: [rejected.id] });
    const memoryOwnerId = getMemoryDb().getFirstSync<{ memory_owner_id: string }>(
      'SELECT memory_owner_id FROM memory_facts WHERE id = ?',
      rejected.id,
    )!.memory_owner_id;
    for (const eventId of ['retrieval_event_mixed', 'retrieval_event_empty']) {
      getMemoryDb().runSync(
        `INSERT INTO memory_retrieval_outcomes(
           retrieval_event_id, memory_owner_id, memory_conversation_id_hash,
           source_thread_id_hash, assistant_message_id_hash, outcome,
           evidence_source, contract_version, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, 'helpful', 'user_explicit', 1, 100, 100)`,
        eventId,
        memoryOwnerId,
        '1'.repeat(64),
        '2'.repeat(64),
        '3'.repeat(64),
      );
    }
    reopenLegacyBoundary();

    expect(admitLegacyFactContributions(getMemoryDb(), 500)).toMatchObject({
      admittedCount: 1,
      quarantinedCount: 1,
    });
    expect(
      getMemoryDb().getAllSync<{
        id: string;
        selected_fact_count: number;
        selected_fact_ids_json: string;
      }>(
        `SELECT id, selected_fact_count, selected_fact_ids_json
           FROM memory_retrieval_events ORDER BY id ASC`,
      ),
    ).toEqual([
      { id: 'retrieval_event_empty', selected_fact_count: 0, selected_fact_ids_json: '[]' },
      {
        id: 'retrieval_event_mixed',
        selected_fact_count: 1,
        selected_fact_ids_json: JSON.stringify([retained.id]),
      },
    ]);
    expect(
      getMemoryDb().getFirstSync<{ count: number }>(
        'SELECT COUNT(*) AS count FROM memory_retrieval_outcomes',
      )?.count,
    ).toBe(0);
  });

  it('quarantines unproven and multi-scope facts without leaving prompt-facing state', () => {
    const unproven = legacyFact({
      predicate: 'unproven_preference',
      objectText: 'one',
      scope: 'global',
      messageId: 'unproven-message',
    });
    const ambiguous = legacyFact({
      predicate: 'ambiguous_preference',
      objectText: 'two',
      scope: 'global',
      messageId: 'ambiguous-message',
    });
    attachScopedEvidence({
      factId: ambiguous.id,
      messageId: 'ambiguous-message',
      conversationId: 'conversation-one',
      threadId: 'thread-one',
      now: 110,
    });
    attachScopedEvidence({
      factId: ambiguous.id,
      messageId: 'ambiguous-message-two',
      conversationId: 'conversation-two',
      threadId: 'thread-two',
      now: 120,
    });
    getMemoryDb().runSync(
      `INSERT INTO memory_reflections(
         id, scope, thread_id, period_start, period_end, kind, content,
         source_episode_ids_json, source_fact_ids_json, created_at, updated_at
       ) VALUES ('legacy-reflection', 'global', NULL, 1, 2, 'summary', 'stale',
                 '[]', ?, 2, 2)`,
      JSON.stringify([unproven.id]),
    );
    getMemoryDb().runSync(
      `INSERT INTO memory_working_blocks(
         label, scope_key, content, char_limit, description, prompt_eligibility, updated_at
       ) VALUES ('active_focus', 'legacy', 'stale', 100, 'stale', 'untrusted', 2)`,
    );
    reopenLegacyBoundary();

    expect(admitLegacyFactContributions(getMemoryDb(), 500)).toMatchObject({
      admittedCount: 0,
      quarantinedCount: 2,
    });
    const quarantined = getMemoryDb().getAllSync<{ fact_id: string; reason: string }>(
      'SELECT fact_id, reason FROM memory_fact_legacy_quarantine',
    );
    expect(quarantined).toHaveLength(2);
    expect(quarantined).toEqual(
      expect.arrayContaining([
        { fact_id: ambiguous.id, reason: 'source_scope_ambiguous' },
        { fact_id: unproven.id, reason: 'source_scope_unproven' },
      ]),
    );
    expect(
      getMemoryDb().getFirstSync<{ count: number }>(
        `SELECT COUNT(*) AS count FROM memory_facts
          WHERE id IN (?, ?)`,
        ambiguous.id,
        unproven.id,
      )?.count,
    ).toBe(0);
    expect(
      getMemoryDb().getFirstSync<{ count: number }>(
        `SELECT COUNT(*) AS count FROM memory_fact_terms
          WHERE fact_id IN (?, ?)`,
        ambiguous.id,
        unproven.id,
      )?.count,
    ).toBe(0);
    expect(
      getMemoryDb().getFirstSync<{ deleted_at: number }>(
        "SELECT deleted_at FROM memory_reflections WHERE id = 'legacy-reflection'",
      ),
    ).toEqual({ deleted_at: 500 });
    expect(
      getMemoryDb().getFirstSync<{ count: number }>(
        'SELECT COUNT(*) AS count FROM memory_working_blocks',
      )?.count,
    ).toBe(0);
  });
});
