jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import type { MobileControllerCapability } from '../../src/engine/mobileController/contracts';
import type { EffectDispatchIdentity } from '../../src/services/executionJournal/effectDispatchPolicy';
import { planEffectDispatch } from '../../src/services/executionJournal/effectDispatchPolicy';
import {
  closeExecutionJournalDb,
  getExecutionJournalDb,
} from '../../src/services/executionJournal/database';
import { persistClaimedMobileControllerHandoff } from '../../src/services/executionJournal/mobileControllerHandoffStore';
import { prepareToolEffectDispatchJournal } from '../../src/services/executionJournal/toolEffectDispatchStore';

const sqliteMock = jest.requireMock('expo-sqlite') as {
  __resetExpoSqliteForTests(): void;
};

const RAW_A = 'a'.repeat(64);
const RAW_B = 'b'.repeat(64);
const RAW_C = 'c'.repeat(64);
const RAW_D = 'd'.repeat(64);
const HANDOFF_ID = `mch_${'1'.repeat(32)}`;
const PRIVATE_TEXT = 'private input that must never enter the execution journal';

const capability: MobileControllerCapability = {
  version: 1,
  controllerId: 'android-controller-1',
  controllerContractVersion: 1,
  capabilityDigest: `sha256:${RAW_B}`,
  policyAdmissionDigest: `sha256:${RAW_C}`,
  environmentClass: 'sandbox',
  supportedActionKinds: ['set_text'],
  allowedAppIds: [],
  observationEvidence: ['screenshot', 'window_identity'],
  outcomeDeliveryModes: ['deferred'],
  normalizedCoordinateScale: 1_000,
  maxPendingActions: 1,
  maxPayloadBytes: 16_384,
  timeoutMs: 10_000,
};

function identity(): EffectDispatchIdentity {
  return {
    runId: `effect-run-${'1'.repeat(48)}`,
    effectId: `effect-${'1'.repeat(48)}`,
    executionRunId: 'execution-run-1',
    toolCallId: 'tool-call-1',
    toolName: 'mobile_ui_action',
    toolNameDigest: RAW_B,
    toolContractIdentityDigest: RAW_C,
    requestDigest: RAW_A,
    idempotencyKeyDigest: null,
    dispatchTargetDigest: RAW_D,
    expectedEffectKind: 'unknown',
    expectedResource: null,
    attempt: 1,
    controlEpoch: 0,
    authorityCheckpointId: `effect-authority-${'1'.repeat(48)}`,
  };
}

async function prepareClaimedHandoff() {
  const dispatchIdentity = identity();
  const prepared = prepareToolEffectDispatchJournal(
    {
      identity: dispatchIdentity,
      conversationId: 'conversation-1',
      inputDigest: RAW_A,
      dispatchTargetDigest: RAW_D,
      effectClass: 'external_run',
      idempotencyClass: 'not_declared',
      retryPolicy: 'reconcile_before_retry',
      requestedCapability: 'coordinate',
      executionSurface: 'builtin_tool',
      approvalState: 'not_required',
      permissionState: 'granted',
      preparedAt: 100,
      initialStateDigest: RAW_A,
      planningStateDigest: RAW_B,
      authorityStateDigest: RAW_C,
      modelEffectAuthority: { kind: 'policy_independent' },
    },
    {
      approvalGranted: () => true,
      permissionGranted: () => true,
      controlGranted: () => true,
    },
    async () => {
      throw new Error('controller dispatch is not part of journal setup');
    },
    { now: () => 110 },
  );
  const state = await prepared.ports.readState(dispatchIdentity);
  if (!state) throw new Error('expected prepared dispatch state');
  const decision = planEffectDispatch({
    identity: dispatchIdentity,
    snapshot: state.snapshot,
    evaluatedAt: 110,
  });
  if (decision.kind !== 'claim_dispatch') throw new Error('expected dispatch claim');
  const claim = await prepared.ports.claimAndStart(decision.candidate);
  if (claim.kind !== 'claimed') throw new Error('expected new dispatch claim');
  return {
    capability,
    handoff: {
      version: 1,
      handoffId: HANDOFF_ID,
      claimToken: claim.claim.claimToken,
      dispatchIdentity,
      controllerId: capability.controllerId,
      controllerContractVersion: capability.controllerContractVersion,
      capabilityDigest: capability.capabilityDigest,
      action: { kind: 'set_text', text: PRIVATE_TEXT },
      actionDigest: `sha256:${RAW_A}`,
      beforeObservation: {
        observationId: 'observation-before-1',
        digest: `sha256:${RAW_D}`,
        appId: 'app-1',
        windowId: 'window-1',
      },
      claimedAt: claim.claim.claimedAt,
      createdAt: 120,
      expiresAt: 1_120,
    },
  } as const;
}

function count(table: string): number {
  return (
    getExecutionJournalDb().getFirstSync<{ count: number }>(
      `SELECT COUNT(*) AS count FROM ${table}`,
    )?.count ?? -1
  );
}

beforeEach(() => {
  try {
    closeExecutionJournalDb();
  } catch {}
  sqliteMock.__resetExpoSqliteForTests();
});

afterEach(() => {
  try {
    closeExecutionJournalDb();
  } catch {}
});

describe('mobile controller handoff journal parking', () => {
  it('atomically parks one exact started effect without persisting private action data', async () => {
    const input = await prepareClaimedHandoff();

    const result = persistClaimedMobileControllerHandoff(input);

    expect(result).toEqual(
      expect.objectContaining({
        kind: 'persisted',
        run: expect.objectContaining({ status: 'waiting', updatedAt: 120 }),
        handle: expect.objectContaining({ status: 'pending', createdAt: 120 }),
        checkpoint: expect.objectContaining({
          boundary: 'waiting_external',
          stateRefId: HANDOFF_ID,
          stateDigest: RAW_A,
        }),
        handoffRef: expect.objectContaining({
          effectRunId: identity().runId,
          executionRunId: 'execution-run-1',
          toolCallId: 'tool-call-1',
          handoffId: HANDOFF_ID,
        }),
      }),
    );
    expect(
      getExecutionJournalDb().getFirstSync<{ run_status: string; effect_status: string }>(
        `SELECT r.status AS run_status, e.status AS effect_status
           FROM execution_runs r JOIN execution_effects e ON e.run_id = r.id`,
      ),
    ).toEqual({ run_status: 'waiting', effect_status: 'started' });
    expect(count('execution_external_handles')).toBe(1);
    expect(count('execution_monitors')).toBe(1);
    expect(count('execution_effect_receipts')).toBe(0);
    expect(
      getExecutionJournalDb().getFirstSync<{ locator_json: string }>(
        'SELECT locator_json FROM execution_external_handles',
      )?.locator_json,
    ).not.toContain(PRIVATE_TEXT);
  });

  it('replays the identical committed handoff without duplicating durable state', async () => {
    const input = await prepareClaimedHandoff();
    const first = persistClaimedMobileControllerHandoff(input);

    const replay = persistClaimedMobileControllerHandoff(input);

    expect(first.kind).toBe('persisted');
    expect(replay.kind).toBe('replayed');
    expect(replay.handoffRef).toEqual(first.handoffRef);
    expect(count('execution_external_handles')).toBe(1);
    expect(count('execution_monitors')).toBe(1);
    expect(
      getExecutionJournalDb().getFirstSync<{ count: number }>(
        `SELECT COUNT(*) AS count FROM execution_checkpoints WHERE boundary = 'waiting_external'`,
      )?.count,
    ).toBe(1);
  });

  it('rolls back the handle and monitor when the waiting checkpoint cannot commit', async () => {
    const input = await prepareClaimedHandoff();
    getExecutionJournalDb().execSync(
      `CREATE TRIGGER fail_mobile_waiting_checkpoint
       BEFORE INSERT ON execution_checkpoints
       WHEN NEW.boundary = 'waiting_external'
       BEGIN
         SELECT RAISE(ABORT, 'test_mobile_waiting_checkpoint_failure');
       END`,
    );

    expect(() => persistClaimedMobileControllerHandoff(input)).toThrow(
      'test_mobile_waiting_checkpoint_failure',
    );
    expect(count('execution_external_handles')).toBe(0);
    expect(count('execution_monitors')).toBe(0);
    expect(
      getExecutionJournalDb().getFirstSync<{ run_status: string; effect_status: string }>(
        `SELECT r.status AS run_status, e.status AS effect_status
           FROM execution_runs r JOIN execution_effects e ON e.run_id = r.id`,
      ),
    ).toEqual({ run_status: 'running', effect_status: 'started' });
  });

  it('rejects a cancelled claim before publishing any pending handle', async () => {
    const input = await prepareClaimedHandoff();
    getExecutionJournalDb().runSync(
      `UPDATE execution_recovery_controls SET cancellation_state = 'cancelled'
       WHERE run_id = ?`,
      identity().runId,
    );

    expect(() => persistClaimedMobileControllerHandoff(input)).toThrow(
      'mobile_controller_handoff_claim_conflict',
    );
    expect(count('execution_external_handles')).toBe(0);
    expect(count('execution_monitors')).toBe(0);
  });

  it('does not replay a committed handoff after cancellation or with a different claim token', async () => {
    const input = await prepareClaimedHandoff();
    persistClaimedMobileControllerHandoff(input);

    expect(() =>
      persistClaimedMobileControllerHandoff({
        ...input,
        handoff: { ...input.handoff, claimToken: 'effect-claim-forged' },
      }),
    ).toThrow('mobile_controller_handoff_claim_conflict');

    getExecutionJournalDb().runSync(
      `UPDATE execution_recovery_controls SET cancellation_state = 'cancelled'
       WHERE run_id = ?`,
      identity().runId,
    );
    expect(() => persistClaimedMobileControllerHandoff(input)).toThrow(
      'mobile_controller_handoff_claim_conflict',
    );
    expect(count('execution_external_handles')).toBe(1);
    expect(count('execution_monitors')).toBe(1);
  });
});
