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
  processIngestionJob,
} from '../../../src/services/memory/ingestionQueue';
import type { EnqueueIngestionJobInput } from '../../../src/services/memory/ingestionQueue';
import { getIngestionQueueDiagnostics } from '../../../src/services/memory/ingestionQueueDiagnostics';
import { ensureIngestionQueueSchema } from '../../../src/services/memory/ingestionQueueSchema';
import { processIngestionTurn } from '../../../src/services/memory/turnProcessor';
import { __resetOnDeviceGuardsForTests } from '../../../src/services/memory/onDeviceGuards';
import {
  ensureFactSchema,
  resetFactSchemaCacheForTests,
} from '../../../src/services/memory/schema';
import { closeMemoryDb, getMemoryDb } from '../../../src/services/memory/database';
import { getRuntimeProcessEpoch } from '../../../src/services/runtimeProcessEpoch';
import { withIngestionSourceSnapshot } from '../../helpers/ingestionSourceSnapshotFixture';
import { resolveMockedIngestionTurn } from '../../helpers/ingestionQueueProcessFixture';

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

beforeEach(() => {
  jest.clearAllMocks();
  closeMemoryDb();
  expoSqlite.__resetExpoSqliteForTests();
  resetFactSchemaCacheForTests();
  ensureFactSchema();
  __resetOnDeviceGuardsForTests();
  __resetIngestionQueueForTests();
  mockedProcessIngestionTurn.mockImplementation(
    resolveMockedIngestionTurn({
      processed: true,
      episodeId: 'ep-1',
      deterministicFactIds: ['fact-1'],
      providerFactIds: [],
      invalidatedFactIds: [],
      activeFocusUpdated: true,
      openThreadsUpdated: false,
      enriched: false,
      providerOutcome: { status: 'not_requested' },
      bridgedEvidenceFactIds: [],
      agentRunMemoryFactIds: [],
    }),
  );
});

afterEach(() => {
  closeMemoryDb();
});

describe('ingestion queue identity', () => {
  it('requires exact sealed identity and never normalizes an invalid enqueue', () => {
    const valid = withIngestionSourceSnapshot({
      threadTitle: null,
      memoryConversationId: 'conv-valid',
      personaId: 'default',
      threadId: 'conv-valid',
      taskId: null,
      sourceStartMessageId: null,
      sourceEndMessageId: 'assistant-valid',
      sourceRunId: null,
      sourceAt: 1,
      chatProviderId: null,
      chatModel: null,
      reason: 'turn_completed' as const,
      providerEnrichment: true,
      now: 1,
    });
    expect(() =>
      enqueueStrictIngestionJob({
        ...valid,
        personaId: '',
        threadId: 'conv-invalid-persona',
        memoryConversationId: 'conv-invalid-persona',
        sourceEndMessageId: 'assistant-invalid-persona',
      }),
    ).toThrow('memory_ingestion_persona_scope_invalid');
    expect(() =>
      enqueueStrictIngestionJob({
        ...valid,
        personaId: undefined,
        threadId: 'conv-missing-persona',
        memoryConversationId: 'conv-missing-persona',
        sourceEndMessageId: 'assistant-missing-persona',
      } as never),
    ).toThrow('memory_ingestion_persona_scope_invalid');
    expect(() =>
      enqueueStrictIngestionJob({
        ...valid,
        personaId: 'default',
        threadId: ' conv-invalid-thread ',
        sourceEndMessageId: 'assistant-invalid-thread',
      }),
    ).toThrow('memory_ingestion_thread_scope_invalid');
    expect(() =>
      enqueueStrictIngestionJob({
        ...valid,
        personaId: 'default',
        threadId: 'conv-invalid-task',
        memoryConversationId: 'conv-invalid-task',
        taskId: ' task-invalid ',
        sourceEndMessageId: 'assistant-invalid-task',
      }),
    ).toThrow('memory_ingestion_task_scope_invalid');
    expect(() =>
      enqueueStrictIngestionJob({
        ...valid,
        personaId: 'default',
        threadId: 'conv-invalid-source',
        memoryConversationId: 'conv-invalid-source',
        sourceEndMessageId: ' assistant-invalid-source ',
      }),
    ).toThrow('memory_ingestion_source_end_invalid');
    expect(getIngestionQueueDiagnostics().total).toBe(0);
  });

  it('fails old unsealed active jobs closed while preserving completed terminal status', async () => {
    const jobs = ['pending', 'retrying', 'processing', 'completed'].map((suffix) =>
      enqueueIngestionJob({
        personaId: 'default',
        threadId: `legacy-${suffix}`,
        sourceStartMessageId: `user-legacy-${suffix}`,
        sourceEndMessageId: `assistant-legacy-${suffix}`,
        now: 1,
      }),
    );
    expect(jobs.every(Boolean)).toBe(true);
    const [pending, retrying, processing, completed] = jobs as Array<
      NonNullable<(typeof jobs)[number]>
    >;
    getMemoryDb().runSync(
      'UPDATE memory_ingestion_jobs SET persona_id = NULL WHERE id = ?',
      pending.id,
    );
    getMemoryDb().runSync(
      `UPDATE memory_ingestion_jobs
          SET persona_id = NULL, status = 'retrying', next_attempt_at = 1
        WHERE id = ?`,
      retrying.id,
    );
    getMemoryDb().runSync(
      `UPDATE memory_ingestion_jobs
          SET persona_id = NULL, status = 'processing', next_attempt_at = NULL,
              claim_token = 'legacy-claim', claim_process_epoch = ?, lease_expires_at = 100
        WHERE id = ?`,
      getRuntimeProcessEpoch(),
      processing.id,
    );
    getMemoryDb().runSync(
      `UPDATE memory_ingestion_jobs
          SET persona_id = NULL, status = 'completed_structural', next_attempt_at = NULL,
              provider_outcome = 'structural_only', structural_completed_at = 1,
              completed_at = 1
        WHERE id = ?`,
      completed.id,
    );

    ensureIngestionQueueSchema(getMemoryDb());

    for (const job of [pending, retrying, processing]) {
      expect(getIngestionJob(job.id)).toMatchObject({
        status: 'failed',
        personaId: null,
        outcomeCode: 'persona_scope_missing',
      });
    }
    expect(getIngestionJob(completed.id)).toMatchObject({
      status: 'completed_structural',
      personaId: null,
      outcomeCode: null,
    });
    await expect(
      processIngestionJob({
        jobId: completed.id,
        now: 2,
      }),
    ).resolves.toMatchObject({
      processed: false,
      status: 'completed_structural',
      skipped: 'missing_or_terminal',
    });
  });

  it('terminal-fails a corrupted persisted persona instead of retrying or adopting it', async () => {
    const job = enqueueIngestionJob({
      personaId: 'default',
      threadId: 'corrupt-persona-job',
      sourceStartMessageId: 'user-corrupt-persona',
      sourceEndMessageId: 'assistant-corrupt-persona',
      now: 1,
    });
    getMemoryDb().runSync(
      `UPDATE memory_ingestion_jobs SET persona_id = ? WHERE id = ?`,
      'corrupt\u0001persona',
      job!.id,
    );

    await expect(
      processIngestionJob({
        jobId: job!.id,
        now: 2,
      }),
    ).resolves.toMatchObject({
      processed: false,
      status: 'failed',
      skipped: 'persona_scope_missing',
    });
    expect(getIngestionJob(job!.id)).toMatchObject({
      status: 'failed',
      personaId: null,
      outcomeCode: 'persona_scope_missing',
    });
  });

  it.each([
    ['id', ' corrupt-job-id '],
    ['thread_id', ' corrupt-thread '],
    ['thread_title', 'corrupt\u0001title'],
    ['memory_conversation_id', ' corrupt-root '],
    ['task_id', ' corrupt-task '],
    ['source_run_id', 'corrupt\u0001run'],
    ['prior_user_message_id', 'corrupt\u0001prior'],
    ['source_start_message_id', 'corrupt\u0001start'],
    ['source_end_message_id', 'corrupt\u0001end'],
    ['source_at', 1.5],
  ] as const)(
    'terminal-fails a post-startup %s identity corruption before consolidation',
    async (column, corruptValue) => {
      const suffix = `corrupt-${column}`;
      const job = enqueueIngestionJob({
        personaId: 'default',
        threadId: `thread-${suffix}`,
        sourceStartMessageId: `user-${suffix}`,
        sourceEndMessageId: `assistant-${suffix}`,
        now: 1,
      })!;
      getMemoryDb().runSync(
        `UPDATE memory_ingestion_jobs SET ${column} = ? WHERE id = ?`,
        corruptValue,
        job.id,
      );
      const persistedId = column === 'id' ? String(corruptValue) : job.id;

      await expect(
        processIngestionJob({
          jobId: persistedId,
          now: 2,
        }),
      ).resolves.toEqual({
        processed: false,
        status: 'failed',
        skipped: 'source_identity_invalid',
      });
      expect(mockedProcessIngestionTurn).not.toHaveBeenCalled();
      expect(
        getMemoryDb().getFirstSync<{ status: string; outcome_code: string }>(
          'SELECT status, outcome_code FROM memory_ingestion_jobs WHERE id = ?',
          persistedId,
        ),
      ).toEqual({ status: 'failed', outcome_code: 'source_identity_invalid' });
    },
  );

  it('quarantines corrupt due jobs before processing their source snapshots', async () => {
    const job = enqueueIngestionJob({
      personaId: 'default',
      threadId: 'corrupt-before-load',
      sourceStartMessageId: 'user-corrupt-before-load',
      sourceEndMessageId: 'assistant-corrupt-before-load',
      now: 1,
    })!;
    getMemoryDb().runSync(
      'UPDATE memory_ingestion_jobs SET memory_conversation_id = ? WHERE id = ?',
      ' corrupt-root ',
      job.id,
    );
    await expect(drainIngestionQueue({ now: 2 })).resolves.toMatchObject({
      attempted: 0,
    });
    expect(getIngestionJob(job.id)).toMatchObject({
      status: 'failed',
      outcomeCode: 'source_identity_invalid',
    });
  });

  it('enforces provider pairing, reason, and enrichment policy in storage', () => {
    const job = enqueueIngestionJob({
      personaId: 'default',
      threadId: 'storage-contract',
      sourceEndMessageId: 'assistant-storage-contract',
      now: 1,
    })!;
    expect(() =>
      getMemoryDb().runSync(
        'UPDATE memory_ingestion_jobs SET chat_provider_id = ? WHERE id = ?',
        'provider-without-model',
        job.id,
      ),
    ).toThrow();
    expect(() =>
      getMemoryDb().runSync(
        'UPDATE memory_ingestion_jobs SET reason = ? WHERE id = ?',
        'unknown_reason',
        job.id,
      ),
    ).toThrow();
    expect(() =>
      getMemoryDb().runSync(
        'UPDATE memory_ingestion_jobs SET provider_enrichment = ? WHERE id = ?',
        2,
        job.id,
      ),
    ).toThrow();
  });
});
