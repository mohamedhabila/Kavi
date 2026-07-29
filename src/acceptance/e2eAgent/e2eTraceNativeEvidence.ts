import type { ForegroundScenarioNativeEvidenceSnapshot } from './foregroundScenarioDriverTypes';
import {
  buildValueFingerprint,
  type E2ERedactedHash,
  type E2ERedactedValueFingerprint,
} from './e2eTraceRedaction';
import { buildRedactedToolName } from './e2eTraceToolNames';
import type { E2EScenarioResult } from './types';

export type E2ERedactedNativeToolInvocationCount = {
  name?: string;
  nameHash: E2ERedactedHash;
  count: number;
};

export type E2ERedactedNativeTurnEvidence = {
  invocationCount: number;
  handledInvocationCount: number;
  toolInvocations: E2ERedactedNativeToolInvocationCount[];
  changedStateFieldCount: number;
  stateBeforeFingerprints: E2ERedactedValueFingerprint[];
  stateAfterFingerprints: E2ERedactedValueFingerprint[];
};

const MAX_NATIVE_FIXTURE_STATE_FIELDS = 96;

function collectPrimitiveValueFingerprints(
  value: unknown,
  path: string[],
  fingerprints: E2ERedactedValueFingerprint[],
): void {
  if (fingerprints.length >= MAX_NATIVE_FIXTURE_STATE_FIELDS) return;
  if (value && typeof value === 'object') {
    if (Array.isArray(value)) {
      const fingerprint = buildValueFingerprint(path.join('.'), value, { count: value.length });
      if (fingerprint) fingerprints.push(fingerprint);
      return;
    }
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      collectPrimitiveValueFingerprints(
        (value as Record<string, unknown>)[key],
        [...path, key],
        fingerprints,
      );
      if (fingerprints.length >= MAX_NATIVE_FIXTURE_STATE_FIELDS) return;
    }
    return;
  }

  const fieldPath = path.join('.');
  if (!fieldPath) return;
  const isCount =
    typeof value === 'number' && Number.isInteger(value) && value >= 0 && /Count$/.test(fieldPath);
  const fingerprint = buildValueFingerprint(fieldPath, value, {
    ...(isCount ? { count: value } : {}),
  });
  if (fingerprint) fingerprints.push(fingerprint);
}

function buildStateFingerprints(value: unknown): E2ERedactedValueFingerprint[] {
  const fingerprints: E2ERedactedValueFingerprint[] = [];
  collectPrimitiveValueFingerprints(value, [], fingerprints);
  return fingerprints;
}

function countChangedFields(
  before: ReadonlyArray<E2ERedactedValueFingerprint>,
  after: ReadonlyArray<E2ERedactedValueFingerprint>,
): number {
  const beforeByPath = new Map(before.map((fingerprint) => [fingerprint.fieldPath, fingerprint]));
  return after.filter((fingerprint) => {
    const previous = beforeByPath.get(fingerprint.fieldPath);
    return !previous || previous.valueHash !== fingerprint.valueHash;
  }).length;
}

function buildToolInvocationCounts(
  evidence: ForegroundScenarioNativeEvidenceSnapshot,
): E2ERedactedNativeToolInvocationCount[] {
  const counts = new Map<string, number>();
  for (const invocation of evidence.invocations) {
    counts.set(invocation.toolName, (counts.get(invocation.toolName) ?? 0) + 1);
  }
  return Array.from(counts, ([name, count]) => ({
    ...buildRedactedToolName(name),
    count,
  })).sort((left, right) => left.nameHash.hash.localeCompare(right.nameHash.hash));
}

export function buildNativeTurnEvidence(
  evidence: ForegroundScenarioNativeEvidenceSnapshot,
): E2ERedactedNativeTurnEvidence {
  const stateBeforeFingerprints = buildStateFingerprints(evidence.stateBefore);
  const stateAfterFingerprints = buildStateFingerprints(evidence.stateAfter);
  return {
    invocationCount: evidence.invocations.length,
    handledInvocationCount: evidence.invocations.filter((invocation) => invocation.handled).length,
    toolInvocations: buildToolInvocationCounts(evidence),
    changedStateFieldCount: countChangedFields(stateBeforeFingerprints, stateAfterFingerprints),
    stateBeforeFingerprints,
    stateAfterFingerprints,
  };
}

export function buildFinalNativeStateTrace(
  result: E2EScenarioResult,
): E2ERedactedValueFingerprint[] {
  const finalState = result.turnTraces[result.turnTraces.length - 1]?.native.stateAfter;
  return finalState ? buildStateFingerprints(finalState) : [];
}
