import type {
  IngestionJobStatus,
  IngestionOutcomeCode,
  IngestionProviderOutcome,
} from '../../services/memory/ingestionQueueStore';
import type { IngestionReceiptProviderOutcomeCode } from '../../services/memory/ingestionReceiptStore';
import type {
  ForegroundScenarioMemoryFinalState,
  ForegroundScenarioMemorySnapshot,
  ForegroundScenarioMemoryTurnEvidence,
} from './foregroundScenarioDriverTypes';
import type { E2EScenarioTurnTrace } from './types';
import {
  E2E_PUBLIC_INGESTION_JOB_STATUSES,
  E2E_PUBLIC_INGESTION_OUTCOME_CODES,
  E2E_PUBLIC_INGESTION_PROVIDER_OUTCOMES,
  E2E_PUBLIC_INGESTION_RECEIPT_OUTCOME_CODES,
} from './e2eTraceMemoryPolicy';

export type E2ERedactedEnumCount<T extends string> = {
  value: T;
  count: number;
};

export type E2ERedactedMemoryCollectionDelta = {
  createdCount: number;
  updatedCount: number;
  removedCount: number;
};

export type E2ERedactedMemoryIngestionEvidence = {
  jobCount: number;
  statusCounts: E2ERedactedEnumCount<IngestionJobStatus>[];
  providerOutcomeCounts: E2ERedactedEnumCount<IngestionProviderOutcome>[];
  outcomeCodeCounts: E2ERedactedEnumCount<IngestionOutcomeCode>[];
};

export type E2ERedactedMemoryDeltaEvidence = {
  facts: E2ERedactedMemoryCollectionDelta;
  episodes: E2ERedactedMemoryCollectionDelta;
  workingBlocks: E2ERedactedMemoryCollectionDelta;
  ingestionJobs: E2ERedactedMemoryCollectionDelta;
  invalidatedFactCount: number;
  deletedFactCount: number;
  deletedEpisodeCount: number;
  clearedWorkingBlockCount: number;
  completedIngestionJobCount: number;
  ingestion: E2ERedactedMemoryIngestionEvidence;
  persistenceReceipts: E2ERedactedMemoryReceiptEvidence;
};

export type E2ERedactedMemoryReceiptEvidence = {
  receiptCount: number;
  maxAttemptNumber: number;
  episodeCount: number;
  deterministicFactCount: number;
  providerFactCount: number;
  invalidatedFactCount: number;
  bridgedEvidenceFactCount: number;
  agentRunMemoryFactCount: number;
  activeFocusUpdateCount: number;
  openThreadsUpdateCount: number;
  providerOutcomeCounts: E2ERedactedEnumCount<IngestionProviderOutcome>[];
  providerOutcomeCodeCounts: E2ERedactedEnumCount<IngestionReceiptProviderOutcomeCode>[];
};

export type E2ERedactedMemoryFinalEvidence = {
  factCount: number;
  activeFactCount: number;
  invalidatedFactCount: number;
  deletedFactCount: number;
  episodeCount: number;
  activeEpisodeCount: number;
  deletedEpisodeCount: number;
  workingBlockCount: number;
  populatedWorkingBlockCount: number;
  ingestion: E2ERedactedMemoryIngestionEvidence;
};

const INGESTION_JOB_STATUSES = new Set<IngestionJobStatus>(
  E2E_PUBLIC_INGESTION_JOB_STATUSES,
);
const INGESTION_PROVIDER_OUTCOMES = new Set<IngestionProviderOutcome>(
  E2E_PUBLIC_INGESTION_PROVIDER_OUTCOMES,
);
const INGESTION_OUTCOME_CODES = new Set<IngestionOutcomeCode>(
  E2E_PUBLIC_INGESTION_OUTCOME_CODES,
);
const INGESTION_RECEIPT_OUTCOME_CODES = new Set<IngestionReceiptProviderOutcomeCode>(
  E2E_PUBLIC_INGESTION_RECEIPT_OUTCOME_CODES,
);

type IngestionState = {
  status: string;
  providerOutcome: string | null;
  outcomeCode: string | null;
};

function enumCounts<T extends string>(
  values: ReadonlyArray<string | null>,
  allowed: ReadonlySet<T>,
): E2ERedactedEnumCount<T>[] {
  const counts = new Map<T, number>();
  for (const value of values) {
    if (value === null || !allowed.has(value as T)) continue;
    const typedValue = value as T;
    counts.set(typedValue, (counts.get(typedValue) ?? 0) + 1);
  }
  return Array.from(counts, ([value, count]) => ({ value, count })).sort((left, right) =>
    left.value.localeCompare(right.value),
  );
}

function buildIngestionEvidence(
  jobs: ReadonlyArray<IngestionState>,
): E2ERedactedMemoryIngestionEvidence {
  return {
    jobCount: jobs.length,
    statusCounts: enumCounts(
      jobs.map((job) => job.status),
      INGESTION_JOB_STATUSES,
    ),
    providerOutcomeCounts: enumCounts(
      jobs.map((job) => job.providerOutcome),
      INGESTION_PROVIDER_OUTCOMES,
    ),
    outcomeCodeCounts: enumCounts(
      jobs.map((job) => job.outcomeCode),
      INGESTION_OUTCOME_CODES,
    ),
  };
}

function buildCollectionDelta(
  delta: ForegroundScenarioMemoryTurnEvidence['delta']['facts'],
): E2ERedactedMemoryCollectionDelta {
  return {
    createdCount: delta.createdIds.length,
    updatedCount: delta.updatedIds.length,
    removedCount: delta.removedIds.length,
  };
}

function sumReceiptArrayLengths(
  receipts: ForegroundScenarioMemorySnapshot['receipts'],
  key:
    | 'deterministicFactIds'
    | 'providerFactIds'
    | 'invalidatedFactIds'
    | 'bridgedEvidenceFactIds'
    | 'agentRunMemoryFactIds',
): number {
  return receipts.reduce((sum, receipt) => sum + receipt[key].length, 0);
}

function buildMemoryReceiptEvidence(
  receipts: ForegroundScenarioMemorySnapshot['receipts'],
): E2ERedactedMemoryReceiptEvidence {
  return {
    receiptCount: receipts.length,
    maxAttemptNumber: receipts.reduce(
      (maximum, receipt) => Math.max(maximum, receipt.attemptNumber),
      0,
    ),
    episodeCount: receipts.filter((receipt) => receipt.episodeId !== null).length,
    deterministicFactCount: sumReceiptArrayLengths(receipts, 'deterministicFactIds'),
    providerFactCount: sumReceiptArrayLengths(receipts, 'providerFactIds'),
    invalidatedFactCount: sumReceiptArrayLengths(receipts, 'invalidatedFactIds'),
    bridgedEvidenceFactCount: sumReceiptArrayLengths(receipts, 'bridgedEvidenceFactIds'),
    agentRunMemoryFactCount: sumReceiptArrayLengths(receipts, 'agentRunMemoryFactIds'),
    activeFocusUpdateCount: receipts.filter((receipt) => receipt.activeFocusUpdated).length,
    openThreadsUpdateCount: receipts.filter((receipt) => receipt.openThreadsUpdated).length,
    providerOutcomeCounts: enumCounts(
      receipts.map((receipt) => receipt.providerOutcome),
      INGESTION_PROVIDER_OUTCOMES,
    ),
    providerOutcomeCodeCounts: enumCounts(
      receipts.map((receipt) => receipt.providerOutcomeCode),
      INGESTION_RECEIPT_OUTCOME_CODES,
    ),
  };
}

export function buildMemoryDeltaEvidence(
  turn: E2EScenarioTurnTrace,
): E2ERedactedMemoryDeltaEvidence {
  const delta = turn.memoryEvidence.delta;
  const jobs = turn.memory
    .map((record) => record.job)
    .filter((job): job is NonNullable<typeof job> => job !== null);
  const receipts = turn.memory.flatMap((record) => record.receipts);
  return {
    facts: buildCollectionDelta(delta.facts),
    episodes: buildCollectionDelta(delta.episodes),
    workingBlocks: buildCollectionDelta(delta.workingBlocks),
    ingestionJobs: buildCollectionDelta(delta.ingestionJobs),
    invalidatedFactCount: delta.invalidatedFactIds.length,
    deletedFactCount: delta.deletedFactIds.length,
    deletedEpisodeCount: delta.deletedEpisodeIds.length,
    clearedWorkingBlockCount: delta.clearedWorkingBlockIds.length,
    completedIngestionJobCount: delta.completedIngestionJobIds.length,
    ingestion: buildIngestionEvidence(jobs),
    persistenceReceipts: buildMemoryReceiptEvidence(receipts),
  };
}

export function buildMemoryFinalEvidence(
  state: ForegroundScenarioMemoryFinalState,
): E2ERedactedMemoryFinalEvidence {
  return {
    factCount: state.facts.length,
    activeFactCount: state.facts.filter(
      (fact) => fact.invalidAt === null && fact.deletedAt === null,
    ).length,
    invalidatedFactCount: state.facts.filter((fact) => fact.invalidAt !== null).length,
    deletedFactCount: state.facts.filter((fact) => fact.deletedAt !== null).length,
    episodeCount: state.episodes.length,
    activeEpisodeCount: state.episodes.filter((episode) => episode.deletedAt === null).length,
    deletedEpisodeCount: state.episodes.filter((episode) => episode.deletedAt !== null).length,
    workingBlockCount: state.workingBlocks.length,
    populatedWorkingBlockCount: state.workingBlocks.filter((block) => block.content.length > 0).length,
    ingestion: buildIngestionEvidence(state.ingestionJobs),
  };
}
