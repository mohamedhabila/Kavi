import type * as SQLite from 'expo-sqlite';

import { MOBILE_UI_ACTION_TOOL_NAME } from '../../engine/mobileController/contracts';
import { qualifyMobileControllerOutcome } from '../../engine/mobileController/validation';
import { buildStructuredToolEffectReceipt } from '../../engine/toolExecution/toolEffectReceipt';
import { digestToolContractIdentity } from '../../engine/toolExecution/toolContractIdentity';
import type { ToolMessageOutcome } from '../../engine/toolExecution/toolMessageOutcome';
import type { AgentRunMobileControllerHandoffRef } from '../../types/agentRun';
import type { ToolEffectReceipt } from '../../types/toolEffectReceipt';
import { qualifyAgentRunMobileControllerHandoffRef } from '../agents/mobileControllerAsyncOperation';
import { getExecutionJournalDb } from './database';
import { decodeExecutionCheckpointRow } from './decoders';
import { classifyEffectDispatchReceipt } from './effectDispatchCoordinator';
import {
  insertEffectReceipt,
  prepareEffectReceiptRecord,
  readStoredEffectReceipt,
} from './effectReceiptStore';
import { appendToolEffectDispatchTerminalCheckpoint } from './toolEffectDispatchJournalState';
import {
  readEffect,
  readHandle,
  readRun,
  withImmediateTransaction,
} from './mutationStore';
import { advanceExternalHandleMonitor, readExternalHandleMonitor } from './monitorRecords';
import type {
  ExecutionEffectStatus,
  ExecutionExternalHandleStatus,
  ExecutionRunStatus,
} from './types';

export type MobileControllerOutcomeSettlementResult = Readonly<{
  kind: 'settled' | 'replayed';
  handoff: AgentRunMobileControllerHandoffRef;
  outcome: NonNullable<ReturnType<typeof qualifyMobileControllerOutcome>>;
  receipt: ToolEffectReceipt;
  toolMessage: ToolMessageOutcome;
  requiresReconciliation: boolean;
  settledAt: number;
}>;

export interface MobileControllerOutcomeStoreOptions {
  getDatabase?: () => SQLite.SQLiteDatabase;
}

function validTimestamp(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function outcomeMatchesHandoff(
  outcome: NonNullable<ReturnType<typeof qualifyMobileControllerOutcome>>,
  handoff: AgentRunMobileControllerHandoffRef,
): boolean {
  const correlation = outcome.correlation;
  return (
    outcome.handoffId === handoff.handoffId &&
    outcome.controllerId === handoff.controllerId &&
    outcome.capabilityDigest === handoff.capabilityDigest &&
    outcome.beforeObservationId === handoff.beforeObservationId &&
    correlation.runId === handoff.effectRunId &&
    correlation.effectId === handoff.effectId &&
    correlation.executionRunId === handoff.executionRunId &&
    correlation.toolCallId === handoff.toolCallId
  );
}

function buildOutcomeResultText(
  outcome: NonNullable<ReturnType<typeof qualifyMobileControllerOutcome>>,
): string {
  return JSON.stringify({
    version: 1,
    outcomeId: outcome.outcomeId,
    handoffId: outcome.handoffId,
    executionState: outcome.executionState,
    effectState: outcome.effectState,
    verificationState: outcome.verificationState,
    observableDelta: outcome.observableDelta,
    ...(outcome.reasonCode ? { reasonCode: outcome.reasonCode } : {}),
    beforeObservationId: outcome.beforeObservationId,
    ...(outcome.afterObservation ? { afterObservation: outcome.afterObservation } : {}),
    ...(outcome.stabilization ? { stabilization: outcome.stabilization } : {}),
    observedAt: outcome.observedAt,
  });
}

function externalStatusFor(
  effectState: ToolEffectReceipt['effectState'],
): ExecutionExternalHandleStatus {
  if (effectState === 'applied') return 'succeeded';
  if (effectState === 'failed') return 'failed';
  if (effectState === 'cancelled') return 'cancelled';
  return 'unknown';
}

function runStatusFor(effectStatus: ExecutionEffectStatus): ExecutionRunStatus {
  if (effectStatus === 'verified') return 'succeeded';
  if (effectStatus === 'failed') return 'failed';
  if (effectStatus === 'cancelled') return 'cancelled';
  return 'ambiguous';
}

function resultFor(params: {
  kind: MobileControllerOutcomeSettlementResult['kind'];
  handoff: AgentRunMobileControllerHandoffRef;
  outcome: NonNullable<ReturnType<typeof qualifyMobileControllerOutcome>>;
  receipt: ToolEffectReceipt;
  resultText: string;
  requiresReconciliation: boolean;
  settledAt: number;
}): MobileControllerOutcomeSettlementResult {
  return Object.freeze({
    ...params,
    toolMessage: Object.freeze({
      version: 1,
      toolCallId: params.handoff.toolCallId,
      status:
        params.outcome.executionState === 'completed' && params.outcome.effectState === 'applied'
          ? 'completed'
          : 'failed',
      content: params.resultText,
    }),
  });
}

function locatorMatchesHandoff(
  locator: ReturnType<typeof readHandle>['locator'],
  handoff: AgentRunMobileControllerHandoffRef,
): boolean {
  return (
    locator.kind === 'mobile_controller_handoff' &&
    locator.handoffId === handoff.handoffId &&
    locator.controllerId === handoff.controllerId &&
    locator.controllerContractVersion === handoff.controllerContractVersion &&
    locator.capabilityDigest === handoff.capabilityDigest &&
    locator.actionDigest === handoff.actionDigest &&
    locator.beforeObservationId === handoff.beforeObservationId &&
    locator.beforeObservationDigest === handoff.beforeObservationDigest &&
    locator.expiresAt === handoff.expiresAt
  );
}

/** Atomically settle one exact graph-owned mobile handoff from host-observed facts. */
export async function settleMobileControllerOutcome(
  input: {
    handoff: unknown;
    outcome: unknown;
    receivedAt: number;
  },
  options: MobileControllerOutcomeStoreOptions = {},
): Promise<MobileControllerOutcomeSettlementResult> {
  const handoff = qualifyAgentRunMobileControllerHandoffRef(input.handoff);
  const outcome = qualifyMobileControllerOutcome(input.outcome);
  if (
    !handoff ||
    !outcome ||
    !validTimestamp(input.receivedAt) ||
    outcome.observedAt > input.receivedAt ||
    outcome.observedAt >= handoff.expiresAt ||
    !outcomeMatchesHandoff(outcome, handoff)
  ) {
    throw new Error('mobile_controller_outcome_invalid');
  }

  const resultText = buildOutcomeResultText(outcome);
  const receipt = await buildStructuredToolEffectReceipt({
    toolCallId: handoff.toolCallId,
    toolName: MOBILE_UI_ACTION_TOOL_NAME,
    executionRunId: handoff.executionRunId,
    dispatchRunId: handoff.effectRunId,
    executionState: outcome.executionState,
    effectKind: 'unknown',
    effectState: outcome.effectState,
    verificationState: outcome.verificationState,
    requestDigest: handoff.actionDigest,
    resultText,
    recordedAt: outcome.observedAt,
  });
  const [preparedReceipt, contractIdentityDigest] = await Promise.all([
    prepareEffectReceiptRecord(receipt),
    digestToolContractIdentity(receipt.contractIdentity),
  ]);
  const outcomeDigest = receipt.resultDigest.slice('sha256:'.length);
  const database = (options.getDatabase ?? getExecutionJournalDb)();

  return withImmediateTransaction(database, () => {
    const run = readRun(database, handoff.effectRunId);
    const effect = readEffect(database, handoff.effectRunId, handoff.effectId);
    const handle = readHandle(database, handoff.effectRunId, handoff.externalHandleId);
    const monitor = readExternalHandleMonitor(
      database,
      handoff.effectRunId,
      handoff.externalHandleId,
    );
    const latestRow = database.getFirstSync<unknown>(
      `SELECT * FROM execution_checkpoints
       WHERE run_id = ? ORDER BY sequence DESC LIMIT 1`,
      handoff.effectRunId,
    );
    if (!latestRow) throw new Error('mobile_controller_outcome_checkpoint_missing');
    const latest = decodeExecutionCheckpointRow(latestRow);
    if (
      run.taskId !== handoff.executionRunId ||
      run.controlEpoch !== handoff.controlEpoch ||
      effect.toolCallId !== handoff.toolCallId ||
      effect.requestDigest !== handoff.actionDigest.slice('sha256:'.length) ||
      effect.toolContractIdentityDigest !==
        contractIdentityDigest.slice('sha256:'.length) ||
      handle.effectId !== handoff.effectId ||
      !locatorMatchesHandoff(handle.locator, handoff)
    ) {
      throw new Error('mobile_controller_outcome_identity_conflict');
    }

    const existingReceipt = readStoredEffectReceipt(database, run.id, effect.id);
    if (existingReceipt) {
      if (
        existingReceipt.receiptDigest !== preparedReceipt.receiptDigest ||
        existingReceipt.receiptJson !== preparedReceipt.receiptJson ||
        effect.outcomeDigest !== outcomeDigest
      ) {
        throw new Error('mobile_controller_outcome_conflict');
      }
      const classification = classifyEffectDispatchReceipt('external_run', receipt);
      if (!classification) throw new Error('mobile_controller_outcome_receipt_invalid');
      return resultFor({
        kind: 'replayed',
        handoff,
        outcome,
        receipt,
        resultText,
        requiresReconciliation: classification.requiresReconciliation,
        settledAt: existingReceipt.persistedAt,
      });
    }

    if (
      input.receivedAt >= handoff.expiresAt ||
      outcome.observedAt < handle.createdAt ||
      run.status !== 'waiting' ||
      effect.status !== 'started' ||
      !['pending', 'running'].includes(handle.status) ||
      monitor.state !== 'armed' ||
      latest.id !== `mobile-wait-${handoff.handoffId.slice('mch_'.length)}` ||
      latest.boundary !== 'waiting_external' ||
      latest.stateRefId !== handoff.handoffId ||
      latest.stateDigest !== handoff.actionDigest.slice('sha256:'.length)
    ) {
      throw new Error('mobile_controller_outcome_state_conflict');
    }

    const classification = classifyEffectDispatchReceipt('external_run', receipt);
    if (!classification) throw new Error('mobile_controller_outcome_receipt_invalid');
    const settledAt = Math.max(
      input.receivedAt,
      run.updatedAt,
      effect.updatedAt,
      handle.updatedAt,
      monitor.updatedAt,
    );
    const receiptWrite = insertEffectReceipt(database, {
      runId: run.id,
      effectId: effect.id,
      ...preparedReceipt,
      persistedAt: settledAt,
    });
    if (receiptWrite !== 'recorded') {
      throw new Error('mobile_controller_outcome_receipt_conflict');
    }

    const externalStatus = externalStatusFor(receipt.effectState);
    const handleUpdate = database.runSync(
      `UPDATE execution_external_handles
       SET status = ?, updated_at = ?, last_attempted_at = ?, last_verified_at = ?
       WHERE run_id = ? AND id = ? AND status = ? AND updated_at = ?`,
      externalStatus,
      settledAt,
      settledAt,
      receipt.verificationState === 'verified' ? settledAt : handle.lastVerifiedAt,
      run.id,
      handle.id,
      handle.status,
      handle.updatedAt,
    );
    if (handleUpdate.changes !== 1) {
      throw new Error('mobile_controller_outcome_handle_conflict');
    }
    advanceExternalHandleMonitor(database, {
      runId: run.id,
      externalHandleId: handle.id,
      observedStatus: externalStatus,
      outcome: externalStatus === 'unknown' ? 'blocked' : 'acted',
      nextLegalCheckAt: null,
      occurredAt: settledAt,
    });

    const updateEffect = (expectedStatus: ExecutionEffectStatus, nextStatus: ExecutionEffectStatus) =>
      database.runSync(
        `UPDATE execution_effects
         SET status = ?, outcome_digest = ?, completed_at = ?, updated_at = ?
         WHERE run_id = ? AND id = ? AND status = ? AND started_at = ?`,
        nextStatus,
        outcomeDigest,
        settledAt,
        settledAt,
        run.id,
        effect.id,
        expectedStatus,
        effect.startedAt,
      );
    if (classification.nextEffectStatus === 'verified') {
      if (updateEffect('started', 'applied').changes !== 1) {
        throw new Error('mobile_controller_outcome_effect_conflict');
      }
      if (updateEffect('applied', 'verified').changes !== 1) {
        throw new Error('mobile_controller_outcome_effect_conflict');
      }
    } else if (updateEffect('started', classification.nextEffectStatus).changes !== 1) {
      throw new Error('mobile_controller_outcome_effect_conflict');
    }

    const runStatus = runStatusFor(classification.nextEffectStatus);
    if (runStatus !== 'ambiguous') {
      appendToolEffectDispatchTerminalCheckpoint(
        database,
        run,
        effect.id,
        outcomeDigest,
        settledAt,
      );
    }
    const runUpdate = database.runSync(
      `UPDATE execution_runs SET status = ?, updated_at = ?, terminal_at = ?
       WHERE id = ? AND status = 'waiting' AND control_epoch = ? AND updated_at = ?`,
      runStatus,
      settledAt,
      runStatus === 'ambiguous' ? null : settledAt,
      run.id,
      run.controlEpoch,
      run.updatedAt,
    );
    if (runUpdate.changes !== 1) {
      throw new Error('mobile_controller_outcome_run_conflict');
    }
    if (runStatus === 'cancelled') {
      const controlUpdate = database.runSync(
        `UPDATE execution_recovery_controls
         SET cancellation_state = 'cancelled', updated_at = ?
         WHERE run_id = ? AND cancellation_state IN ('active', 'cancel_requested')`,
        settledAt,
        run.id,
      );
      if (controlUpdate.changes !== 1) {
        throw new Error('mobile_controller_outcome_control_conflict');
      }
    }

    return resultFor({
      kind: 'settled',
      handoff,
      outcome,
      receipt,
      resultText,
      requiresReconciliation: classification.requiresReconciliation,
      settledAt,
    });
  });
}
