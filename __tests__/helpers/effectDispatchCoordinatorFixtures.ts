import type {
  AtomicEffectDispatchClaimResult,
  AtomicEffectDispatchSettlementResult,
  EffectDispatchAmbiguityCandidate,
  EffectDispatchClaimEvidence,
  EffectDispatchPorts,
  EffectDispatchReadState,
  EffectDispatchSettlementCandidate,
} from '../../src/services/executionJournal/effectDispatchCoordinator';
import type {
  EffectDispatchIdentity,
  EffectDispatchSnapshot,
} from '../../src/services/executionJournal/effectDispatchPolicy';
import type { ExecutionEffectRecord } from '../../src/services/executionJournal/types';
import type { ToolEffectReceipt } from '../../src/types/toolEffectReceipt';
import { decodeToolEffectReceipt } from '../../src/utils/toolEffectReceipt';
import {
  DIGEST_A,
  DIGEST_B,
  DIGEST_C,
  DIGEST_D,
  executionCheckpointRecord,
  executionRunRecord,
} from './executionJournalMutationFixtures';

export function dispatchFixture(): {
  identity: EffectDispatchIdentity;
  snapshot: EffectDispatchSnapshot;
} {
  const run = executionRunRecord({
    status: 'running',
    updatedAt: 14,
    modelConfigDigest: DIGEST_C,
    resumeStrategy: 'reconcile_first',
    nextRetryPolicy: 'reconcile_before_retry',
  });
  const planningCheckpoint = executionCheckpointRecord(run, {
    id: 'checkpoint-planning',
    sequence: 1,
    phase: 'work',
    boundary: 'before_effect',
    stateRefId: 'state-planning',
    resumeStrategy: 'reconcile_first',
    createdAt: 12,
  });
  const effect: ExecutionEffectRecord = {
    id: 'effect-1',
    runId: run.id,
    checkpointId: planningCheckpoint.id,
    toolCallId: 'tool-call-1',
    toolNameDigest: DIGEST_A,
    toolContractIdentityDigest: 'ef1177a4f9ec34ec69b33a9e20b7c310d6e732b6e986810e07916c660fdf88ca',
    effectClass: 'remote_mutation',
    idempotencyClass: 'declared_idempotent',
    idempotencyKeyDigest: DIGEST_D,
    requestDigest: DIGEST_B,
    modelAuthorityValidUntil: null,
    outcomeDigest: null,
    status: 'planned',
    retryPolicy: 'reconcile_before_retry',
    attempt: 1,
    createdAt: 13,
    startedAt: null,
    completedAt: null,
    updatedAt: 13,
  };
  const authorityCheckpoint = executionCheckpointRecord(run, {
    id: 'checkpoint-authority',
    sequence: 2,
    phase: 'work',
    boundary: 'before_effect',
    stateRefId: 'state-authority',
    resumeStrategy: 'reconcile_first',
    createdAt: 14,
  });
  return {
    identity: {
      runId: run.id,
      effectId: effect.id,
      executionRunId: run.taskId ?? 'task-1',
      toolCallId: effect.toolCallId,
      toolName: 'calendar_update',
      toolNameDigest: effect.toolNameDigest,
      toolContractIdentityDigest:
        'ef1177a4f9ec34ec69b33a9e20b7c310d6e732b6e986810e07916c660fdf88ca',
      requestDigest: effect.requestDigest,
      idempotencyKeyDigest: effect.idempotencyKeyDigest,
      dispatchTargetDigest: DIGEST_C,
      expectedEffectKind: 'calendar.update',
      expectedResource: { kind: 'calendar_event', id: 'event-1' },
      attempt: effect.attempt,
      controlEpoch: run.controlEpoch,
      authorityCheckpointId: authorityCheckpoint.id,
    },
    snapshot: {
      run,
      effect,
      planningCheckpoint,
      authorityCheckpoint,
      latestCheckpointId: authorityCheckpoint.id,
      authorizationExpiresAt: 30,
    },
  };
}

export function effectReceipt(overrides: Partial<ToolEffectReceipt> = {}): ToolEffectReceipt {
  const receipt = decodeToolEffectReceipt({
    version: 2,
    receiptId: 'ter_0123456789abcdef0123456789abcdef',
    toolCallId: 'tool-call-1',
    toolName: 'calendar_update',
    contractIdentity: {
      kind: 'code_owned',
      version: 1,
      toolName: 'calendar_update',
      schemaDigest: `sha256:${DIGEST_A}`,
      capabilityContractDigest: `sha256:${DIGEST_A}`,
      workflowContractDigest: `sha256:${DIGEST_A}`,
      effectContractDigest: `sha256:${DIGEST_A}`,
      executionPolicyDigest: `sha256:${DIGEST_A}`,
    },
    executionRunId: 'task-1',
    dispatchRunId: 'run-1',
    transportState: 'returned',
    effectKind: 'calendar.update',
    effectState: 'applied',
    verificationState: 'verified',
    requestDigest: `sha256:${DIGEST_B}`,
    resultDigest: `sha256:${DIGEST_C}`,
    resource: { kind: 'calendar_event', id: 'event-1' },
    recordedAt: 16,
    ...overrides,
  });
  if (!receipt) throw new Error('invalid test receipt');
  return receipt;
}

export function claimFor(identity: EffectDispatchIdentity): EffectDispatchClaimEvidence {
  return { claimToken: 'claim-1', identity, claimedAt: 15 };
}

export function effectDispatchHarness(
  options: {
    state?: EffectDispatchReadState | null;
    claimResult?: AtomicEffectDispatchClaimResult;
    dispatchResult?: unknown;
    dispatchError?: Error;
    settlementResult?: AtomicEffectDispatchSettlementResult;
    settlementError?: Error;
    now?: number[];
  } = {},
) {
  const fixture = dispatchFixture();
  const calls = {
    claims: [] as Parameters<EffectDispatchPorts['claimAndStart']>,
    dispatches: [] as EffectDispatchClaimEvidence[],
    settlements: [] as EffectDispatchSettlementCandidate[],
    ambiguities: [] as EffectDispatchAmbiguityCandidate[],
  };
  let durableClaim: EffectDispatchClaimEvidence | null =
    options.state?.existingClaim?.claim ?? null;
  let durableReceipt: unknown | null = options.state?.existingClaim?.receipt ?? null;
  const times = [...(options.now ?? [15, 16, 17, 18])];
  const ports: EffectDispatchPorts = {
    now: () => times.shift() ?? 18,
    readState: async () =>
      options.state === null
        ? null
        : {
            snapshot: options.state?.snapshot ?? fixture.snapshot,
            existingClaim: durableClaim ? { claim: durableClaim, receipt: durableReceipt } : null,
          },
    claimAndStart: async (candidate) => {
      calls.claims.push(candidate);
      if (options.claimResult) return options.claimResult;
      if (durableClaim) {
        return { kind: 'existing', claim: durableClaim, receipt: durableReceipt };
      }
      durableClaim = claimFor(candidate.identity);
      return { kind: 'claimed', claim: durableClaim };
    },
    dispatch: async (claim) => {
      calls.dispatches.push(claim);
      if (options.dispatchError) throw options.dispatchError;
      return options.dispatchResult ?? effectReceipt();
    },
    settle: async (candidate) => {
      calls.settlements.push(candidate);
      if (options.settlementError) throw options.settlementError;
      if (options.settlementResult) return options.settlementResult;
      if (durableReceipt) return { kind: 'replayed' };
      durableReceipt = candidate.receipt;
      return { kind: 'recorded' };
    },
    markAmbiguous: async (candidate) => {
      calls.ambiguities.push(candidate);
    },
  };
  return { ...fixture, calls, ports };
}

export function effectFreeHarness() {
  const fixture = dispatchFixture();
  const identity: EffectDispatchIdentity = {
    ...fixture.identity,
    idempotencyKeyDigest: null,
    expectedEffectKind: 'observation.read',
    expectedResource: null,
  };
  const snapshot: EffectDispatchSnapshot = {
    ...fixture.snapshot,
    effect: {
      ...fixture.snapshot.effect,
      effectClass: 'none',
      idempotencyClass: 'effect_free',
      idempotencyKeyDigest: null,
      retryPolicy: 'replay_safe',
    },
  };
  const receipt = effectReceipt({
    effectKind: 'observation.read',
    effectState: 'none',
    verificationState: 'not_applicable',
    resource: undefined,
  });
  return {
    ...effectDispatchHarness({
      state: { snapshot, existingClaim: null },
      dispatchResult: receipt,
    }),
    identity,
  };
}
