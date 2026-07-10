const {
  MAX_TRACE_ITEMS,
  asRecord,
  nonNegativeInteger,
  projectArray,
  projectHash,
  projectHashArray,
  safeEnum,
} = require('./publicTracePrimitives');

const SAFE_GOAL_STATUSES = ['pending', 'active', 'completed', 'blocked'];
const SAFE_GOAL_COMPLETION_POLICIES = new Set(['blocking', 'persistent']);

function projectGoalHashesByStatus(value) {
  const source = asRecord(value);
  if (!source) {
    return null;
  }
  const projected = {};
  for (const status of SAFE_GOAL_STATUSES) {
    const hashes = projectHashArray(source[status], MAX_TRACE_ITEMS);
    if (!hashes) {
      return null;
    }
    projected[status] = hashes;
  }
  return projected;
}

function projectHashCount(value) {
  const source = asRecord(value);
  const valueHash = source ? projectHash(source.valueHash) : null;
  const count = source ? nonNegativeInteger(source.count) : null;
  return source && valueHash && count !== null ? { valueHash, count } : null;
}

function projectGoalSummary(value) {
  const source = asRecord(value);
  const goalIdHash = source ? projectHash(source.goalIdHash) : null;
  const successCriteriaCount = source ? nonNegativeInteger(source.successCriteriaCount) : null;
  const successCriteriaHashes = source ? projectHashArray(source.successCriteriaHashes) : null;
  const evidenceCount = source ? nonNegativeInteger(source.evidenceCount) : null;
  const evidenceSourceHashCounts = source
    ? projectArray(source.evidenceSourceHashCounts, projectHashCount)
    : null;
  const status = source ? safeEnum(source.status, new Set(SAFE_GOAL_STATUSES)) : undefined;
  if (
    !source ||
    !goalIdHash ||
    !status ||
    successCriteriaCount === null ||
    !successCriteriaHashes ||
    evidenceCount === null ||
    !evidenceSourceHashCounts
  ) {
    return null;
  }
  const completionPolicy = safeEnum(source.completionPolicy, SAFE_GOAL_COMPLETION_POLICIES);
  return {
    goalIdHash,
    status,
    ...(completionPolicy ? { completionPolicy } : {}),
    successCriteriaCount,
    successCriteriaHashes,
    evidenceCount,
    evidenceSourceHashCounts,
  };
}

module.exports = {
  projectGoalHashesByStatus,
  projectGoalSummary,
  projectHashCount,
};
