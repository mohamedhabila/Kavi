jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import { listEpisodes } from '../../../src/services/memory/episodes/queries';
import { listFacts } from '../../../src/services/memory/facts/queries';
import {
  commitIngestionPersistenceReceipt,
  listIngestionPersistenceReceipts,
} from '../../../src/services/memory/ingestionReceiptStore';
import { __resetIngestionQueueForTests } from '../../../src/services/memory/ingestionQueue';
import { recoverStaleIngestionJobs } from '../../../src/services/memory/ingestionQueueRecovery';
import {
  claimIngestionJob,
  enqueueIngestionJob as enqueueStrictIngestionJob,
  getIngestionJob,
  INGESTION_PROCESSING_LEASE_MS,
  markIngestionJobStructuralComplete,
  ownsIngestionClaim,
  type IngestionJob,
  type IngestionProviderOutcome,
} from '../../../src/services/memory/ingestionQueueStore';
import { waitForNextTurnMemoryConsistency } from '../../../src/services/memory/nextTurnConsistency';
import {
  ensureFactSchema,
  resetFactSchemaCacheForTests,
} from '../../../src/services/memory/schema';
import { closeMemoryDb, getMemoryDb } from '../../../src/services/memory/database';
import {
  processIngestionTurn,
  type TurnPersistenceReceipt,
  type TurnProviderOutcome,
} from '../../../src/services/memory/turnProcessor';
import { useSettingsStore } from '../../../src/store/useSettingsStore';
import { initializeMemoryPolicyObservation } from '../../../src/services/memory/policy';
import type { Message } from '../../../src/types/message';
import { createTestIngestionJobEnqueuer } from '../../helpers/ingestionSourceSnapshotFixture';

const enqueueIngestionJob = createTestIngestionJobEnqueuer(enqueueStrictIngestionJob);

const expoSqlite = require('expo-sqlite') as { __resetExpoSqliteForTests: () => void };

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolver) => {
    resolve = resolver;
  });
  return { promise, resolve };
}

function closedToolTurn(suffix: string): Message[] {
  return [
    {
      id: `user-${suffix}`,
      role: 'user',
      content: 'Create the release manifest.',
      timestamp: 90,
    },
    {
      id: `assistant-tool-${suffix}`,
      role: 'assistant',
      content: '',
      timestamp: 91,
      toolCalls: [
        {
          id: `tool-call-${suffix}`,
          name: 'write_file',
          arguments: JSON.stringify({ path: 'dist/release-manifest.json' }),
        },
      ],
      assistantMetadata: {
        kind: 'intermediate',
        completionStatus: 'complete',
        finishReason: 'tool_calls',
      },
    },
    {
      id: `tool-result-${suffix}`,
      role: 'tool',
      content: 'ok',
      timestamp: 92,
      toolCallId: `tool-call-${suffix}`,
    },
    {
      id: `assistant-${suffix}`,
      role: 'assistant',
      content: 'The manifest is ready.',
      timestamp: 93,
      assistantMetadata: {
        kind: 'final',
        completionStatus: 'complete',
        finishReason: 'stop',
      },
    },
  ];
}

function providerPayload(value: string): string {
  return JSON.stringify({
    new_facts: [
      {
        version: 1,
        subject_ref: { kind: 'self' },
        predicate: 'provider_confirmation',
        value,
        scope: 'conversation',
        importance: 0.5,
        confidence: 0.9,
        source_message_id: 'wrong-source',
        operation: 'record',
        assertion_class: 'current_direct',
        evidence_quote: value,
        sensitivity: 'normal',
      },
    ],
    episode_summary: `Provider confirmed ${value}.`,
    active_focus: null,
    open_threads: [],
    notable: [],
  });
}

const GRAPH_EVIDENCE = [
  `agent:${JSON.stringify({
    trajectory_id: 'run-structural-consistency',
    state_index: 1,
    observation: 'The manifest exists.',
    toolName: 'browser_state',
    status: 'completed',
  })}`,
  'verified release manifest exists',
];

function receiptOutcome(outcome: TurnProviderOutcome): {
  providerOutcome: IngestionProviderOutcome;
  providerOutcomeCode:
    | Exclude<TurnProviderOutcome, { status: 'not_requested' | 'valid' | 'empty_valid' }>['code']
    | null;
} {
  if (outcome.status === 'not_requested') {
    return { providerOutcome: 'structural_only', providerOutcomeCode: null };
  }
  if (outcome.status === 'valid' || outcome.status === 'empty_valid') {
    return { providerOutcome: outcome.status, providerOutcomeCode: null };
  }
  return { providerOutcome: outcome.status, providerOutcomeCode: outcome.code };
}

function processClaimedTurn(input: {
  job: IngestionJob;
  claimToken: string;
  claimNow: () => number;
  messages: Message[];
  extractor: (prompt: string) => Promise<string>;
}) {
  return processIngestionTurn({
    episodeAccess: { personaId: 'default', shareability: 'thread_only' },
    threadId: input.job.threadId,
    memoryConversationId: input.job.memoryConversationId,
    messages: input.messages,
    sourceEndMessageId: input.job.sourceEndMessageId,
    extractor: input.extractor,
    graphGoalEvidence: GRAPH_EVIDENCE,
    sourceRunId: 'run-structural-consistency',
    now: input.job.sourceAt,
    canPersist: () => ownsIngestionClaim(input.job.id, input.claimToken, input.claimNow()),
    commitStructuralCheckpoint: () =>
      markIngestionJobStructuralComplete(input.job.id, input.claimNow(), input.claimToken),
    commitPersistenceReceipt: (receipt: TurnPersistenceReceipt) => {
      commitIngestionPersistenceReceipt({
        ...receipt,
        ...receiptOutcome(receipt.providerOutcome),
        jobId: input.job.id,
        claimToken: input.claimToken,
        persistedAt: input.claimNow(),
      });
    },
  });
}

function scopedFacts(job: IngestionJob) {
  return listFacts({
    originConversationId: job.memoryConversationId,
    includeDeleted: true,
    includeInvalidated: true,
    includeExpired: true,
    limit: 500,
  });
}

function evidenceRowCount(): number {
  return (
    getMemoryDb().getFirstSync<{ count: number }>(
      'SELECT COUNT(*) AS count FROM memory_fact_evidence',
    )?.count ?? 0
  );
}

beforeEach(() => {
  closeMemoryDb();
  expoSqlite.__resetExpoSqliteForTests();
  resetFactSchemaCacheForTests();
  ensureFactSchema();
  __resetIngestionQueueForTests();
  initializeMemoryPolicyObservation();
  useSettingsStore.setState({ disableLongTermMemory: false } as never);
});

afterEach(() => {
  useSettingsStore.setState({ disableLongTermMemory: false } as never);
  __resetIngestionQueueForTests();
  closeMemoryDb();
});

describe('slow provider structural consistency', () => {
  it('makes every provider-independent lane readable before enrichment settles', async () => {
    const messages = closedToolTurn('slow');
    const job = enqueueIngestionJob({
      personaId: 'default',
      threadId: 'thread-slow-provider',
      threadTitle: null,
      memoryConversationId: 'memory-slow-provider',
      taskId: null,
      sourceStartMessageId: messages[0].id,
      sourceEndMessageId: messages.at(-1)!.id,
      sourceRunId: 'run-structural-consistency',
      sourceAt: 100,
      chatProviderId: null,
      chatModel: null,
      reason: 'turn_completed',
      providerEnrichment: true,
      now: 100,
    })!;
    const claimToken = claimIngestionJob(job.id, 100)!;
    const provider = deferred<string>();
    const extractor = jest.fn(() => provider.promise);

    const processing = processClaimedTurn({
      job,
      claimToken,
      claimNow: () => 100,
      messages,
      extractor,
    });

    expect(extractor).toHaveBeenCalledTimes(1);
    const checkpointedJob = getIngestionJob(job.id)!;
    expect(checkpointedJob).toMatchObject({
      status: 'processing',
      structuralCompletedAt: 100,
    });
    const episodesBeforeProvider = listEpisodes({
      conversationId: job.memoryConversationId,
      threadId: job.threadId,
    });
    const factsBeforeProvider = scopedFacts(job);
    expect(episodesBeforeProvider).toHaveLength(1);
    expect(factsBeforeProvider.some((fact) => fact.predicate === 'file_operation')).toBe(true);
    expect(factsBeforeProvider.some((fact) => fact.memoryKind === 'agent_run')).toBe(true);
    expect(factsBeforeProvider.some((fact) => fact.memoryKind === 'evidence_span')).toBe(true);
    expect(
      factsBeforeProvider.some((fact) => fact.objectText.includes('release manifest exists')),
    ).toBe(true);
    expect(listIngestionPersistenceReceipts(job.id)).toEqual([]);

    const wait = jest.fn(async () => undefined);
    await expect(
      waitForNextTurnMemoryConsistency({
        memoryConversationId: job.memoryConversationId,
        sourceThreadId: job.threadId,
        sourceEndMessageId: job.sourceEndMessageId,
        clock: { now: () => 100, wait },
      }),
    ).resolves.toMatchObject({
      outcome: 'completed',
      waitedMs: 0,
      finalJobStatus: 'processing',
    });
    expect(wait).not.toHaveBeenCalled();

    provider.resolve(providerPayload('stable'));
    const result = await processing;
    expect(result).toMatchObject({ processed: true, enriched: true });
    expect(getIngestionJob(job.id)).toMatchObject({ status: 'completed_enriched' });
    const receipts = listIngestionPersistenceReceipts(job.id);
    expect(receipts).toHaveLength(1);
    expect(receipts[0]).toMatchObject({
      attemptNumber: 1,
      episodeId: episodesBeforeProvider[0].id,
      deterministicFactIds: result.deterministicFactIds,
      providerFactIds: result.providerFactIds,
      bridgedEvidenceFactIds: result.bridgedEvidenceFactIds,
      agentRunMemoryFactIds: result.agentRunMemoryFactIds,
      providerOutcome: 'valid',
    });
    const finalFacts = scopedFacts(job);
    expect(result.providerFactIds).toEqual([]);
    expect(finalFacts.some((fact) => fact.objectText === 'stable')).toBe(false);
    expect(new Set(finalFacts.map((fact) => fact.id)).size).toBe(finalFacts.length);
    expect(listEpisodes({ conversationId: job.memoryConversationId })).toHaveLength(1);
  });

  it('reconciles a checkpoint gap on retry without duplicate memory or a stale-owner receipt', async () => {
    const messages = closedToolTurn('retry');
    const job = enqueueIngestionJob({
      personaId: 'default',
      threadId: 'thread-checkpoint-retry',
      threadTitle: null,
      memoryConversationId: 'memory-checkpoint-retry',
      taskId: null,
      sourceStartMessageId: messages[0].id,
      sourceEndMessageId: messages.at(-1)!.id,
      sourceRunId: 'run-structural-consistency',
      sourceAt: 100,
      chatProviderId: null,
      chatModel: null,
      reason: 'turn_completed',
      providerEnrichment: true,
      now: 100,
    })!;
    const firstClaim = claimIngestionJob(job.id, 100)!;
    const firstProvider = deferred<string>();
    let firstClaimNow = 100;
    const firstProcessing = processClaimedTurn({
      job,
      claimToken: firstClaim,
      claimNow: () => firstClaimNow,
      messages,
      extractor: () => firstProvider.promise,
    });
    const structuralFactIds = scopedFacts(job).map((fact) => fact.id);
    const structuralEvidenceRows = evidenceRowCount();
    expect(structuralFactIds.length).toBeGreaterThan(2);
    expect(listEpisodes({ conversationId: job.memoryConversationId })).toHaveLength(1);

    const staleAt = 100 + INGESTION_PROCESSING_LEASE_MS;
    expect(recoverStaleIngestionJobs(staleAt)).toEqual({
      retrying: 1,
      degraded: 0,
      failed: 0,
    });
    const retrying = getIngestionJob(job.id)!;
    expect(retrying).toMatchObject({ status: 'retrying', structuralCompletedAt: 100 });
    await expect(
      waitForNextTurnMemoryConsistency({
        memoryConversationId: job.memoryConversationId,
        sourceThreadId: job.threadId,
        sourceEndMessageId: job.sourceEndMessageId,
        clock: { now: () => staleAt, wait: async () => undefined },
      }),
    ).resolves.toMatchObject({ outcome: 'completed', finalJobStatus: 'retrying' });

    const retryAt = retrying.nextAttemptAt!;
    const secondClaim = claimIngestionJob(job.id, retryAt)!;
    const retryResult = await processClaimedTurn({
      job,
      claimToken: secondClaim,
      claimNow: () => retryAt,
      messages,
      extractor: async () => providerPayload('retry-owner'),
    });
    expect(retryResult).toMatchObject({ processed: true, enriched: true });
    const [receipt] = listIngestionPersistenceReceipts(job.id);
    expect(receipt).toMatchObject({ attemptNumber: 2, providerOutcome: 'valid' });
    expect(receipt!.deterministicFactIds.length).toBeGreaterThan(0);
    expect(receipt!.agentRunMemoryFactIds.length).toBeGreaterThan(0);
    expect(receipt!.bridgedEvidenceFactIds.length).toBeGreaterThan(0);
    expect(listIngestionPersistenceReceipts(job.id)).toHaveLength(1);
    expect(listEpisodes({ conversationId: job.memoryConversationId })).toHaveLength(1);
    const afterRetry = scopedFacts(job);
    expect(structuralFactIds.every((id) => afterRetry.some((fact) => fact.id === id))).toBe(true);
    expect(new Set(afterRetry.map((fact) => fact.id)).size).toBe(afterRetry.length);
    expect(evidenceRowCount()).toBe(structuralEvidenceRows + retryResult.providerFactIds.length);

    const factCountAfterRetry = afterRetry.length;
    const evidenceCountAfterRetry = evidenceRowCount();
    firstClaimNow = retryAt;
    firstProvider.resolve(providerPayload('stale-owner'));
    await expect(firstProcessing).resolves.toMatchObject({
      processed: false,
      skipped: 'claim_lost',
    });
    expect(scopedFacts(job)).toHaveLength(factCountAfterRetry);
    expect(evidenceRowCount()).toBe(evidenceCountAfterRetry);
    expect(scopedFacts(job).some((fact) => fact.objectText === 'stale-owner')).toBe(false);
    expect(listIngestionPersistenceReceipts(job.id)).toHaveLength(1);
  });

  it('keeps the committed structural checkpoint but rejects provider writes after opt-out', async () => {
    const messages = closedToolTurn('opt-out');
    const job = enqueueIngestionJob({
      personaId: 'default',
      threadId: 'thread-checkpoint-opt-out',
      threadTitle: null,
      memoryConversationId: 'memory-checkpoint-opt-out',
      taskId: null,
      sourceStartMessageId: messages[0].id,
      sourceEndMessageId: messages.at(-1)!.id,
      sourceRunId: null,
      sourceAt: 100,
      chatProviderId: null,
      chatModel: null,
      reason: 'turn_completed',
      providerEnrichment: true,
      now: 100,
    })!;
    const claimToken = claimIngestionJob(job.id, 100)!;
    const provider = deferred<string>();
    const processing = processClaimedTurn({
      job,
      claimToken,
      claimNow: () => 100,
      messages,
      extractor: () => provider.promise,
    });
    const structuralIds = scopedFacts(job).map((fact) => fact.id);
    expect(structuralIds.length).toBeGreaterThan(0);

    useSettingsStore.setState({ disableLongTermMemory: true } as never);
    provider.resolve(providerPayload('must-not-persist'));
    await expect(processing).resolves.toMatchObject({
      processed: false,
      skipped: 'opt_out',
    });

    expect(scopedFacts(job).map((fact) => fact.id)).toEqual(structuralIds);
    expect(scopedFacts(job).some((fact) => fact.objectText === 'must-not-persist')).toBe(false);
    expect(listEpisodes({ conversationId: job.memoryConversationId })).toHaveLength(1);
    expect(getIngestionJob(job.id)).toBeNull();
    expect(listIngestionPersistenceReceipts(job.id)).toEqual([]);
  });
});
