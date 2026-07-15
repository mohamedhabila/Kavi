jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import { closeMemoryDb, getMemoryDb } from '../../../src/services/memory/database';
import { commitIngestionPersistenceReceipt } from '../../../src/services/memory/ingestionReceiptStore';
import {
  commitIngestionStructuralCheckpointReceipt,
  getIngestionStructuralCheckpointReceipt,
  IngestionStructuralReceiptCommitError,
  listIngestionDurabilityReceipts,
  listIngestionStructuralCheckpointReceipts,
} from '../../../src/services/memory/ingestionStructuralReceiptStore';
import {
  claimIngestionJob,
  enqueueIngestionJob,
  getIngestionJob,
} from '../../../src/services/memory/ingestionQueueStore';
import { encodeIngestionSourceSnapshot } from '../../../src/services/memory/ingestionSourceSnapshot';
import {
  ensureFactSchema,
  resetFactSchemaCacheForTests,
} from '../../../src/services/memory/schema';

const expoSqlite = require('expo-sqlite') as { __resetExpoSqliteForTests: () => void };

const SOURCE = {
  threadId: '会話-استمرارية-🧭',
  memoryConversationId: 'ذاكرة-継続-🧠',
  personaId: 'شخصية-利用者',
  taskId: 'مهمة-完了',
  sourceRunId: 'تشغيل-実行-١',
  sourceStartMessageId: 'مستخدم-開始-🟢',
  sourceEndMessageId: 'مساعد-完了-✅',
} as const;

function enqueueAndClaim(now = 100): { jobId: string; claimToken: string } {
  const sourceSnapshot = encodeIngestionSourceSnapshot({
    messages: [
      {
        id: SOURCE.sourceStartMessageId,
        role: 'user',
        content: 'أنشئ النتيجة ثم احتفظ بحالة الإنجاز. 完了状態を保持してください。',
        timestamp: now,
      },
      {
        id: SOURCE.sourceEndMessageId,
        role: 'assistant',
        content: 'تم التنفيذ. 実行済み。',
        timestamp: now + 1,
        assistantMetadata: {
          kind: 'final',
          completionStatus: 'complete',
          finishReason: 'stop',
        },
      },
    ],
    sourceStartMessageId: SOURCE.sourceStartMessageId,
    sourceEndMessageId: SOURCE.sourceEndMessageId,
    priorUserMessageId: null,
  });
  const job = enqueueIngestionJob({
    ...SOURCE,
    threadTitle: 'متابعة الإنجاز — 完了追跡',
    sourceSnapshot,
    priorUserMessageId: null,
    sourceAt: now + 1,
    chatProviderId: null,
    chatModel: null,
    reason: 'turn_completed',
    providerEnrichment: true,
    now,
  })!;
  const claimToken = claimIngestionJob(job.id, now + 1)!;
  return { jobId: job.id, claimToken };
}

function structuralInput(jobId: string, claimToken: string, persistedAt = 102) {
  return {
    jobId,
    claimToken,
    episodeId: 'حلقة-episode-١',
    deterministicFactIds: ['حقيقة-構造-١'],
    providerFactIds: [],
    invalidatedFactIds: [],
    bridgedEvidenceFactIds: ['دليل-証拠-١'],
    agentRunMemoryFactIds: ['تشغيل-記憶-١'],
    activeFocusUpdated: false,
    openThreadsUpdated: false,
    persistedAt,
  } as const;
}

beforeEach(() => {
  closeMemoryDb();
  expoSqlite.__resetExpoSqliteForTests();
  resetFactSchemaCacheForTests();
  ensureFactSchema();
});

afterEach(() => closeMemoryDb());

describe('structural checkpoint durability receipts', () => {
  it('survives a database reopen with its exact opaque source and write set', () => {
    const { jobId, claimToken } = enqueueAndClaim();
    const receipt = commitIngestionStructuralCheckpointReceipt(
      structuralInput(jobId, claimToken),
    );

    expect(receipt).toMatchObject({
      phase: 'structural_checkpoint',
      jobId,
      attemptNumber: 1,
      source: {
        memoryConversationId: SOURCE.memoryConversationId,
        sourceThreadId: SOURCE.threadId,
        personaId: SOURCE.personaId,
        taskId: SOURCE.taskId,
        sourceRunId: SOURCE.sourceRunId,
        sourceStartMessageId: SOURCE.sourceStartMessageId,
        sourceEndMessageId: SOURCE.sourceEndMessageId,
      },
      deterministicFactIds: ['حقيقة-構造-١'],
      bridgedEvidenceFactIds: ['دليل-証拠-١'],
      agentRunMemoryFactIds: ['تشغيل-記憶-١'],
      persistedAt: 102,
    });
    expect(receipt.source.sourceSnapshotSha256).toMatch(/^[0-9a-f]{64}$/u);
    expect(getIngestionJob(jobId)).toMatchObject({
      status: 'processing',
      structuralCompletedAt: 102,
    });

    closeMemoryDb();
    resetFactSchemaCacheForTests();
    ensureFactSchema();

    expect(getIngestionStructuralCheckpointReceipt(jobId, 1)).toEqual(receipt);
    expect(listIngestionDurabilityReceipts(jobId)).toEqual([receipt]);
  });

  it('keeps structural and provider-final phases distinct without overwrite', () => {
    const { jobId, claimToken } = enqueueAndClaim();
    const structural = commitIngestionStructuralCheckpointReceipt(
      structuralInput(jobId, claimToken),
    );
    const providerFinal = commitIngestionPersistenceReceipt({
      jobId,
      claimToken,
      episodeId: structural.episodeId,
      deterministicFactIds: structural.deterministicFactIds,
      providerFactIds: ['حقيقة-مزود-提供-١'],
      invalidatedFactIds: structural.invalidatedFactIds,
      bridgedEvidenceFactIds: structural.bridgedEvidenceFactIds,
      agentRunMemoryFactIds: structural.agentRunMemoryFactIds,
      activeFocusUpdated: structural.activeFocusUpdated,
      openThreadsUpdated: structural.openThreadsUpdated,
      providerOutcome: 'valid',
      providerOutcomeCode: null,
      persistedAt: 103,
    });

    expect(listIngestionDurabilityReceipts(jobId)).toEqual([
      structural,
      { ...providerFinal, phase: 'provider_final' },
    ]);
    expect(getIngestionStructuralCheckpointReceipt(jobId, 1)).toEqual(structural);
    expect(getIngestionJob(jobId)).toMatchObject({ status: 'completed_enriched' });
    expect(() =>
      getMemoryDb().runSync(
        `UPDATE memory_ingestion_structural_receipts
            SET persisted_at = persisted_at + 1
          WHERE job_id = ? AND attempt_number = 1`,
        jobId,
      ),
    ).toThrow('memory_ingestion_structural_receipt_immutable');
  });

  it('fails closed on a conflicting same-phase replay', () => {
    const { jobId, claimToken } = enqueueAndClaim();
    const input = structuralInput(jobId, claimToken);
    expect(commitIngestionStructuralCheckpointReceipt(input)).toEqual(
      commitIngestionStructuralCheckpointReceipt(input),
    );

    expect(() =>
      commitIngestionStructuralCheckpointReceipt({
        ...input,
        deterministicFactIds: ['حقيقة-مختلفة-別'],
      }),
    ).toThrow(
      expect.objectContaining<Partial<IngestionStructuralReceiptCommitError>>({
        code: 'identity_conflict',
      }),
    );
    expect(listIngestionStructuralCheckpointReceipts(jobId)).toHaveLength(1);
  });

  it('reuses a stronger immutable receipt for a no-op replay of the same attempt', () => {
    const { jobId, claimToken } = enqueueAndClaim();
    const first = commitIngestionStructuralCheckpointReceipt({
      ...structuralInput(jobId, claimToken, 102),
      activeFocusUpdated: true,
    });

    const replay = commitIngestionStructuralCheckpointReceipt({
      ...structuralInput(jobId, claimToken, 103),
      activeFocusUpdated: false,
    });

    expect(replay).toEqual(first);
    expect(replay.persistedAt).toBe(102);
    expect(replay.activeFocusUpdated).toBe(true);
    expect(listIngestionStructuralCheckpointReceipts(jobId)).toEqual([first]);
  });

  it('rejects a replay that would hide a newly committed working-state update', () => {
    const { jobId, claimToken } = enqueueAndClaim();
    commitIngestionStructuralCheckpointReceipt(structuralInput(jobId, claimToken, 102));

    expect(() =>
      commitIngestionStructuralCheckpointReceipt({
        ...structuralInput(jobId, claimToken, 103),
        activeFocusUpdated: true,
      }),
    ).toThrow(
      expect.objectContaining<Partial<IngestionStructuralReceiptCommitError>>({
        code: 'identity_conflict',
      }),
    );
  });
});
