import type { ToolEffectReceipt } from '../../types/toolEffectReceipt';
import { getCodeOwnedToolEffectContract } from '../../engine/toolExecution/toolEffectReceiptContracts';
import type { ExecutionEffectClass, ExecutionEffectStatus } from './types';

export type EffectDispatchReceiptDisposition =
  | 'verified'
  | 'returned_unverified'
  | 'applied_unverified'
  | 'failed'
  | 'cancelled'
  | 'uncertain';

export interface EffectDispatchReceiptClassification {
  disposition: EffectDispatchReceiptDisposition;
  nextEffectStatus: Extract<
    ExecutionEffectStatus,
    'returned' | 'applied' | 'verified' | 'failed' | 'cancelled' | 'ambiguous'
  >;
  requiresReconciliation: boolean;
}

function isTerminalAcknowledgedNotification(receipt: ToolEffectReceipt): boolean {
  return (
    receipt.contractIdentity.kind === 'code_owned' &&
    receipt.toolName === 'notification_send' &&
    receipt.transportState === 'returned' &&
    receipt.effectKind === 'notification.send' &&
    receipt.verificationState === 'acknowledged' &&
    receipt.resource?.kind === 'notification' &&
    receipt.operationHandle?.kind === 'notification_request' &&
    receipt.resource.id === receipt.operationHandle.id
  );
}

function isReturnedCodeOwnedOperationalEffect(receipt: ToolEffectReceipt): boolean {
  return (
    receipt.contractIdentity.kind === 'code_owned' &&
    receipt.transportState === 'returned' &&
    getCodeOwnedToolEffectContract(receipt.toolName)?.receiptSettlementMode ===
      'returned_unverified'
  );
}

/**
 * The code-owned executor returned this exact dispatch's outcome: a change it applied, or a
 * handoff to another app (maps, the dialer, a share sheet). The effect happened even though
 * no read-back verified it, so it settles — it is never dispatched again and does not hold
 * back the execution's later effects — and stays unverified, so it is not goal evidence.
 * Only an outcome nobody reported (the executor threw, timed out or returned an undeclared
 * status) needs reconciling.
 */
function isReturnedCodeOwnedOutcome(receipt: ToolEffectReceipt): boolean {
  return receipt.contractIdentity.kind === 'code_owned' && receipt.transportState === 'returned';
}

const RETURNED_UNVERIFIED: EffectDispatchReceiptClassification = Object.freeze({
  disposition: 'returned_unverified',
  nextEffectStatus: 'returned',
  requiresReconciliation: false,
});

export function classifyEffectDispatchReceipt(
  effectClass: ExecutionEffectClass,
  receipt: ToolEffectReceipt,
): EffectDispatchReceiptClassification | null {
  switch (receipt.effectState) {
    case 'none':
      return effectClass === 'none'
        ? { disposition: 'verified', nextEffectStatus: 'verified', requiresReconciliation: false }
        : null;
    case 'applied':
      if (receipt.verificationState === 'verified') {
        return {
          disposition: 'verified',
          nextEffectStatus: 'verified',
          requiresReconciliation: false,
        };
      }
      if (isReturnedCodeOwnedOutcome(receipt)) return RETURNED_UNVERIFIED;
      return {
        disposition: 'applied_unverified',
        nextEffectStatus: 'applied',
        requiresReconciliation: true,
      };
    case 'failed':
      return { disposition: 'failed', nextEffectStatus: 'failed', requiresReconciliation: false };
    case 'cancelled':
      return {
        disposition: 'cancelled',
        nextEffectStatus: 'cancelled',
        requiresReconciliation: false,
      };
    case 'accepted':
      // The first-party notification executor returns only after the OS has
      // accepted the exact local notification request and supplied its stable
      // identifier. That acknowledgement is terminal for dispatch and replay,
      // but it does not claim that the user saw the notification.
      if (isTerminalAcknowledgedNotification(receipt)) {
        return {
          disposition: 'returned_unverified',
          nextEffectStatus: 'returned',
          requiresReconciliation: false,
        };
      }
      return {
        disposition: 'uncertain',
        nextEffectStatus: 'ambiguous',
        requiresReconciliation: true,
      };
    case 'handed_off':
      if (isReturnedCodeOwnedOutcome(receipt)) return RETURNED_UNVERIFIED;
    // A handoff nobody reported back is as uncertain as a pending or unknown outcome.
    // falls through
    case 'pending':
    case 'unknown':
      // An operational contract deliberately separates "the code-owned
      // operation returned" from user-level completion. Settle that durable
      // observation without making it verified goal evidence or retrying it.
      if (isReturnedCodeOwnedOperationalEffect(receipt)) {
        return {
          disposition: 'returned_unverified',
          nextEffectStatus: 'returned',
          requiresReconciliation: false,
        };
      }
      if (
        receipt.contractIdentity.kind === 'runtime_external' &&
        ((effectClass === 'unknown' && receipt.contractIdentity.effectClass === 'unknown') ||
          (effectClass !== 'none' &&
            receipt.contractIdentity.effectClass === 'potentially_effectful')) &&
        receipt.transportState === 'returned' &&
        receipt.executionState === 'completed' &&
        receipt.effectKind === 'unknown' &&
        receipt.verificationState === 'unverified'
      ) {
        return {
          disposition: 'returned_unverified',
          nextEffectStatus: 'returned',
          requiresReconciliation: false,
        };
      }
      return {
        disposition: 'uncertain',
        nextEffectStatus: 'ambiguous',
        requiresReconciliation: true,
      };
  }
}
