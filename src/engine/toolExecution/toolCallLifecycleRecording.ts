import {
  hashResult,
  recordToolCall,
  type PreflightBlockedKind,
  type ToolCallRecord,
} from '../loopDetection';
import type { ToolExecutionLifecycleMetricsRecorder } from './toolCallLifecycleTypes';
import type { ToolMessageOutcomeStatus } from './toolMessageOutcome';
import { waitForAppStateAwareDelay } from '../../utils/appStateAwareDelay';

export async function yieldToUiFrame(): Promise<void> {
  await waitForAppStateAwareDelay(16);
}

export function recordLifecycleToolCall(
  history: ToolCallRecord[],
  id: string | undefined,
  toolName: string,
  argumentsText: string,
  result: string | undefined,
  status: ToolMessageOutcomeStatus,
  preflightBlockedKind?: PreflightBlockedKind,
  modelTurnIteration?: number,
): void {
  recordToolCall(history, {
    ...(id ? { id } : {}),
    name: toolName,
    arguments: argumentsText,
    ...(modelTurnIteration === undefined ? {} : { modelTurnIteration }),
    timestamp: Date.now(),
    status,
    result,
    resultHash: hashResult(result),
    ...(preflightBlockedKind ? { preflightBlockedKind } : {}),
  });
}

export function recordLifecyclePerformanceMetrics(params: {
  enabled: boolean;
  recorder?: ToolExecutionLifecycleMetricsRecorder;
  startedAt: number;
  reason: string;
}): void {
  if (!params.enabled) {
    return;
  }

  params.recorder?.(
    {
      toolExecutionCount: 1,
      toolExecutionDurationMs: Date.now() - params.startedAt,
    },
    params.reason,
  );
}
