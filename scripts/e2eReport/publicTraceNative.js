const {
  asRecord,
  nonNegativeInteger,
  projectArray,
  projectHash,
  safePublicToolName,
} = require('./publicTracePrimitives');
const { SAFE_NATIVE_FIXTURE_PATHS } = require('./publicTraceUsage');
const { projectValueFingerprint } = require('./publicTraceValues');

function projectNativeToolInvocation(value) {
  const source = asRecord(value);
  const nameHash = source ? projectHash(source.nameHash) : null;
  const count = source ? nonNegativeInteger(source.count) : null;
  if (!source || !nameHash || count === null) return null;
  const name = safePublicToolName(source.name);
  return { ...(name ? { name } : {}), nameHash, count };
}

function projectStateFingerprints(value) {
  return projectArray(
    value,
    (fingerprint) => projectValueFingerprint(fingerprint, SAFE_NATIVE_FIXTURE_PATHS),
    SAFE_NATIVE_FIXTURE_PATHS.size,
  );
}

function projectNativeTurnEvidence(value) {
  const source = asRecord(value);
  const invocationCount = source ? nonNegativeInteger(source.invocationCount) : null;
  const handledInvocationCount = source
    ? nonNegativeInteger(source.handledInvocationCount)
    : null;
  const changedStateFieldCount = source
    ? nonNegativeInteger(source.changedStateFieldCount)
    : null;
  const toolInvocations = source
    ? projectArray(source.toolInvocations, projectNativeToolInvocation, 512)
    : null;
  const stateBeforeFingerprints = source
    ? projectStateFingerprints(source.stateBeforeFingerprints)
    : null;
  const stateAfterFingerprints = source
    ? projectStateFingerprints(source.stateAfterFingerprints)
    : null;
  if (
    !source ||
    invocationCount === null ||
    handledInvocationCount === null ||
    changedStateFieldCount === null ||
    !toolInvocations ||
    !stateBeforeFingerprints ||
    !stateAfterFingerprints ||
    handledInvocationCount > invocationCount ||
    toolInvocations.reduce((sum, entry) => sum + entry.count, 0) !== invocationCount ||
    changedStateFieldCount > stateAfterFingerprints.length
  ) {
    return null;
  }
  return {
    invocationCount,
    handledInvocationCount,
    toolInvocations,
    changedStateFieldCount,
    stateBeforeFingerprints,
    stateAfterFingerprints,
  };
}

module.exports = { projectNativeTurnEvidence, projectStateFingerprints };
