import { Platform } from 'react-native';
import { getDurablePlatformExecutionBridge } from './durablePlatformBridge';
import type {
  DurablePlatformAdapterResult,
  DurablePlatformExecutionBridge,
  DurablePlatformExecutionPointer,
  DurablePlatformExecutionRequest,
  IOSDurablePlatformRecord,
} from './durablePlatformBridgeTypes';
import type { DurableRecoveryScheduleOutcome } from './durableRecoverySchedulingTypes';
import {
  listPersistedExternalRecoveryCandidates,
  readPersistedExternalRecoveryCandidate,
  type PersistedExternalRecoveryCandidate,
} from './productionRecovery';

const DEFAULT_CANDIDATE_SLICE_SIZE = 25;
const MAX_CANDIDATE_SLICE_SIZE = 100;
const MAX_IOS_RECOVERY_ATTEMPTS = 5;
const INITIAL_BACKOFF_MILLIS = 30_000;

const ACTIVE_NATIVE_STATES = new Set([
  'scheduling',
  'submitted',
  'running',
  'retry_waiting',
  'cancel_requested',
]);

export type IOSDurableRecoveryScheduleOutcome = DurableRecoveryScheduleOutcome;

interface IOSDurableRecoverySchedulingDependencies {
  now(): number;
  readCandidate: typeof readPersistedExternalRecoveryCandidate;
  listCandidates: typeof listPersistedExternalRecoveryCandidates;
  getBridge(): DurablePlatformExecutionBridge | null;
}

const DEFAULT_DEPENDENCIES: IOSDurableRecoverySchedulingDependencies = {
  now: Date.now,
  readCandidate: readPersistedExternalRecoveryCandidate,
  listCandidates: listPersistedExternalRecoveryCandidates,
  getBridge: () => (Platform.OS === 'ios' ? getDurablePlatformExecutionBridge() : null),
};

function isIOSRecord(
  record: Awaited<ReturnType<DurablePlatformExecutionBridge['getRecord']>>['record'],
): record is IOSDurablePlatformRecord {
  return record !== null && 'taskIdentifier' in record;
}

function generationPointer(record: IOSDurablePlatformRecord): DurablePlatformExecutionPointer {
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

function samePointer(
  left: DurablePlatformExecutionPointer,
  right: DurablePlatformExecutionPointer,
): boolean {
  return (
    left.schema === right.schema &&
    left.runId === right.runId &&
    left.controlEpoch === right.controlEpoch &&
    left.snapshotUpdatedAtMillis === right.snapshotUpdatedAtMillis &&
    left.snapshotDigest === right.snapshotDigest &&
    left.commandDigest === right.commandDigest
  );
}

function sameGeneration(
  record: IOSDurablePlatformRecord,
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
  record: IOSDurablePlatformRecord,
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
): DurablePlatformExecutionRequest {
  if (!Number.isSafeInteger(now) || now < 0) {
    throw new Error('ios-durable-scheduler-clock-invalid');
  }
  const requestedAtMillis = Math.max(now, candidate.generation.updatedAt);
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
      requiresBatteryNotLow: false,
      requiresStorageNotLow: false,
      requiresDeviceIdle: false,
      earliestStartAtMillis: Math.max(requestedAtMillis, candidate.retryAt ?? requestedAtMillis),
    },
    retryPolicy: {
      maxAttempts: MAX_IOS_RECOVERY_ATTEMPTS,
      backoffPolicy: 'exponential',
      initialBackoffMillis: INITIAL_BACKOFF_MILLIS,
    },
    requestedAtMillis,
  };
}

function classifyAdapterResult(
  runId: string,
  result: DurablePlatformAdapterResult,
): IOSDurableRecoveryScheduleOutcome {
  switch (result.status) {
    case 'accepted':
      return { kind: 'scheduled', runId };
    case 'no_op':
      return { kind: 'already_scheduled', runId };
    case 'deferred':
      return { kind: 'deferred', runId, reason: result.reason };
    case 'unsupported':
    case 'rejected':
      return { kind: 'blocked', runId, reason: result.reason };
    case 'released':
      return { kind: 'blocked', runId, reason: 'native_release_contract_failure' };
  }
}

/** Schedules exactly the current persisted external-reconciliation generation for one run. */
export async function schedulePersistedIOSExternalRecoveryRun(
  runId: string,
  dependencies: IOSDurableRecoverySchedulingDependencies = DEFAULT_DEPENDENCIES,
): Promise<IOSDurableRecoveryScheduleOutcome> {
  return scheduleExactRun(runId, null, dependencies);
}

/** Releases one finished native generation and schedules its authoritative journal successor. */
export async function continuePersistedIOSExternalRecoveryRun(
  runId: string,
  predecessor: DurablePlatformExecutionPointer,
  dependencies: IOSDurableRecoverySchedulingDependencies = DEFAULT_DEPENDENCIES,
): Promise<IOSDurableRecoveryScheduleOutcome> {
  return scheduleExactRun(runId, predecessor, dependencies);
}

async function scheduleExactRun(
  runId: string,
  predecessor: DurablePlatformExecutionPointer | null,
  dependencies: IOSDurableRecoverySchedulingDependencies,
): Promise<IOSDurableRecoveryScheduleOutcome> {
  const bridge = dependencies.getBridge();
  if (!bridge) return { kind: 'deferred', runId, reason: 'native_bridge_unavailable' };

  let candidateResult: Awaited<ReturnType<typeof readPersistedExternalRecoveryCandidate>>;
  try {
    candidateResult = await dependencies.readCandidate(runId);
  } catch {
    return { kind: 'deferred', runId, reason: 'journal_unavailable' };
  }
  if (candidateResult.kind === 'not_candidate') {
    return predecessor === null
      ? candidateResult
      : releaseFinishedPredecessor(runId, predecessor, bridge);
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
    let native: Awaited<ReturnType<DurablePlatformExecutionBridge['getRecord']>>;
    try {
      native = await bridge.getRecord(runId);
    } catch {
      return { kind: 'deferred', runId, reason: 'native_bridge_unavailable' };
    }
    if (native.status === 'unavailable') {
      return { kind: 'deferred', runId, reason: 'native_store_unavailable' };
    }
    if (native.status === 'missing') {
      try {
        return classifyAdapterResult(runId, await bridge.enqueue(request));
      } catch {
        return { kind: 'deferred', runId, reason: 'native_bridge_unavailable' };
      }
    }
    if (native.status !== 'found' || !isIOSRecord(native.record)) {
      return { kind: 'blocked', runId, reason: 'native_platform_conflict' };
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
      if (ACTIVE_NATIVE_STATES.has(record.state)) {
        return { kind: 'already_scheduled', runId };
      }
      if (predecessor === null || !samePointer(generationPointer(record), predecessor)) {
        return { kind: 'blocked', runId, reason: 'candidate_generation_terminal' };
      }
      let released: DurablePlatformAdapterResult;
      try {
        released = await bridge.releaseTerminal(predecessor);
      } catch {
        return { kind: 'deferred', runId, reason: 'native_bridge_unavailable' };
      }
      if (released.status === 'released') {
        try {
          return classifyAdapterResult(runId, await bridge.enqueue(request));
        } catch {
          return { kind: 'deferred', runId, reason: 'native_bridge_unavailable' };
        }
      }
      if (released.status === 'deferred') {
        return { kind: 'deferred', runId, reason: released.reason };
      }
      if (released.status === 'rejected' && released.reason === 'record_not_found') continue;
      return { kind: 'blocked', runId, reason: 'native_release_contract_failure' };
    }
    if (ACTIVE_NATIVE_STATES.has(record.state)) {
      return { kind: 'deferred', runId, reason: 'older_native_generation_active' };
    }

    let released: DurablePlatformAdapterResult;
    try {
      released = await bridge.releaseTerminal(generationPointer(record));
    } catch {
      return { kind: 'deferred', runId, reason: 'native_bridge_unavailable' };
    }
    if (released.status === 'released') {
      try {
        return classifyAdapterResult(runId, await bridge.enqueue(request));
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
      reason: 'native_release_contract_failure',
    };
  }
  return { kind: 'deferred', runId, reason: 'native_release_race' };
}

async function releaseFinishedPredecessor(
  runId: string,
  predecessor: DurablePlatformExecutionPointer,
  bridge: DurablePlatformExecutionBridge,
): Promise<IOSDurableRecoveryScheduleOutcome> {
  for (let conflictAttempt = 0; conflictAttempt < 2; conflictAttempt += 1) {
    let native: Awaited<ReturnType<DurablePlatformExecutionBridge['getRecord']>>;
    try {
      native = await bridge.getRecord(runId);
    } catch {
      return { kind: 'deferred', runId, reason: 'native_bridge_unavailable' };
    }
    if (native.status === 'unavailable') {
      return { kind: 'deferred', runId, reason: 'native_store_unavailable' };
    }
    if (native.status === 'missing') return { kind: 'not_candidate', runId };
    if (native.status !== 'found' || !isIOSRecord(native.record)) {
      return { kind: 'blocked', runId, reason: 'native_platform_conflict' };
    }
    const record = native.record;
    if (!samePointer(generationPointer(record), predecessor)) {
      return { kind: 'blocked', runId, reason: 'predecessor_identity_conflict' };
    }
    if (ACTIVE_NATIVE_STATES.has(record.state)) {
      return { kind: 'deferred', runId, reason: 'predecessor_not_terminal' };
    }
    let released: DurablePlatformAdapterResult;
    try {
      released = await bridge.releaseTerminal(predecessor);
    } catch {
      return { kind: 'deferred', runId, reason: 'native_bridge_unavailable' };
    }
    if (released.status === 'released') return { kind: 'not_candidate', runId };
    if (released.status === 'deferred') {
      return { kind: 'deferred', runId, reason: released.reason };
    }
    if (released.status === 'rejected' && released.reason === 'record_not_found') continue;
    return { kind: 'blocked', runId, reason: 'native_release_contract_failure' };
  }
  return { kind: 'deferred', runId, reason: 'native_release_race' };
}

export interface SchedulePersistedIOSExternalRecoveryCandidateSliceInput {
  limit?: number;
  after?: string;
}

export interface SchedulePersistedIOSExternalRecoveryCandidateSliceResult {
  outcomes: IOSDurableRecoveryScheduleOutcome[];
  nextAfter: string | null;
}

export async function schedulePersistedIOSExternalRecoveryCandidateSlice(
  input: SchedulePersistedIOSExternalRecoveryCandidateSliceInput = {},
  dependencies: IOSDurableRecoverySchedulingDependencies = DEFAULT_DEPENDENCIES,
): Promise<SchedulePersistedIOSExternalRecoveryCandidateSliceResult> {
  const limit = input.limit ?? DEFAULT_CANDIDATE_SLICE_SIZE;
  if (
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > MAX_CANDIDATE_SLICE_SIZE ||
    (input.after !== undefined && typeof input.after !== 'string')
  ) {
    throw new Error('ios-durable-scan-contract-invalid');
  }
  const listed = await dependencies.listCandidates({
    limit,
    ...(input.after === undefined ? {} : { after: input.after }),
  });
  if (listed.kind === 'blocked') {
    return {
      outcomes: [
        {
          kind: listed.reason === 'journal_unavailable' ? 'deferred' : 'blocked',
          runId: '*',
          reason: listed.reason,
        },
      ],
      nextAfter: null,
    };
  }
  if (listed.nextAfter !== null && listed.nextAfter === input.after) {
    throw new Error('ios-durable-scan-cursor-stalled');
  }
  const outcomes: IOSDurableRecoveryScheduleOutcome[] = [];
  for (const candidate of listed.candidates) {
    outcomes.push(await schedulePersistedIOSExternalRecoveryRun(candidate.runId, dependencies));
  }
  return { outcomes, nextAfter: listed.nextAfter };
}
