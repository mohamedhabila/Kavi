import type { ToolCall } from '../../types/message';
import type { ToolEffectRestartDisposition } from './toolEffectRestartDisposition';

export const VERIFIED_EFFECT_RESTART_RESULT =
  'The tool effect completed and was durably verified before the app restarted. The original tool response was not retained; verify current state before relying on details.';
export const AMBIGUOUS_EFFECT_RESTART_ERROR =
  'Tool execution was interrupted after durable dispatch. Its effect is ambiguous and requires reconciliation before any retry.';

export function projectToolCallAfterRestart(input: {
  toolCall: ToolCall;
  disposition: ToolEffectRestartDisposition;
  timestamp: number;
  interruptedErrorMessage: string;
}): Readonly<{ toolCall: ToolCall; recoveredAs: 'completed' | 'failed' }> {
  if (input.disposition.kind === 'verified') {
    return {
      recoveredAs: 'completed',
      toolCall: {
        ...input.toolCall,
        status: 'completed',
        updatedAt: input.timestamp,
        startedAt: input.toolCall.startedAt ?? input.disposition.observedAt,
        completedAt: Math.max(input.toolCall.startedAt ?? 0, input.disposition.observedAt),
        result: VERIFIED_EFFECT_RESTART_RESULT,
        error: undefined,
        failureKind: undefined,
      },
    };
  }
  return {
    recoveredAs: 'failed',
    toolCall: {
      ...input.toolCall,
      status: 'failed',
      failureKind: 'runtime_error',
      updatedAt: input.timestamp,
      startedAt: input.toolCall.startedAt ?? input.timestamp,
      completedAt: input.timestamp,
      result: undefined,
      error:
        input.toolCall.error ??
        (input.disposition.kind === 'reconciliation_required'
          ? AMBIGUOUS_EFFECT_RESTART_ERROR
          : input.interruptedErrorMessage),
    },
  };
}
