import {
  hashResult,
  recordToolCall,
  type PreflightBlockedKind,
  type ToolCallRecord,
} from '../loopDetection';
import type { ToolExecutionLifecycleMetricsRecorder } from './toolCallLifecycleTypes';

export async function yieldToUiFrame(): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 16);
  });
}

export function recordLifecycleToolCall(
  history: ToolCallRecord[],
  id: string | undefined,
  toolName: string,
  argumentsText: string,
  result: string | undefined,
  preflightBlockedKind?: PreflightBlockedKind,
): void {
  recordToolCall(history, {
    ...(id ? { id } : {}),
    name: toolName,
    arguments: argumentsText,
    timestamp: Date.now(),
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
