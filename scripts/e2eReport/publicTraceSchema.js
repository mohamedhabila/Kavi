const { SAFE_GRAPH_STATUSES, projectGraphSnapshot } = require('./publicTraceGraph');
const {
  SHA256_PATTERN,
  asRecord,
  boundedString,
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
const { SAFE_NATIVE_FIXTURE_PATHS, projectPublicUsageTrace } = require('./publicTraceUsage');
const { projectValueFingerprint } = require('./publicTraceValues');

function projectTurn(value) {
  const source = asRecord(value);
  const turnIndex = source ? nonNegativeInteger(source.turnIndex) : null;
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
  const fixtureId = boundedString(source.fixtureId, 256);
  const conversationIdHash = projectHash(source.conversationIdHash);
  const durationMs = finiteNumber(source.durationMs);
  const usage = projectPublicUsageTrace(source.usage);
  const errors = projectHashArray(source.errors, 128);
  const toolCalls = projectArray(source.toolCalls, projectToolCall);
  const toolResults = projectArray(source.toolResults, projectToolResult);
  const graphSnapshots = projectArray(source.graphSnapshots, projectGraphSnapshot, 12);
  const nativeFixtureStateFingerprints = projectArray(
    source.nativeFixtureStateFingerprints,
    (fingerprint) => projectValueFingerprint(fingerprint, SAFE_NATIVE_FIXTURE_PATHS),
    SAFE_NATIVE_FIXTURE_PATHS.size,
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
    !nativeFixtureStateFingerprints ||
    !turns
  ) {
    return null;
  }
  const graphStatus =
    source.graphStatus === null
      ? null
      : (safeEnum(source.graphStatus, SAFE_GRAPH_STATUSES) ?? null);
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
