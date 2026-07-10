const { SAFE_GRAPH_STATUSES, projectGraphSnapshot } = require('./publicTraceGraph');
const {
  projectAgentRunEvidence,
  projectCompletionEvidence,
  projectFinalAssistantEvidence,
  projectLifecycleBoundaryEvidence,
  projectRouteEvidence,
  projectUserEvidence,
} = require('./publicTraceExecution');
const {
  projectMemoryDeltaEvidence,
  projectMemoryFinalEvidence,
} = require('./publicTraceMemory');
const { projectNativeTurnEvidence, projectStateFingerprints } = require('./publicTraceNative');
const { isPublicEvaluationId } = require('./publicProjectionPolicy');
const {
  SHA256_PATTERN,
  asRecord,
  finiteNumber,
  hashPrivateString,
  nonNegativeInteger,
  projectArray,
  projectHash,
  projectHashArray,
  safeEnum,
  safePublicToolName,
} = require('./publicTracePrimitives');
const { projectToolCall, projectToolResult } = require('./publicTraceTools');
const { projectPublicUsageTrace } = require('./publicTraceUsage');

function projectTurn(value) {
  const source = asRecord(value);
  const turnIndex = source ? nonNegativeInteger(source.turnIndex) : null;
  const lifecycleBefore = source
    ? projectLifecycleBoundaryEvidence(source.lifecycleBefore)
    : undefined;
  const user = source ? projectUserEvidence(source.user) : null;
  const route = source ? projectRouteEvidence(source.route) : null;
  const finalAssistant = source ? projectFinalAssistantEvidence(source.finalAssistant) : undefined;
  const finalAssistantCandidateCount = source
    ? nonNegativeInteger(source.finalAssistantCandidateCount)
    : null;
  const completion = source ? projectCompletionEvidence(source.completion) : null;
  const agentRun = source ? projectAgentRunEvidence(source.agentRun) : undefined;
  const memoryDelta = source ? projectMemoryDeltaEvidence(source.memoryDelta) : null;
  const native = source ? projectNativeTurnEvidence(source.native) : null;
  const usage = source ? projectPublicUsageTrace(source.usage) : null;
  const toolCalls = source ? projectArray(source.toolCalls, projectToolCall) : null;
  const toolResults = source ? projectArray(source.toolResults, projectToolResult) : null;
  const graphSnapshots = source
    ? projectArray(source.graphSnapshots, projectGraphSnapshot, 6)
    : null;
  if (
    !source ||
    turnIndex === null ||
    typeof source.completed !== 'boolean' ||
    lifecycleBefore === undefined ||
    !user ||
    !route ||
    finalAssistant === undefined ||
    finalAssistantCandidateCount === null ||
    !completion ||
    agentRun === undefined ||
    !memoryDelta ||
    !native ||
    !usage ||
    !toolCalls ||
    !toolResults ||
    !graphSnapshots
  ) {
    return null;
  }
  return {
    turnIndex,
    completed: source.completed,
    lifecycleBefore,
    user,
    route,
    finalAssistant,
    finalAssistantCandidateCount,
    completion,
    agentRun,
    memoryDelta,
    native,
    usage,
    toolCalls,
    toolResults,
    graphSnapshots,
  };
}

function projectPublicRedactedTrace(value) {
  const source = asRecord(value);
  if (!source || source.schemaVersion !== 'e2e-redacted-trace-v2') {
    return null;
  }
  const fixtureId = isPublicEvaluationId(source.fixtureId) ? source.fixtureId : null;
  const conversationIdHash = projectHash(source.conversationIdHash);
  const durationMs = finiteNumber(source.durationMs);
  const usage = projectPublicUsageTrace(source.usage);
  const errors = projectHashArray(source.errors, 128);
  const toolCalls = projectArray(source.toolCalls, projectToolCall);
  const toolResults = projectArray(source.toolResults, projectToolResult);
  const graphSnapshots = projectArray(source.graphSnapshots, projectGraphSnapshot, 12);
  const memoryFinal = projectMemoryFinalEvidence(source.memoryFinal);
  const nativeFixtureStateFingerprints = projectStateFingerprints(
    source.nativeFixtureStateFingerprints,
  );
  const turns = projectArray(source.turns, projectTurn, 256);
  const countKeys = ['userTurnCount', 'turnCount', 'toolCallCount'];
  const counts = {};
  for (const key of countKeys) {
    const count = nonNegativeInteger(source[key]);
    if (count === null) {
      return null;
    }
    counts[key] = count;
  }
  if (
    !fixtureId ||
    !conversationIdHash ||
    typeof source.completed !== 'boolean' ||
    durationMs === null ||
    !usage ||
    !errors ||
    !toolCalls ||
    !toolResults ||
    !graphSnapshots ||
    !memoryFinal ||
    !nativeFixtureStateFingerprints ||
    !turns
  ) {
    return null;
  }
  const graphStatus =
    source.graphStatus === null ? null : safeEnum(source.graphStatus, SAFE_GRAPH_STATUSES);
  if (graphStatus === undefined) return null;
  return {
    schemaVersion: 'e2e-redacted-trace-v2',
    fixtureId,
    conversationIdHash,
    completed: source.completed,
    durationMs,
    ...counts,
    graphStatus,
    errors,
    usage,
    toolCalls,
    toolResults,
    graphSnapshots,
    memoryFinal,
    nativeFixtureStateFingerprints,
    turns,
  };
}

module.exports = {
  SHA256_PATTERN,
  hashPrivateString,
  projectPublicRedactedTrace,
  projectPublicUsageTrace,
  safePublicToolName,
};
