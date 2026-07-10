import {
  enqueueAndroidDurableExecution,
  readAndroidDurableExecution,
  releaseTerminalAndroidDurableExecution,
} from './androidDurableExecutionNative';
import type {
  AndroidDurableAdapterResult,
  AndroidDurableExecutionPointer,
  AndroidDurableExecutionRecord,
  AndroidExternalDurableExecutionRequest,
} from './androidDurableExecutionTypes';
import {
  listPersistedExternalRecoveryCandidates,
  readPersistedExternalRecoveryCandidate,
  type PersistedExternalRecoveryCandidate,
} from './productionRecovery';

const DEFAULT_PAGE_SIZE = 25;
const DEFAULT_MAX_PAGES = 4;
const MAX_ANDROID_RECOVERY_ATTEMPTS = 5;
const INITIAL_BACKOFF_MILLIS = 30_000;

const ACTIVE_NATIVE_STATES = new Set([
  'scheduling',
  'enqueued',
  'running',
  'retry_waiting',
  'cancel_requested',
]);

export type AndroidDurableRecoveryScheduleOutcome =
  | { kind: 'scheduled' | 'already_scheduled'; runId: string }
  | { kind: 'not_candidate'; runId: string }
  | { kind: 'deferred'; runId: string; reason: string }
  | { kind: 'blocked'; runId: string; reason: string };

interface AndroidDurableRecoverySchedulingDependencies {
  now(): number;
  readCandidate: typeof readPersistedExternalRecoveryCandidate;
  listCandidates: typeof listPersistedExternalRecoveryCandidates;
  readNative: typeof readAndroidDurableExecution;
  releaseNative: typeof releaseTerminalAndroidDurableExecution;
  enqueueNative: typeof enqueueAndroidDurableExecution;
}

const DEFAULT_DEPENDENCIES: AndroidDurableRecoverySchedulingDependencies = {
  now: Date.now,
  readCandidate: readPersistedExternalRecoveryCandidate,
  listCandidates: listPersistedExternalRecoveryCandidates,
  readNative: readAndroidDurableExecution,
  releaseNative: releaseTerminalAndroidDurableExecution,
  enqueueNative: enqueueAndroidDurableExecution,
};

function generationPointer(
  record: AndroidDurableExecutionRecord,
): AndroidDurableExecutionPointer {
  const identity = record.request.identity;
  return {
    schema: 1,
    runId: identity.runId,
    controlEpoch: identity.controlEpoch,
    snapshotUpdatedAtMillis: identity.snapshotUpdatedAtMillis,
    snapshotDigest: identity.snapshotDigest,
    commandDigest: identity.commandDigest,
  };
}

function sameGeneration(
  record: AndroidDurableExecutionRecord,
  candidate: PersistedExternalRecoveryCandidate,
): boolean {
  const identity = record.request.identity;
  return (
    identity.runId === candidate.runId &&
    identity.controlEpoch === candidate.generation.controlEpoch &&
    identity.snapshotUpdatedAtMillis === candidate.generation.updatedAt &&
    identity.snapshotDigest === candidate.generation.snapshotDigest &&
    identity.commandKind === 'reconcile_external_handles' &&
    identity.commandDigest === candidate.commandDigest
  );
}

function compareGeneration(
  record: AndroidDurableExecutionRecord,
  candidate: PersistedExternalRecoveryCandidate,
): number {
  const identity = record.request.identity;
  if (candidate.generation.controlEpoch !== identity.controlEpoch) {
    return candidate.generation.controlEpoch > identity.controlEpoch ? 1 : -1;
  }
  if (candidate.generation.updatedAt !== identity.snapshotUpdatedAtMillis) {
    return candidate.generation.updatedAt > identity.snapshotUpdatedAtMillis ? 1 : -1;
  }
  return sameGeneration(record, candidate) ? 0 : Number.NaN;
}

function buildRequest(
  candidate: PersistedExternalRecoveryCandidate,
  now: number,
): AndroidExternalDurableExecutionRequest {
  if (!Number.isSafeInteger(now) || now < 0) {
    throw new Error('android-durable-scheduler-clock-invalid');
  }
  const requestedAtMillis = Math.max(now, candidate.generation.updatedAt);
  const earliestStartAtMillis = Math.max(
    requestedAtMillis,
    candidate.retryAt ?? requestedAtMillis,
  );
  return {
    schema: 1,
    durabilityClass: 'external_durable_operation',
    identity: {
      runId: candidate.runId,
      controlEpoch: candidate.generation.controlEpoch,
      snapshotUpdatedAtMillis: candidate.generation.updatedAt,
      snapshotDigest: candidate.generation.snapshotDigest,
      commandKind: 'reconcile_external_handles',
      commandDigest: candidate.commandDigest,
    },
    constraints: {
      network: 'connected',
      requiresCharging: false,
      requiresBatteryNotLow: true,
      requiresStorageNotLow: true,
      requiresDeviceIdle: false,
      earliestStartAtMillis,
    },
    retryPolicy: {
      maxAttempts: MAX_ANDROID_RECOVERY_ATTEMPTS,
      backoffPolicy: 'exponential',
      initialBackoffMillis: INITIAL_BACKOFF_MILLIS,
    },
    requestedAtMillis,
  };
}

function classifyAdapterResult(
  runId: string,
  result: AndroidDurableAdapterResult,
): AndroidDurableRecoveryScheduleOutcome {
  if (result.status === 'accepted') return { kind: 'scheduled', runId };
  if (result.status === 'no_op') return { kind: 'already_scheduled', runId };
  if (result.status === 'deferred') {
    return { kind: 'deferred', runId, reason: result.reason };
  }
  return { kind: 'blocked', runId, reason: result.reason ?? 'native_contract_failure' };
}

/** Schedules exactly the current persisted journal generation for one run. */
export async function schedulePersistedAndroidExternalRecoveryRun(
  runId: string,
  dependencies: AndroidDurableRecoverySchedulingDependencies = DEFAULT_DEPENDENCIES,
): Promise<AndroidDurableRecoveryScheduleOutcome> {
  return scheduleExactRun(runId, null, dependencies);
}

/**
 * Continues one finished WorkManager chain and releases only its exact terminal native tombstone
 * when the authoritative journal has no successor.
 */
export async function continuePersistedAndroidExternalRecoveryRun(
  runId: string,
  predecessorWorkId: string,
  dependencies: AndroidDurableRecoverySchedulingDependencies = DEFAULT_DEPENDENCIES,
): Promise<AndroidDurableRecoveryScheduleOutcome> {
  return scheduleExactRun(runId, predecessorWorkId, dependencies);
}

async function scheduleExactRun(
  runId: string,
  predecessorWorkId: string | null,
  dependencies: AndroidDurableRecoverySchedulingDependencies,
): Promise<AndroidDurableRecoveryScheduleOutcome> {
  let candidateResult: Awaited<ReturnType<typeof readPersistedExternalRecoveryCandidate>>;
  try {
    candidateResult = await dependencies.readCandidate(runId);
  } catch {
    return { kind: 'deferred', runId, reason: 'journal_unavailable' };
  }
  if (candidateResult.kind === 'not_candidate') {
    if (predecessorWorkId === null) return candidateResult;
    return releaseFinishedPredecessor(runId, predecessorWorkId, dependencies);
  }
  if (candidateResult.kind === 'blocked') {
    return {
      kind: candidateResult.reason === 'journal_unavailable' ? 'deferred' : 'blocked',
      runId,
      reason: candidateResult.reason,
    };
  }
  const candidate = candidateResult.candidate;
  const request = buildRequest(candidate, dependencies.now());

  for (let conflictAttempt = 0; conflictAttempt < 2; conflictAttempt += 1) {
    let native: Awaited<ReturnType<typeof readAndroidDurableExecution>>;
    try {
      native = await dependencies.readNative(runId);
    } catch {
      return { kind: 'deferred', runId, reason: 'native_bridge_unavailable' };
    }
    if (native.status === 'unavailable') {
      return { kind: 'deferred', runId, reason: 'native_store_unavailable' };
    }
    if (native.status === 'missing') {
      try {
        return classifyAdapterResult(runId, await dependencies.enqueueNative(request));
      } catch {
        return { kind: 'deferred', runId, reason: 'native_bridge_unavailable' };
      }
    }
    if (native.status !== 'found' || native.record === null) {
      return { kind: 'deferred', runId, reason: 'native_store_unavailable' };
    }
    const record = native.record;

    const ordering = compareGeneration(record, candidate);
    if (Number.isNaN(ordering)) {
      return { kind: 'blocked', runId, reason: 'native_generation_conflict' };
    }
    if (ordering < 0) {
      return { kind: 'blocked', runId, reason: 'candidate_generation_stale' };
    }
    if (ordering === 0) {
      return ACTIVE_NATIVE_STATES.has(record.state)
        ? { kind: 'already_scheduled', runId }
        : { kind: 'blocked', runId, reason: 'candidate_generation_terminal' };
    }
    if (ACTIVE_NATIVE_STATES.has(record.state)) {
      return { kind: 'deferred', runId, reason: 'older_native_generation_active' };
    }

    let released: Awaited<ReturnType<typeof releaseTerminalAndroidDurableExecution>>;
    try {
      released = await dependencies.releaseNative(generationPointer(record));
    } catch {
      return { kind: 'deferred', runId, reason: 'native_bridge_unavailable' };
    }
    if (released.status === 'released') {
      try {
        return classifyAdapterResult(runId, await dependencies.enqueueNative(request));
      } catch {
        return { kind: 'deferred', runId, reason: 'native_bridge_unavailable' };
      }
    }
    if (released.status === 'deferred') {
      return { kind: 'deferred', runId, reason: released.reason };
    }
    if (released.status === 'rejected' && released.reason === 'record_not_found') continue;
    return {
      kind: 'blocked',
      runId,
      reason: released.reason ?? 'native_release_contract_failure',
    };
  }

  return { kind: 'deferred', runId, reason: 'native_release_race' };
}

async function releaseFinishedPredecessor(
  runId: string,
  predecessorWorkId: string,
  dependencies: AndroidDurableRecoverySchedulingDependencies,
): Promise<AndroidDurableRecoveryScheduleOutcome> {
  for (let conflictAttempt = 0; conflictAttempt < 2; conflictAttempt += 1) {
    let native: Awaited<ReturnType<typeof readAndroidDurableExecution>>;
    try {
      native = await dependencies.readNative(runId);
    } catch {
      return { kind: 'deferred', runId, reason: 'native_bridge_unavailable' };
    }
    if (native.status === 'unavailable') {
      return { kind: 'deferred', runId, reason: 'native_store_unavailable' };
    }
    if (native.status === 'missing') return { kind: 'not_candidate', runId };
    if (native.record.platformWorkId !== predecessorWorkId) {
      return { kind: 'blocked', runId, reason: 'predecessor_identity_conflict' };
    }
    if (ACTIVE_NATIVE_STATES.has(native.record.state)) {
      return { kind: 'deferred', runId, reason: 'predecessor_not_terminal' };
    }

    let released: Awaited<ReturnType<typeof releaseTerminalAndroidDurableExecution>>;
    try {
      released = await dependencies.releaseNative(generationPointer(native.record));
    } catch {
      return { kind: 'deferred', runId, reason: 'native_bridge_unavailable' };
    }
    if (released.status === 'released') return { kind: 'not_candidate', runId };
    if (released.status === 'deferred') {
      return { kind: 'deferred', runId, reason: released.reason };
    }
    if (released.status === 'rejected' && released.reason === 'record_not_found') continue;
    return {
      kind: 'blocked',
      runId,
      reason: released.reason ?? 'native_release_contract_failure',
    };
  }
  return { kind: 'deferred', runId, reason: 'native_release_race' };
}

export interface SchedulePersistedAndroidExternalRecoveryCandidatesInput {
  pageSize?: number;
  maxPages?: number;
}

/** Bounded startup/foreground repair scan. Every run is re-read before native scheduling. */
export async function schedulePersistedAndroidExternalRecoveryCandidates(
  input: SchedulePersistedAndroidExternalRecoveryCandidatesInput = {},
  dependencies: AndroidDurableRecoverySchedulingDependencies = DEFAULT_DEPENDENCIES,
): Promise<AndroidDurableRecoveryScheduleOutcome[]> {
  const pageSize = input.pageSize ?? DEFAULT_PAGE_SIZE;
  const maxPages = input.maxPages ?? DEFAULT_MAX_PAGES;
  if (
    !Number.isSafeInteger(pageSize) ||
    pageSize < 1 ||
    pageSize > 100 ||
    !Number.isSafeInteger(maxPages) ||
    maxPages < 1 ||
    maxPages > 100
  ) {
    throw new Error('android-durable-scan-contract-invalid');
  }

  const outcomes: AndroidDurableRecoveryScheduleOutcome[] = [];
  let after: string | undefined;
  for (let page = 0; page < maxPages; page += 1) {
    const listed = await dependencies.listCandidates({
      limit: pageSize,
      ...(after === undefined ? {} : { after }),
    });
    if (listed.kind === 'blocked') {
      outcomes.push({
        kind: listed.reason === 'journal_unavailable' ? 'deferred' : 'blocked',
        runId: '*',
        reason: listed.reason,
      });
      break;
    }
    for (const candidate of listed.candidates) {
      outcomes.push(
        await schedulePersistedAndroidExternalRecoveryRun(candidate.runId, dependencies),
      );
    }
    if (listed.nextAfter === null) break;
    after = listed.nextAfter;
  }
  return outcomes;
}
