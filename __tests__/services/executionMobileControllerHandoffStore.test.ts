jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import type { MobileControllerCapability } from '../../src/engine/mobileController/contracts';
import {
  buildToolContractIdentity,
  digestToolContractIdentity,
} from '../../src/engine/toolExecution/toolContractIdentity';
import type { EffectDispatchIdentity } from '../../src/services/executionJournal/effectDispatchPolicy';
import { planEffectDispatch } from '../../src/services/executionJournal/effectDispatchPolicy';
import {
  closeExecutionJournalDb,
  getExecutionJournalDb,
} from '../../src/services/executionJournal/database';
import { persistClaimedMobileControllerHandoff } from '../../src/services/executionJournal/mobileControllerHandoffStore';
import { settleMobileControllerOutcome } from '../../src/services/executionJournal/mobileControllerOutcomeStore';
import { prepareToolEffectDispatchJournal } from '../../src/services/executionJournal/toolEffectDispatchStore';
import type { AgentRunMobileControllerHandoffRef } from '../../src/types/agentRun';

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
  supportedActionKinds: ['input_text'],
  allowedAppIds: [],
  observationEvidence: ['screenshot', 'window_identity'],
  outcomeDeliveryModes: ['deferred'],
  normalizedCoordinateScale: 1_000,
  maxPendingActions: 1,
  maxPayloadBytes: 16_384,
  timeoutMs: 10_000,
};

function identity(toolContractIdentityDigest = RAW_C): EffectDispatchIdentity {
  return {
    runId: `effect-run-${'1'.repeat(48)}`,
    effectId: `effect-${'1'.repeat(48)}`,
    executionRunId: 'execution-run-1',
    toolCallId: 'tool-call-1',
    toolName: 'mobile_ui_action',
    toolNameDigest: RAW_B,
    toolContractIdentityDigest,
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
  const contractIdentity = await buildToolContractIdentity('mobile_ui_action');
  if (!contractIdentity) throw new Error('expected mobile controller contract identity');
  const contractIdentityDigest = await digestToolContractIdentity(contractIdentity);
  const dispatchIdentity = identity(contractIdentityDigest.slice('sha256:'.length));
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
      action: { kind: 'input_text', text: PRIVATE_TEXT },
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

function outcomeFor(
  handoff: AgentRunMobileControllerHandoffRef,
  overrides: Record<string, unknown> = {},
) {
  return {
    version: 1,
    outcomeId: `mco_${'2'.repeat(32)}`,
    handoffId: handoff.handoffId,
    controllerId: handoff.controllerId,
    capabilityDigest: handoff.capabilityDigest,
    correlation: {
      runId: handoff.effectRunId,
      effectId: handoff.effectId,
      executionRunId: handoff.executionRunId,
      toolCallId: handoff.toolCallId,
    },
    executionState: 'completed',
    effectState: 'applied',
    verificationState: 'verified',
    observableDelta: 'changed',
    reasonCode: 'completed',
    beforeObservationId: handoff.beforeObservationId,
    afterObservation: {
      observationId: 'observation-after-1',
      digest: `sha256:${'e'.repeat(64)}`,
      appId: 'app-1',
      windowId: 'window-2',
    },
    stabilization: { durationMs: 250, sampleCount: 2 },
    observedAt: 130,
    ...overrides,
  };
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

describe('mobile controller outcome settlement', () => {
  it('atomically records a verified outcome against the original claim', async () => {
    const parked = persistClaimedMobileControllerHandoff(await prepareClaimedHandoff());

    const settlement = await settleMobileControllerOutcome({
      handoff: parked.handoffRef,
      outcome: outcomeFor(parked.handoffRef),
      receivedAt: 140,
    });

    expect(settlement).toMatchObject({
      kind: 'settled',
      requiresReconciliation: false,
      receipt: {
        toolCallId: 'tool-call-1',
        toolName: 'mobile_ui_action',
        executionState: 'completed',
        effectState: 'applied',
        verificationState: 'verified',
      },
      toolMessage: {
        toolCallId: 'tool-call-1',
        status: 'completed',
      },
    });
    expect(
      getExecutionJournalDb().getFirstSync<{
        run_status: string;
        effect_status: string;
        handle_status: string;
        monitor_state: string;
      }>(
        `SELECT r.status AS run_status, e.status AS effect_status,
                h.status AS handle_status, m.state AS monitor_state
           FROM execution_runs r
           JOIN execution_effects e ON e.run_id = r.id
           JOIN execution_external_handles h ON h.run_id = r.id
           JOIN execution_monitors m ON m.run_id = r.id`,
      ),
    ).toEqual({
      run_status: 'succeeded',
      effect_status: 'verified',
      handle_status: 'succeeded',
      monitor_state: 'acted',
    });
    expect(count('execution_effect_receipts')).toBe(1);
    expect(
      getExecutionJournalDb().getFirstSync<{ count: number }>(
        `SELECT COUNT(*) AS count FROM execution_checkpoints WHERE boundary = 'terminal'`,
      )?.count,
    ).toBe(1);
    expect(JSON.stringify(settlement)).not.toContain(PRIVATE_TEXT);
  });

  it('replays the same outcome without duplicating a receipt or terminal checkpoint', async () => {
    const parked = persistClaimedMobileControllerHandoff(await prepareClaimedHandoff());
    const outcome = outcomeFor(parked.handoffRef);
    const first = await settleMobileControllerOutcome({
      handoff: parked.handoffRef,
      outcome,
      receivedAt: 140,
    });

    const replay = await settleMobileControllerOutcome({
      handoff: parked.handoffRef,
      outcome,
      receivedAt: 2_000,
    });

    expect(first.kind).toBe('settled');
    expect(replay.kind).toBe('replayed');
    expect(replay.receipt).toEqual(first.receipt);
    expect(count('execution_effect_receipts')).toBe(1);
    expect(
      getExecutionJournalDb().getFirstSync<{ count: number }>(
        `SELECT COUNT(*) AS count FROM execution_checkpoints WHERE boundary = 'terminal'`,
      )?.count,
    ).toBe(1);
  });

  it('preserves an unknown effect as ambiguous and blocks automatic monitoring', async () => {
    const parked = persistClaimedMobileControllerHandoff(await prepareClaimedHandoff());

    const settlement = await settleMobileControllerOutcome({
      handoff: parked.handoffRef,
      outcome: outcomeFor(parked.handoffRef, {
        executionState: 'unknown',
        effectState: 'unknown',
        verificationState: 'unverified',
        observableDelta: 'unknown',
        reasonCode: 'effect_unknown',
        afterObservation: undefined,
        stabilization: undefined,
      }),
      receivedAt: 140,
    });

    expect(settlement).toMatchObject({
      kind: 'settled',
      requiresReconciliation: true,
      toolMessage: { status: 'failed' },
    });
    expect(
      getExecutionJournalDb().getFirstSync<{
        run_status: string;
        effect_status: string;
        handle_status: string;
        monitor_state: string;
      }>(
        `SELECT r.status AS run_status, e.status AS effect_status,
                h.status AS handle_status, m.state AS monitor_state
           FROM execution_runs r
           JOIN execution_effects e ON e.run_id = r.id
           JOIN execution_external_handles h ON h.run_id = r.id
           JOIN execution_monitors m ON m.run_id = r.id`,
      ),
    ).toEqual({
      run_status: 'ambiguous',
      effect_status: 'ambiguous',
      handle_status: 'unknown',
      monitor_state: 'blocked',
    });
    expect(
      getExecutionJournalDb().getFirstSync<{ count: number }>(
        `SELECT COUNT(*) AS count FROM execution_checkpoints WHERE boundary = 'terminal'`,
      )?.count,
    ).toBe(0);
  });

  it('rejects stale or mismatched outcomes without mutating the parked claim', async () => {
    const parked = persistClaimedMobileControllerHandoff(await prepareClaimedHandoff());

    await expect(
      settleMobileControllerOutcome({
        handoff: parked.handoffRef,
        outcome: outcomeFor(parked.handoffRef, {
          correlation: {
            ...outcomeFor(parked.handoffRef).correlation,
            toolCallId: 'different-tool-call',
          },
        }),
        receivedAt: 140,
      }),
    ).rejects.toThrow('mobile_controller_outcome_invalid');
    await expect(
      settleMobileControllerOutcome({
        handoff: parked.handoffRef,
        outcome: outcomeFor(parked.handoffRef),
        receivedAt: parked.handoffRef.expiresAt,
      }),
    ).rejects.toThrow('mobile_controller_outcome_state_conflict');

    expect(count('execution_effect_receipts')).toBe(0);
    expect(
      getExecutionJournalDb().getFirstSync<{ run_status: string; effect_status: string }>(
        `SELECT r.status AS run_status, e.status AS effect_status
           FROM execution_runs r JOIN execution_effects e ON e.run_id = r.id`,
      ),
    ).toEqual({ run_status: 'waiting', effect_status: 'started' });
  });

  it('rolls back the receipt when a later settlement mutation fails', async () => {
    const parked = persistClaimedMobileControllerHandoff(await prepareClaimedHandoff());
    const database = getExecutionJournalDb();
    const runSync = database.runSync.bind(database);
    const handleUpdateFault = jest
      .spyOn(database, 'runSync')
      .mockImplementation((sql, ...params) => {
        if (sql.includes('UPDATE execution_external_handles')) {
          throw new Error('test_mobile_outcome_handle_failure');
        }
        return runSync(sql, ...params);
      });

    try {
      await expect(
        settleMobileControllerOutcome({
          handoff: parked.handoffRef,
          outcome: outcomeFor(parked.handoffRef),
          receivedAt: 140,
        }),
      ).rejects.toThrow('test_mobile_outcome_handle_failure');
    } finally {
      handleUpdateFault.mockRestore();
    }

    expect(count('execution_effect_receipts')).toBe(0);
    expect(
      getExecutionJournalDb().getFirstSync<{ run_status: string; effect_status: string }>(
        `SELECT r.status AS run_status, e.status AS effect_status
           FROM execution_runs r JOIN execution_effects e ON e.run_id = r.id`,
      ),
    ).toEqual({ run_status: 'waiting', effect_status: 'started' });
  });
});
