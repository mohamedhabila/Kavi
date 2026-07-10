const {
  projectGoalHashesByStatus,
  projectGoalSummary,
  projectHashCount,
} = require('./publicTraceGoals');
const {
  asRecord,
  finiteNumber,
  nonNegativeInteger,
  projectArray,
  projectHash,
  projectHashArray,
  projectSafeToolNameArray,
  safeEnum,
  safePublicToolName,
} = require('./publicTracePrimitives');

const SAFE_GRAPH_STATUSES = new Set([
  'ready',
  'model_turn',
  'awaiting_tool_results',
  'recovering',
  'waiting_async',
  'awaiting_review',
  'blocked',
  'finalized',
  'yielded',
  'cancelled',
  'failed',
]);

const SAFE_GRAPH_AUDIT_TYPES = new Set([
  'ASYNC_WAITING',
  'BLOCKED',
  'CANCELLED',
  'COMPLETION_GATE',
  'FAILED',
  'FINALIZATION_HELD',
  'FINALIZED',
  'FINAL_CANDIDATE_READY',
  'GOALS_UPDATED',
  'GOAL_EVIDENCE_ADDED',
  'LOOP_DETECTED',
  'MEMORY_RETRIEVAL',
  'MODEL_TURN_COMPLETED',
  'MODEL_TURN_FAILED',
  'MODEL_TURN_STARTED',
  'OTHER',
  'PERFORMANCE_METRICS_RECORDED',
  'SESSION_ACTIVATED_TOOLS_UPDATED',
  'TOOL_BATCH_INCOMPLETE',
  'TOOL_RESULTS_RECORDED',
  'TOOL_RESULT_RECORDED',
  'TOOL_SURFACE_SELECTED',
  'TOOL_SURFACE_TOKEN_AUDIT',
  'TURN_DIRECTIVES_CONSUMED',
  'TURN_DIRECTIVES_RECORDED',
  'YIELDED',
]);

function projectAuditEvent(value) {
  const source = asRecord(value);
  const type = source ? safeEnum(source.type, SAFE_GRAPH_AUDIT_TYPES) : undefined;
  if (!source || !type) {
    return null;
  }
  const projected = { type };
  if (source.typeHash !== undefined) {
    const typeHash = projectHash(source.typeHash);
    if (!typeHash) {
      return null;
    }
    projected.typeHash = typeHash;
  }
  if (source.iteration !== undefined) {
    const iteration = nonNegativeInteger(source.iteration);
    if (iteration === null) {
      return null;
    }
    projected.iteration = iteration;
  }
  if (source.detailHash !== undefined) {
    const detailHash = projectHash(source.detailHash);
    if (!detailHash) {
      return null;
    }
    projected.detailHash = detailHash;
  }
  return projected;
}

function projectObservedToolResult(value) {
  const source = asRecord(value);
  const nameHash = source ? projectHash(source.nameHash) : null;
  const evidenceCount = source ? nonNegativeInteger(source.evidenceCount) : null;
  const evidenceSourceHashCounts = source
    ? projectArray(source.evidenceSourceHashCounts, projectHashCount)
    : null;
  if (
    !source ||
    !nameHash ||
    typeof source.failed !== 'boolean' ||
    typeof source.canonicalized !== 'boolean' ||
    typeof source.graphApplied !== 'boolean' ||
    evidenceCount === null ||
    !evidenceSourceHashCounts
  ) {
    return null;
  }
  const name = safePublicToolName(source.name);
  return {
    ...(name ? { name } : {}),
    nameHash,
    failed: source.failed,
    canonicalized: source.canonicalized,
    graphApplied: source.graphApplied,
    evidenceCount,
    evidenceSourceHashCounts,
  };
}

function projectPerformance(value) {
  const source = asRecord(value);
  if (!source) {
    return null;
  }
  const keys = [
    'lastCandidateToolCount',
    'lastActiveToolCount',
    'maxActiveToolCount',
    'lastActiveToolTokenEstimate',
    'maxActiveToolTokenEstimate',
  ];
  const projected = {};
  for (const key of keys) {
    const number = finiteNumber(source[key]);
    if (number === null) {
      return null;
    }
    projected[key] = number;
  }
  return projected;
}

function projectGraphSnapshot(value) {
  const source = asRecord(value);
  const status = source ? safeEnum(source.status, SAFE_GRAPH_STATUSES) : undefined;
  const iteration = source ? nonNegativeInteger(source.iteration) : null;
  const goalIdHashesByStatus = source
    ? projectGoalHashesByStatus(source.goalIdHashesByStatus)
    : null;
  const goalSummaries = source ? projectArray(source.goalSummaries, projectGoalSummary) : null;
  const expectedToolNames = source ? projectSafeToolNameArray(source.expectedToolNames) : null;
  const expectedToolNameHashes = source ? projectHashArray(source.expectedToolNameHashes) : null;
  const observedToolResults = source
    ? projectArray(source.observedToolResults, projectObservedToolResult)
    : null;
  const lastModelToolNames = source ? projectSafeToolNameArray(source.lastModelToolNames) : null;
  const lastModelToolNameHashes = source ? projectHashArray(source.lastModelToolNameHashes) : null;
  const sessionActivatedToolNames = source
    ? projectSafeToolNameArray(source.sessionActivatedToolNames)
    : null;
  const sessionActivatedToolNameHashes = source
    ? projectHashArray(source.sessionActivatedToolNameHashes)
    : null;
  const auditEvents = source ? projectArray(source.auditEvents, projectAuditEvent, 32) : null;
  const selectedToolSurfaceEvents = source
    ? projectArray(source.selectedToolSurfaceEvents, projectAuditEvent, 8)
    : null;
  const performance = source ? projectPerformance(source.performance) : null;
  const countKeys = [
    'pendingAsyncCount',
    'auditEventCount',
    'selectedToolSurfaceEventCount',
    'observedToolResultCount',
  ];
  const counts = {};
  if (!source) {
    return null;
  }
  for (const key of countKeys) {
    const count = nonNegativeInteger(source[key]);
    if (count === null) {
      return null;
    }
    counts[key] = count;
  }
  if (
    !status ||
    iteration === null ||
    !goalIdHashesByStatus ||
    !goalSummaries ||
    !expectedToolNames ||
    !expectedToolNameHashes ||
    !observedToolResults ||
    !lastModelToolNames ||
    !lastModelToolNameHashes ||
    !sessionActivatedToolNames ||
    !sessionActivatedToolNameHashes ||
    !auditEvents ||
    !selectedToolSurfaceEvents ||
    !performance
  ) {
    return null;
  }
  const projected = {
    status,
    iteration,
    goalIdHashesByStatus,
    goalSummaries,
    expectedToolNames,
    expectedToolNameHashes,
    observedToolResults,
    ...counts,
    lastModelToolNames,
    lastModelToolNameHashes,
    sessionActivatedToolNames,
    sessionActivatedToolNameHashes,
    auditEvents,
    selectedToolSurfaceEvents,
    performance,
  };
  for (const key of ['finalizationHoldReasonHash', 'terminalReasonHash', 'activeTaskIdHash']) {
    if (source[key] === undefined) {
      continue;
    }
    const hash = projectHash(source[key]);
    if (!hash) {
      return null;
    }
    projected[key] = hash;
  }
  return projected;
}

module.exports = { SAFE_GRAPH_STATUSES, projectGraphSnapshot };
