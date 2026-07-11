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
  'REQUEST_UNDERSTANDING_PROJECTED',
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

const SAFE_REQUEST_UNDERSTANDING_FIELD_STATUSES = new Set(['known', 'unknown', 'conflict']);
const SAFE_REQUEST_UNDERSTANDING_INTEGRITY = new Set(['valid', 'conflict']);
const SAFE_REQUEST_MODES = new Set(['chitchat', 'agentic']);
const SAFE_REQUEST_INPUT_KINDS = new Set([
  'empty',
  'text',
  'attachments',
  'text_and_attachments',
]);
const SAFE_REQUEST_CONTINUATIONS = new Set(['new', 'resume', 'resume_waiting_async']);
const SAFE_REQUEST_DECISION_ACTIONS = new Set([
  'act',
  'clarify',
  'wait',
  'decline',
  'consent',
]);
const SAFE_REQUEST_DECISION_REASONS = new Set([
  'actionable_input',
  'requirements_resolved',
  'missing_input',
  'punctuation_only',
  'required_information_missing',
  'information_lookup_required',
  'waiting_for_async',
  'permission_missing',
  'policy_information_unavailable',
  'prohibited',
  'authorization_required',
]);
const SAFE_EFFECT_AUTHORIZATION_STATUSES = new Set(['required', 'unavailable', 'unknown']);

function projectRequestUnderstandingList(value, includeUnresolvedCount = false) {
  const source = asRecord(value);
  const status = source
    ? safeEnum(source.status, SAFE_REQUEST_UNDERSTANDING_FIELD_STATUSES)
    : undefined;
  const count = source ? nonNegativeInteger(source.count) : null;
  const omittedCount = source ? nonNegativeInteger(source.omittedCount) : null;
  const unresolvedCount = includeUnresolvedCount
    ? source
      ? nonNegativeInteger(source.unresolvedCount)
      : null
    : undefined;
  if (
    !source ||
    !status ||
    count === null ||
    omittedCount === null ||
    (includeUnresolvedCount && unresolvedCount === null)
  ) {
    return null;
  }
  if (status !== 'known' && (count !== 0 || omittedCount !== 0)) {
    return null;
  }
  return {
    status,
    count,
    omittedCount,
    ...(includeUnresolvedCount ? { unresolvedCount } : {}),
  };
}

function projectRequestUnderstandingRouting(value) {
  const source = asRecord(value);
  const status = source
    ? safeEnum(source.status, SAFE_REQUEST_UNDERSTANDING_FIELD_STATUSES)
    : undefined;
  if (!source || !status) return null;
  if (status !== 'known') return { status };
  const mode = safeEnum(source.mode, SAFE_REQUEST_MODES);
  const inputKind = safeEnum(source.inputKind, SAFE_REQUEST_INPUT_KINDS);
  const attachmentCount = nonNegativeInteger(source.attachmentCount);
  const continuation = safeEnum(source.continuation, SAFE_REQUEST_CONTINUATIONS);
  const decisionAction = safeEnum(source.decisionAction, SAFE_REQUEST_DECISION_ACTIONS);
  const decisionReason = safeEnum(source.decisionReason, SAFE_REQUEST_DECISION_REASONS);
  if (
    !mode ||
    !inputKind ||
    attachmentCount === null ||
    !continuation ||
    !decisionAction ||
    !decisionReason
  ) {
    return null;
  }
  return {
    status,
    mode,
    inputKind,
    attachmentCount,
    continuation,
    decisionAction,
    decisionReason,
  };
}

function projectRequestUnderstanding(value) {
  const source = asRecord(value);
  if (!source || source.version !== 1) return undefined;
  const integrity = safeEnum(source.integrity, SAFE_REQUEST_UNDERSTANDING_INTEGRITY);
  const routing = projectRequestUnderstandingRouting(source.routing);
  const declaredObjectives = projectRequestUnderstandingList(source.declaredObjectives);
  const structuredSuccessConditions = projectRequestUnderstandingList(
    source.structuredSuccessConditions,
  );
  const executionRequirements = projectRequestUnderstandingList(source.executionRequirements);
  const registeredRequiredInformation = projectRequestUnderstandingList(
    source.registeredRequiredInformation,
    true,
  );
  const userConstraints = asRecord(source.userConstraints);
  const effectAuthorization = asRecord(source.effectAuthorization);
  const effectAuthorizationStatus = effectAuthorization
    ? safeEnum(effectAuthorization.status, SAFE_EFFECT_AUTHORIZATION_STATUSES)
    : undefined;
  if (
    !integrity ||
    !routing ||
    !declaredObjectives ||
    !structuredSuccessConditions ||
    !executionRequirements ||
    !registeredRequiredInformation ||
    userConstraints?.status !== 'unknown' ||
    !effectAuthorizationStatus
  ) {
    return undefined;
  }
  if (registeredRequiredInformation.unresolvedCount > registeredRequiredInformation.count) {
    return undefined;
  }
  const fieldStatuses = [
    routing.status,
    declaredObjectives.status,
    structuredSuccessConditions.status,
    executionRequirements.status,
    registeredRequiredInformation.status,
  ];
  if (integrity === 'valid' && fieldStatuses.includes('conflict')) {
    return undefined;
  }
  const expectedEffectAuthorization =
    integrity === 'conflict' || routing.status !== 'known'
      ? 'unknown'
      : routing.decisionAction === 'consent'
        ? 'required'
        : routing.decisionAction === 'decline'
          ? 'unavailable'
          : 'unknown';
  if (effectAuthorizationStatus !== expectedEffectAuthorization) {
    return undefined;
  }
  return {
    version: 1,
    integrity,
    routing,
    declaredObjectives,
    structuredSuccessConditions,
    executionRequirements,
    userConstraints: { status: 'unknown' },
    registeredRequiredInformation,
    effectAuthorization: { status: effectAuthorizationStatus },
  };
}

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
  const requestUnderstanding = source
    ? source.requestUnderstanding === undefined
      ? undefined
      : projectRequestUnderstanding(source.requestUnderstanding)
    : undefined;
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
    !performance ||
    (source.requestUnderstanding !== undefined && !requestUnderstanding)
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
    ...(requestUnderstanding ? { requestUnderstanding } : {}),
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
