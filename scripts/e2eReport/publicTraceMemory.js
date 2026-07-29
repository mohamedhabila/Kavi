const {
  E2E_PUBLIC_INGESTION_JOB_STATUSES,
  E2E_PUBLIC_INGESTION_OUTCOME_CODES,
  E2E_PUBLIC_INGESTION_PROVIDER_OUTCOMES,
  E2E_PUBLIC_INGESTION_RECEIPT_OUTCOME_CODES,
} = require('../../src/acceptance/e2eAgent/e2eTraceMemoryPolicy.ts');
const { asRecord, nonNegativeInteger, projectArray, safeEnum } = require('./publicTracePrimitives');

const INGESTION_JOB_STATUSES = new Set(E2E_PUBLIC_INGESTION_JOB_STATUSES);
const INGESTION_PROVIDER_OUTCOMES = new Set(E2E_PUBLIC_INGESTION_PROVIDER_OUTCOMES);
const INGESTION_OUTCOME_CODES = new Set(E2E_PUBLIC_INGESTION_OUTCOME_CODES);
const INGESTION_RECEIPT_OUTCOME_CODES = new Set(E2E_PUBLIC_INGESTION_RECEIPT_OUTCOME_CODES);

function projectEnumCount(value, allowed) {
  const source = asRecord(value);
  const enumValue = source ? safeEnum(source.value, allowed) : undefined;
  const count = source ? nonNegativeInteger(source.count) : null;
  return source && enumValue && count !== null ? { value: enumValue, count } : null;
}

function projectEnumCounts(value, allowed) {
  const projected = projectArray(value, (entry) => projectEnumCount(entry, allowed), allowed.size);
  if (!projected || new Set(projected.map((entry) => entry.value)).size !== projected.length) {
    return null;
  }
  return projected.sort((left, right) => left.value.localeCompare(right.value));
}

function projectIngestionEvidence(value) {
  const source = asRecord(value);
  const jobCount = source ? nonNegativeInteger(source.jobCount) : null;
  const statusCounts = source
    ? projectEnumCounts(source.statusCounts, INGESTION_JOB_STATUSES)
    : null;
  const providerOutcomeCounts = source
    ? projectEnumCounts(source.providerOutcomeCounts, INGESTION_PROVIDER_OUTCOMES)
    : null;
  const outcomeCodeCounts = source
    ? projectEnumCounts(source.outcomeCodeCounts, INGESTION_OUTCOME_CODES)
    : null;
  if (
    !source ||
    jobCount === null ||
    !statusCounts ||
    !providerOutcomeCounts ||
    !outcomeCodeCounts ||
    statusCounts.reduce((sum, entry) => sum + entry.count, 0) !== jobCount ||
    providerOutcomeCounts.reduce((sum, entry) => sum + entry.count, 0) > jobCount ||
    outcomeCodeCounts.reduce((sum, entry) => sum + entry.count, 0) > jobCount
  ) {
    return null;
  }
  return { jobCount, statusCounts, providerOutcomeCounts, outcomeCodeCounts };
}

function projectCollectionDelta(value) {
  const source = asRecord(value);
  if (!source) return null;
  const output = {};
  for (const key of ['createdCount', 'updatedCount', 'removedCount']) {
    const count = nonNegativeInteger(source[key]);
    if (count === null) return null;
    output[key] = count;
  }
  return output;
}

function projectMemoryDeltaEvidence(value) {
  const source = asRecord(value);
  if (!source) return null;
  const collections = {};
  for (const key of ['facts', 'episodes', 'workingBlocks', 'ingestionJobs']) {
    const collection = projectCollectionDelta(source[key]);
    if (!collection) return null;
    collections[key] = collection;
  }
  const counts = {};
  for (const key of [
    'invalidatedFactCount',
    'deletedFactCount',
    'deletedEpisodeCount',
    'clearedWorkingBlockCount',
    'completedIngestionJobCount',
  ]) {
    const count = nonNegativeInteger(source[key]);
    if (count === null) return null;
    counts[key] = count;
  }
  const ingestion = projectIngestionEvidence(source.ingestion);
  const persistenceReceipts = projectMemoryReceiptEvidence(source.persistenceReceipts);
  return ingestion && persistenceReceipts
    ? { ...collections, ...counts, ingestion, persistenceReceipts }
    : null;
}

function projectMemoryReceiptEvidence(value) {
  const source = asRecord(value);
  if (!source) return null;
  const output = {};
  for (const key of [
    'receiptCount',
    'structuralCheckpointReceiptCount',
    'providerFinalReceiptCount',
    'maxAttemptNumber',
    'episodeCount',
    'deterministicFactCount',
    'providerFactCount',
    'invalidatedFactCount',
    'bridgedEvidenceFactCount',
    'agentRunMemoryFactCount',
    'activeFocusUpdateCount',
    'openThreadsUpdateCount',
  ]) {
    const count = nonNegativeInteger(source[key]);
    if (count === null) return null;
    output[key] = count;
  }
  const providerOutcomeCounts = projectEnumCounts(
    source.providerOutcomeCounts,
    INGESTION_PROVIDER_OUTCOMES,
  );
  const providerOutcomeCodeCounts = projectEnumCounts(
    source.providerOutcomeCodeCounts,
    INGESTION_RECEIPT_OUTCOME_CODES,
  );
  if (
    !providerOutcomeCounts ||
    !providerOutcomeCodeCounts ||
    output.structuralCheckpointReceiptCount + output.providerFinalReceiptCount !==
      output.receiptCount ||
    providerOutcomeCounts.reduce((sum, entry) => sum + entry.count, 0) !==
      output.providerFinalReceiptCount ||
    providerOutcomeCodeCounts.reduce((sum, entry) => sum + entry.count, 0) >
      output.providerFinalReceiptCount ||
    output.episodeCount > output.receiptCount ||
    output.activeFocusUpdateCount > output.receiptCount ||
    output.openThreadsUpdateCount > output.receiptCount
  ) {
    return null;
  }
  return { ...output, providerOutcomeCounts, providerOutcomeCodeCounts };
}

function projectMemoryFinalEvidence(value) {
  const source = asRecord(value);
  if (!source) return null;
  const output = {};
  for (const key of [
    'factCount',
    'activeFactCount',
    'invalidatedFactCount',
    'deletedFactCount',
    'episodeCount',
    'activeEpisodeCount',
    'deletedEpisodeCount',
    'workingBlockCount',
    'populatedWorkingBlockCount',
  ]) {
    const count = nonNegativeInteger(source[key]);
    if (count === null) return null;
    output[key] = count;
  }
  if (
    output.activeFactCount > output.factCount ||
    output.invalidatedFactCount > output.factCount ||
    output.deletedFactCount > output.factCount ||
    output.activeEpisodeCount > output.episodeCount ||
    output.deletedEpisodeCount > output.episodeCount ||
    output.populatedWorkingBlockCount > output.workingBlockCount
  ) {
    return null;
  }
  const ingestion = projectIngestionEvidence(source.ingestion);
  return ingestion ? { ...output, ingestion } : null;
}

module.exports = { projectMemoryDeltaEvidence, projectMemoryFinalEvidence };
