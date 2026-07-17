jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

jest.mock('../../../src/services/memory/consolidation/paths', () => ({
  resolveConsolidationPath: jest.fn(async () => ({
    tier: 'deterministic',
    provider: null,
    model: null,
    extractor: null,
  })),
}));

jest.mock('../../../src/services/memory/turnProcessor', () => ({
  processIngestionTurn: jest.fn(),
}));

import {
  __resetIngestionQueueForTests,
  drainIngestionQueue,
  enqueueIngestionJob as enqueueStrictIngestionJob,
  getIngestionJob,
  INGESTION_RETRY_BASE_DELAY_MS,
  listIngestionDurabilityReceipts,
  listPendingIngestionJobs,
} from '../../../src/services/memory/ingestionQueue';
import type { EnqueueIngestionJobInput } from '../../../src/services/memory/ingestionQueue';
import { getIngestionQueueDiagnostics } from '../../../src/services/memory/ingestionQueueDiagnostics';
import { ensureIngestionQueueSchema } from '../../../src/services/memory/ingestionQueueSchema';
import { processIngestionTurn } from '../../../src/services/memory/turnProcessor';
import { getWorkingBlock } from '../../../src/services/memory/workingBlocks';
import { upsertEntity } from '../../../src/services/memory/entities';
import { recordFact } from '../../../src/services/memory/facts/mutations';
import { recordEpisode } from '../../../src/services/memory/episodes/mutations';
import { __resetOnDeviceGuardsForTests } from '../../../src/services/memory/onDeviceGuards';
import {
  ensureFactSchema,
  resetFactSchemaCacheForTests,
} from '../../../src/services/memory/schema';
import { closeMemoryDb, getMemoryDb } from '../../../src/services/memory/database';
import { codeOwnedClosedTurnEpisodeFields } from '../../helpers/memoryRetirementTestFixtures';
import {
  isMemoryProjectionSnapshotCurrent,
  isMemoryProjectionSnapshotDurablyCurrent,
  isRestrictiveMemoryAuthoritySnapshotCurrent,
  isRestrictiveMemoryAuthoritySnapshotDurablyCurrent,
} from '../../../src/services/memory/memoryAuthority';
import { withIngestionSourceSnapshot } from '../../helpers/ingestionSourceSnapshotFixture';
import { resolveMockedIngestionTurn } from '../../helpers/ingestionQueueProcessFixture';
import {
  columnNamesForQueue,
  requireAuthoritySnapshot,
} from '../../helpers/ingestionQueueCoreFixture';

const expoSqlite = require('expo-sqlite') as { __resetExpoSqliteForTests: () => void };
const mockedProcessIngestionTurn = processIngestionTurn as jest.MockedFunction<
  typeof processIngestionTurn
>;

type TestEnqueueInput = Pick<
  EnqueueIngestionJobInput,
  'personaId' | 'threadId' | 'sourceEndMessageId'
> &
  Partial<EnqueueIngestionJobInput>;

function enqueueIngestionJob(input: TestEnqueueInput) {
  return enqueueStrictIngestionJob(
    withIngestionSourceSnapshot({
      threadTitle: null,
      memoryConversationId: input.threadId,
      taskId: null,
      sourceStartMessageId: null,
      sourceRunId: null,
      sourceAt: input.sourceAt ?? input.now ?? 1,
      chatProviderId: null,
      chatModel: null,
      reason: 'turn_completed',
      providerEnrichment: true,
      ...input,
    }),
  );
}

function processResult(
  providerOutcome: Awaited<ReturnType<typeof processIngestionTurn>>['providerOutcome'],
): Awaited<ReturnType<typeof processIngestionTurn>> {
  return {
    processed: true,
    episodeId: 'ep-1',
    deterministicFactIds: ['fact-1'],
    providerFactIds: [],
    invalidatedFactIds: [],
    activeFocusUpdated: true,
    openThreadsUpdated: false,
    enriched: providerOutcome.status === 'valid',
    providerOutcome,
    bridgedEvidenceFactIds: [],
    agentRunMemoryFactIds: [],
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  closeMemoryDb();
  expoSqlite.__resetExpoSqliteForTests();
  resetFactSchemaCacheForTests();
  ensureFactSchema();
  __resetOnDeviceGuardsForTests();
  __resetIngestionQueueForTests();
  mockedProcessIngestionTurn.mockImplementation(
    resolveMockedIngestionTurn(processResult({ status: 'not_requested' })),
  );
});

afterEach(() => {
  closeMemoryDb();
});

describe('ingestionQueue', () => {
  it('quarantines source-derived memory when persisted duplicate identities conflict', () => {
    const job = enqueueIngestionJob({
      personaId: 'default',
      threadId: 'conflicting-source-thread',
      memoryConversationId: 'conflicting-root-a',
      sourceStartMessageId: 'conflicting-source-user',
      sourceEndMessageId: 'conflicting-source-assistant',
      sourceRunId: 'conflicting-source-run',
      sourceAt: 10,
      now: 10,
    })!;
    const subject = upsertEntity({ name: 'conflicting source', type: 'project', now: 10 });
    const fact = recordFact({
      subjectId: subject.id,
      predicate: 'release_state',
      objectText: 'ambiguous result',
      scope: 'conversation',
      originConversationId: 'conflicting-root-a',
      originThreadId: 'conflicting-source-thread',
      sourceMessageId: 'conflicting-source-user',
      sourceRunId: 'conflicting-source-run',
      sourceTurnId: 'conflicting-source-assistant',
      now: 10,
    }).fact;
    const episode = recordEpisode({
      conversationId: 'conflicting-root-a',
      threadId: 'conflicting-source-thread',
      taskId: null,
      summary: 'Ambiguous source-derived episode.',
      ...codeOwnedClosedTurnEpisodeFields({
        sourceUserMessageId: 'conflicting-source-user',
        sourceAssistantMessageId: 'conflicting-source-assistant',
        userContent: 'Ambiguous source-derived episode.',
        assistantContent: 'Ambiguous source-derived episode.',
      }),
      accessPolicy: {
        memoryConversationId: 'conflicting-root-a',
        sourceThreadId: 'conflicting-source-thread',
        personaId: 'default',
        taskId: null,
        shareability: 'thread_only',
      },
      now: 10,
    })!;
    const unrelatedEpisode = recordEpisode({
      conversationId: 'unrelated-root',
      threadId: 'unrelated-thread',
      taskId: null,
      summary: 'Unrelated episode remains available.',
      ...codeOwnedClosedTurnEpisodeFields({
        sourceUserMessageId: 'unrelated-user',
        sourceAssistantMessageId: 'unrelated-assistant',
        userContent: 'Unrelated episode remains available.',
        assistantContent: 'Unrelated episode remains available.',
      }),
      accessPolicy: {
        memoryConversationId: 'unrelated-root',
        sourceThreadId: 'unrelated-thread',
        personaId: 'default',
        taskId: null,
        shareability: 'thread_only',
      },
      now: 10,
    })!;
    const db = getMemoryDb();
    db.execSync('DROP INDEX idx_ingestion_jobs_source_turn');
    db.runSync(
      `INSERT INTO memory_ingestion_jobs(
         id, thread_id, thread_title, memory_conversation_id, persona_id, task_id,
         source_run_id, chat_provider_id, chat_model, source_start_message_id,
         source_end_message_id, source_snapshot_version, source_snapshot_sha256,
         source_snapshot_byte_length, source_at, reason, status, attempt_count,
         provider_enrichment, provider_outcome, outcome_code, next_attempt_at,
         lease_expires_at, claim_token, structural_completed_at, created_at, updated_at,
         completed_at
       )
       SELECT ?, thread_id, thread_title, ?, persona_id, task_id, source_run_id,
              chat_provider_id, chat_model, source_start_message_id, source_end_message_id,
              source_snapshot_version, source_snapshot_sha256, source_snapshot_byte_length,
              source_at, reason, status, attempt_count, provider_enrichment,
              provider_outcome, outcome_code, next_attempt_at, lease_expires_at,
              claim_token, structural_completed_at, created_at, updated_at, completed_at
         FROM memory_ingestion_jobs
        WHERE id = ?`,
      'conflicting-source-job-b',
      'conflicting-root-b',
      job.id,
    );
    db.runSync(
      `INSERT INTO memory_ingestion_source_snapshots(job_id, payload_json, created_at)
       SELECT ?, payload_json, created_at
         FROM memory_ingestion_source_snapshots
        WHERE job_id = ?`,
      'conflicting-source-job-b',
      job.id,
    );

    const beforeQuarantine = requireAuthoritySnapshot();
    ensureIngestionQueueSchema(db);

    expect(isRestrictiveMemoryAuthoritySnapshotCurrent(beforeQuarantine)).toBe(false);
    expect(isRestrictiveMemoryAuthoritySnapshotDurablyCurrent(beforeQuarantine)).toBe(false);
    expect(isMemoryProjectionSnapshotCurrent(beforeQuarantine)).toBe(false);
    expect(isMemoryProjectionSnapshotDurablyCurrent(beforeQuarantine)).toBe(false);
    expect(
      db.getAllSync<{ status: string; outcome_code: string }>(
        `SELECT status, outcome_code
           FROM memory_ingestion_jobs
          WHERE thread_id = 'conflicting-source-thread'`,
      ),
    ).toEqual([{ status: 'failed', outcome_code: 'source_identity_conflict' }]);
    expect(
      db.getFirstSync<{ deleted_at: number | null }>(
        'SELECT deleted_at FROM memory_episodes WHERE id = ?',
        episode.id,
      )?.deleted_at,
    ).not.toBeNull();
    expect(
      db.getFirstSync(
        'SELECT episode_id FROM memory_episode_access_policies WHERE episode_id = ?',
        episode.id,
      ),
    ).toBeNull();
    expect(
      db.getFirstSync<{ count: number }>(
        'SELECT COUNT(*) AS count FROM memory_episode_terms WHERE episode_id = ?',
        episode.id,
      )?.count,
    ).toBe(0);
    expect(
      db.getFirstSync<{ deleted_at: number | null }>(
        'SELECT deleted_at FROM memory_facts WHERE id = ?',
        fact.id,
      )?.deleted_at,
    ).not.toBeNull();
    expect(
      db.getFirstSync<{ deleted_at: number | null }>(
        'SELECT deleted_at FROM memory_episodes WHERE id = ?',
        unrelatedEpisode.id,
      )?.deleted_at,
    ).toBeNull();
    expect(
      db.getFirstSync(
        'SELECT episode_id FROM memory_episode_access_policies WHERE episode_id = ?',
        unrelatedEpisode.id,
      ),
    ).toEqual({ episode_id: unrelatedEpisode.id });

    const afterQuarantine = requireAuthoritySnapshot();
    ensureIngestionQueueSchema(db);
    expect(isRestrictiveMemoryAuthoritySnapshotCurrent(afterQuarantine)).toBe(true);
    expect(isRestrictiveMemoryAuthoritySnapshotDurablyCurrent(afterQuarantine)).toBe(true);
    expect(isMemoryProjectionSnapshotCurrent(afterQuarantine)).toBe(true);
    expect(isMemoryProjectionSnapshotDurablyCurrent(afterQuarantine)).toBe(true);
  });

  it('rolls conflicting-source quarantine and restrictive authority back together', () => {
    const job = enqueueIngestionJob({
      personaId: 'default',
      threadId: 'rollback-source-thread',
      memoryConversationId: 'rollback-root-a',
      sourceStartMessageId: 'rollback-source-user',
      sourceEndMessageId: 'rollback-source-assistant',
      sourceRunId: 'rollback-source-run',
      sourceAt: 10,
      now: 10,
    })!;
    const subject = upsertEntity({ name: 'مصدر', type: 'project', now: 10 });
    const fact = recordFact({
      subjectId: subject.id,
      predicate: '状態',
      objectText: 'неоднозначно',
      scope: 'conversation',
      originConversationId: 'rollback-root-a',
      originThreadId: 'rollback-source-thread',
      sourceMessageId: 'rollback-source-user',
      sourceRunId: 'rollback-source-run',
      sourceTurnId: 'rollback-source-assistant',
      now: 10,
    }).fact;
    const db = getMemoryDb();
    db.execSync('DROP INDEX idx_ingestion_jobs_source_turn');
    db.runSync(
      `INSERT INTO memory_ingestion_jobs(
         id, thread_id, thread_title, memory_conversation_id, persona_id, task_id,
         source_run_id, chat_provider_id, chat_model, prior_user_message_id,
         source_start_message_id, source_end_message_id, source_snapshot_version,
         source_snapshot_sha256, source_snapshot_byte_length, source_at, reason,
         status, attempt_count, provider_enrichment, provider_outcome, outcome_code,
         next_attempt_at, lease_expires_at, claim_token, claim_process_epoch,
         structural_completed_at, created_at, updated_at, completed_at
       )
       SELECT ?, thread_id, thread_title, ?, persona_id, task_id, source_run_id,
              chat_provider_id, chat_model, prior_user_message_id,
              source_start_message_id, source_end_message_id, source_snapshot_version,
              source_snapshot_sha256, source_snapshot_byte_length, source_at, reason,
              status, attempt_count, provider_enrichment, provider_outcome, outcome_code,
              next_attempt_at, lease_expires_at, claim_token, claim_process_epoch,
              structural_completed_at, created_at, updated_at, completed_at
         FROM memory_ingestion_jobs
        WHERE id = ?`,
      'rollback-source-job-b',
      'rollback-root-b',
      job.id,
    );
    const beforeQuarantine = requireAuthoritySnapshot();
    const execSync = db.execSync.bind(db);
    jest.spyOn(db, 'execSync').mockImplementation((source: string) => {
      if (source.trim() === 'COMMIT') {
        const projectionRevision = db.getFirstSync<{ projection_revision: number }>(
          'SELECT projection_revision FROM memory_vault_identity WHERE singleton = 1',
        )?.projection_revision;
        if (projectionRevision === beforeQuarantine.projectionRevision.value + 1) {
          throw new Error('forced_conflict_quarantine_commit_failure');
        }
      }
      execSync(source);
    });

    expect(() => ensureIngestionQueueSchema(db)).toThrow(
      'forced_conflict_quarantine_commit_failure',
    );

    expect(isRestrictiveMemoryAuthoritySnapshotCurrent(beforeQuarantine)).toBe(true);
    expect(isRestrictiveMemoryAuthoritySnapshotDurablyCurrent(beforeQuarantine)).toBe(true);
    expect(isMemoryProjectionSnapshotCurrent(beforeQuarantine)).toBe(true);
    expect(isMemoryProjectionSnapshotDurablyCurrent(beforeQuarantine)).toBe(true);
    expect(
      db.getFirstSync<{ deleted_at: number | null }>(
        'SELECT deleted_at FROM memory_facts WHERE id = ?',
        fact.id,
      )?.deleted_at,
    ).toBeNull();
    expect(
      db.getFirstSync<{ count: number }>(
        `SELECT COUNT(*) AS count FROM memory_ingestion_jobs
          WHERE thread_id = 'rollback-source-thread'`,
      )?.count,
    ).toBe(2);
  });

  it('enqueues and deduplicates pending jobs for the same turn', () => {
    const first = enqueueIngestionJob({
      personaId: 'default',
      threadId: 'conv-1',
      sourceEndMessageId: 'assistant-1',
      sourceStartMessageId: 'user-1',
      sourceAt: 2,
    });
    const second = enqueueIngestionJob({
      personaId: 'default',
      threadId: 'conv-1',
      sourceEndMessageId: 'assistant-1',
      sourceStartMessageId: 'user-1',
      sourceAt: 2,
    });

    expect(first?.id).toBeTruthy();
    expect(second?.id).toBe(first?.id);
    expect(listPendingIngestionJobs()).toHaveLength(1);
  });

  it('does not re-enqueue a source turn after durable completion', async () => {
    const first = enqueueIngestionJob({
      personaId: 'default',
      threadId: 'conv-completed-dedupe',
      sourceStartMessageId: 'user-completed-dedupe',
      sourceEndMessageId: 'assistant-completed-dedupe',
      sourceAt: 2,
      now: 100,
    });
    await drainIngestionQueue({
      now: 100,
    });

    const replay = enqueueIngestionJob({
      personaId: 'default',
      threadId: 'conv-completed-dedupe',
      sourceStartMessageId: 'user-completed-dedupe',
      sourceEndMessageId: 'assistant-completed-dedupe',
      sourceAt: 2,
      now: 200,
    });

    expect(replay).toEqual(
      expect.objectContaining({ id: first!.id, status: 'completed_structural' }),
    );
    expect(getIngestionQueueDiagnostics().total).toBe(1);
  });

  it('keeps the source thread separate from the memory namespace while draining', async () => {
    const job = enqueueIngestionJob({
      personaId: 'default',
      threadId: 'child-conv-1',
      threadTitle: 'Shared workspace',
      memoryConversationId: 'parent-conv-1',
      sourceEndMessageId: 'assistant-1',
      sourceStartMessageId: 'user-1',
    });
    const result = await drainIngestionQueue({});

    expect(result.completed).toBe(1);
    expect(job?.threadId).toBe('child-conv-1');
    expect(job?.memoryConversationId).toBe('parent-conv-1');
    expect(mockedProcessIngestionTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        threadId: 'child-conv-1',
        memoryConversationId: 'parent-conv-1',
        episodeAccess: { personaId: 'default', shareability: 'session_threads' },
      }),
    );
    expect(
      getWorkingBlock('active_focus', {
        conversationId: 'parent-conv-1',
        threadId: 'parent-conv-1',
      })?.content,
    ).toBe('Shared workspace');
  });

  it('drains pending jobs and marks them completed', async () => {
    const job = enqueueIngestionJob({
      personaId: 'default',
      threadId: 'conv-1',
      sourceEndMessageId: 'assistant-1',
    });
    expect(job).not.toBeNull();

    const result = await drainIngestionQueue({});

    expect(result.attempted).toBe(1);
    expect(result.completed).toBe(1);
    expect(mockedProcessIngestionTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        episodeAccess: { personaId: 'default', shareability: 'session_threads' },
      }),
    );
    expect(getIngestionJob(job!.id)).toEqual(
      expect.objectContaining({
        status: 'completed_structural',
        providerOutcome: 'structural_only',
        outcomeCode: null,
        structuralCompletedAt: expect.any(Number),
      }),
    );
  });

  it('drains a job from its recorded snapshot without loaded chat history', async () => {
    const job = enqueueIngestionJob({
      personaId: 'default',
      threadId: 'conv-missing-window',
      sourceStartMessageId: 'user-missing',
      sourceEndMessageId: 'assistant-missing',
    });
    const result = await drainIngestionQueue({});

    expect(result).toEqual(
      expect.objectContaining({
        attempted: 1,
        completed: 1,
        completedStructural: 1,
        retrying: 0,
        deferred: 0,
        failed: 0,
      }),
    );
    expect(mockedProcessIngestionTurn).toHaveBeenCalledTimes(1);
    expect(getIngestionJob(job!.id)).toEqual(
      expect.objectContaining({
        status: 'completed_structural',
        attemptCount: 1,
        providerOutcome: 'structural_only',
        outcomeCode: null,
      }),
    );
  });

  it('schedules processing failures for a deterministic bounded retry', async () => {
    mockedProcessIngestionTurn.mockRejectedValueOnce(new Error('Provider timeout'));
    const job = enqueueIngestionJob({
      personaId: 'default',
      threadId: 'conv-fail',
      sourceEndMessageId: 'assistant-fail',
    });
    const result = await drainIngestionQueue({});

    expect(result.attempted).toBe(1);
    expect(result.completed).toBe(0);
    expect(result.retrying).toBe(1);
    expect(result.failed).toBe(0);
    expect(getIngestionJob(job!.id)).toEqual(
      expect.objectContaining({
        status: 'retrying',
        attemptCount: 1,
        providerOutcome: null,
        outcomeCode: 'processing_error',
        structuralCompletedAt: null,
      }),
    );
  });

  it.each(['valid', 'empty_valid'] as const)(
    'records %s provider validation separately from structural-only completion',
    async (providerStatus) => {
      mockedProcessIngestionTurn.mockImplementationOnce(
        resolveMockedIngestionTurn(processResult({ status: providerStatus })),
      );
      const job = enqueueIngestionJob({
        personaId: 'default',
        threadId: `conv-${providerStatus}`,
        sourceStartMessageId: `user-${providerStatus}`,
        sourceEndMessageId: `assistant-${providerStatus}`,
        now: 100,
      });

      const result = await drainIngestionQueue({
        now: 100,
      });

      expect(result).toEqual(
        expect.objectContaining({
          attempted: 1,
          completed: 1,
          completedStructural: 0,
          completedEnriched: 1,
        }),
      );
      expect(getIngestionJob(job!.id)).toEqual(
        expect.objectContaining({
          status: 'completed_enriched',
          providerOutcome: providerStatus,
          outcomeCode: null,
          attemptCount: 1,
          structuralCompletedAt: 100,
        }),
      );
    },
  );

  it('retries malformed provider output with a deterministic due time', async () => {
    mockedProcessIngestionTurn.mockImplementationOnce(
      resolveMockedIngestionTurn(processResult({ status: 'malformed', code: 'invalid_json' })),
    );
    const job = enqueueIngestionJob({
      personaId: 'default',
      threadId: 'conv-malformed',
      sourceStartMessageId: 'user-malformed',
      sourceEndMessageId: 'assistant-malformed',
      now: 100,
    });

    const result = await drainIngestionQueue({
      now: 100,
    });

    expect(result).toEqual(
      expect.objectContaining({ completed: 0, retrying: 1, degraded: 0, failed: 0 }),
    );
    expect(getIngestionJob(job!.id)).toEqual(
      expect.objectContaining({
        status: 'retrying',
        providerOutcome: 'malformed',
        outcomeCode: 'invalid_json',
        nextAttemptAt: 100 + INGESTION_RETRY_BASE_DELAY_MS,
        structuralCompletedAt: 100,
      }),
    );
    expect(listPendingIngestionJobs(3, 100 + INGESTION_RETRY_BASE_DELAY_MS - 1)).toHaveLength(0);
    expect(listPendingIngestionJobs(3, 100 + INGESTION_RETRY_BASE_DELAY_MS)).toEqual([
      expect.objectContaining({ id: job!.id }),
    ]);
  });

  it('degrades only after exactly the maximum provider attempts', async () => {
    const job = enqueueIngestionJob({
      personaId: 'default',
      threadId: 'conv-degraded',
      sourceStartMessageId: 'user-degraded',
      sourceEndMessageId: 'assistant-degraded',
      now: 100,
    });
    let now = 100;

    for (let attempt = 1; attempt <= 5; attempt += 1) {
      mockedProcessIngestionTurn.mockImplementationOnce(
        resolveMockedIngestionTurn(
          processResult({ status: 'schema_invalid', code: 'invalid_field_type' }),
        ),
      );
      const result = await drainIngestionQueue({
        now,
      });
      const current = getIngestionJob(job!.id)!;
      expect(current.attemptCount).toBe(attempt);
      if (attempt < 5) {
        expect(current.status).toBe('retrying');
        expect(result.retrying).toBe(1);
        now = current.nextAttemptAt!;
      } else {
        expect(current).toEqual(
          expect.objectContaining({
            status: 'degraded',
            providerOutcome: 'schema_invalid',
            outcomeCode: 'invalid_field_type',
            nextAttemptAt: null,
            completedAt: now,
            structuralCompletedAt: 100,
          }),
        );
        expect(result.degraded).toBe(1);
      }
    }
  });

  it('fails after exactly the maximum processing attempts without persisting exception text', async () => {
    const job = enqueueIngestionJob({
      personaId: 'default',
      threadId: 'conv-processing-failed',
      sourceStartMessageId: 'user-processing-failed',
      sourceEndMessageId: 'assistant-processing-failed',
      now: 100,
    });
    let now = 100;

    for (let attempt = 1; attempt <= 5; attempt += 1) {
      mockedProcessIngestionTurn.mockRejectedValueOnce(
        new Error(`sensitive provider exception ${attempt}`),
      );
      const result = await drainIngestionQueue({
        now,
      });
      const current = getIngestionJob(job!.id)!;
      expect(current.attemptCount).toBe(attempt);
      if (attempt < 5) {
        expect(current.status).toBe('retrying');
        now = current.nextAttemptAt!;
      } else {
        expect(current).toEqual(
          expect.objectContaining({
            status: 'failed',
            providerOutcome: null,
            outcomeCode: 'processing_error',
            nextAttemptAt: null,
          }),
        );
        expect(result.failed).toBe(1);
      }
    }
    expect(columnNamesForQueue()).not.toContain('error');
  });

  it('fails closed when a processed turn omits its durability callbacks', async () => {
    mockedProcessIngestionTurn.mockResolvedValueOnce(processResult({ status: 'not_requested' }));
    const job = enqueueIngestionJob({
      personaId: 'default',
      threadId: 'conv-missing-durability-receipts',
      sourceStartMessageId: 'user-missing-durability-receipts',
      sourceEndMessageId: 'assistant-missing-durability-receipts',
      now: 100,
    })!;

    await expect(drainIngestionQueue({ now: 100 })).resolves.toEqual(
      expect.objectContaining({ completed: 0, retrying: 1 }),
    );
    expect(getIngestionJob(job.id)).toEqual(
      expect.objectContaining({
        status: 'retrying',
        outcomeCode: 'processing_error',
        structuralCompletedAt: null,
      }),
    );
    expect(listIngestionDurabilityReceipts(job.id)).toEqual([]);
  });
});
