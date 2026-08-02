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

function isTerminalAcknowledgedCodeExecution(receipt: ToolEffectReceipt): boolean {
  return (
    receipt.contractIdentity.kind === 'code_owned' &&
    receipt.transportState === 'returned' &&
    receipt.executionState === 'completed' &&
    receipt.effectKind === 'compute.execute' &&
    receipt.effectState === 'applied' &&
    receipt.verificationState === 'acknowledged' &&
    getCodeOwnedToolEffectContract(receipt.toolName)?.receiptSettlementMode ===
      'acknowledged_returned_unverified'
  );
}

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
      // The reviewed code runtime has acknowledged that a completed local
      // workspace change was persisted. Settle the dispatch so the graph can
      // inspect it, without treating the artifact as verified goal evidence.
      if (isTerminalAcknowledgedCodeExecution(receipt)) {
        return {
          disposition: 'returned_unverified',
          nextEffectStatus: 'returned',
          requiresReconciliation: false,
        };
      }
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
