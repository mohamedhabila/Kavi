// ---------------------------------------------------------------------------
// Kavi — Tool Call Lifecycle Receipt Helpers
// ---------------------------------------------------------------------------
// Extracted from toolCallLifecycle.ts to keep that file under the project's
// line-count limit. Builds and attaches code-owned effect receipts, and
// forwards raw outcomes to the verified-procedure session.

import { buildToolEffectReceipt } from './toolEffectReceipt';
import { appendToolEffectReceipt } from '../../utils/toolEffectReceipt';
import type { ToolCall } from '../../types/message';
import type { ToolEffectReceipt } from '../../types/toolEffectReceipt';
import type { ToolExecutionLifecycleParams } from './toolCallLifecycleTypes';

export function attachExecutionReceipt(params: {
  lifecycle: ToolExecutionLifecycleParams;
  toolCall: ToolCall;
  receipt: ToolEffectReceipt;
}): void {
  params.toolCall.effectReceipts = appendToolEffectReceipt(
    params.toolCall.effectReceipts,
    params.receipt,
    { toolCallId: params.toolCall.id, toolName: params.toolCall.name },
  );
}

export async function appendExecutionReceipt(params: {
  lifecycle: ToolExecutionLifecycleParams;
  toolCall: ToolCall;
  result: string;
  transportState: 'returned' | 'rejected' | 'threw';
  resultIsError?: boolean;
  terminalEffectState?: 'cancelled' | 'failed';
  recordedAt: number;
}): Promise<ToolEffectReceipt | undefined> {
  let receipt: ToolEffectReceipt;
  try {
    receipt = await buildToolEffectReceipt({
      toolCallId: params.toolCall.id,
      toolName: params.toolCall.name,
      argumentsText: params.toolCall.arguments,
      resultText: params.result,
      transportState: params.transportState,
      resultIsError: params.resultIsError,
      terminalEffectState: params.terminalEffectState,
      executionRunId: params.lifecycle.executionRunId,
      recordedAt: params.recordedAt,
    });
  } catch {
    // Receipt creation is fail-closed: absence remains unknown and never becomes success evidence.
    return undefined;
  }

  attachExecutionReceipt({ lifecycle: params.lifecycle, toolCall: params.toolCall, receipt });
  return receipt;
}

export async function observeVerifiedProcedureRawOutcome(params: {
  lifecycle: ToolExecutionLifecycleParams;
  toolCall: ToolCall;
  resultText: string;
  receipt?: ToolEffectReceipt;
  reconciliationRequired?: boolean;
}): Promise<void> {
  try {
    await params.lifecycle.verifiedProcedureSession?.observeRawOutcome({
      iteration: params.lifecycle.iteration,
      batchIndex: params.lifecycle.batchIndex,
      toolCallId: params.toolCall.id,
      toolName: params.toolCall.name,
      argumentsText: params.toolCall.arguments,
      resultText: params.resultText,
      receipt: params.receipt,
      reconciliationRequired: params.reconciliationRequired,
    });
  } catch {
    params.lifecycle.verifiedProcedureSession?.markReconciliationRequired();
  }
}
