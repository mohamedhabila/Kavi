export const LOCAL_LLM_CONTEXT_PRESSURE_ERROR_CODE = 'LOCAL_LLM_CONTEXT_PRESSURE';

export type LocalLlmContextPressureReason =
  | 'conversation_exceeds_budget'
  | 'current_message_exceeds_budget'
  | 'system_prompt_exceeds_budget'
  | 'tool_payload_exceeds_budget';

export type LocalLlmContextCompactionState =
  | 'full'
  | 'history_windowed'
  | 'history_compacted';

export interface LocalLlmContextTelemetry {
  contextWindowTokens: number | null;
  inputBudgetTokens: number | null;
  estimatedInputTokens: number;
  contextPressureRatio: number | null;
  compactionState: LocalLlmContextCompactionState;
}

export interface LocalLlmContextPressureDetails {
  modelName: string;
  reason: LocalLlmContextPressureReason;
  contextWindowTokens: number | null;
  inputBudgetTokens: number | null;
  estimatedInputTokens: number;
}

export class LocalLlmContextPressureError extends Error {
  readonly code = LOCAL_LLM_CONTEXT_PRESSURE_ERROR_CODE;
  readonly reason: LocalLlmContextPressureReason;
  readonly details: LocalLlmContextPressureDetails;

  constructor(details: LocalLlmContextPressureDetails) {
    super(
      `${details.modelName} input exceeds the current on-device context window limit. The graph must compact or reduce context before local inference.`,
    );
    this.name = 'LocalLlmContextPressureError';
    this.reason = details.reason;
    this.details = details;
  }
}

export function isLocalLlmContextPressureError(
  error: unknown,
): error is LocalLlmContextPressureError {
  return (
    Boolean(error) &&
    typeof error === 'object' &&
    (error as { code?: unknown }).code === LOCAL_LLM_CONTEXT_PRESSURE_ERROR_CODE
  );
}

export function createLocalLlmContextPressureError(
  details: LocalLlmContextPressureDetails,
): LocalLlmContextPressureError {
  return new LocalLlmContextPressureError(details);
}

export function buildLocalLlmContextTelemetry(params: {
  contextWindowTokens: number | null;
  inputBudgetTokens: number | null;
  estimatedInputTokens: number;
  compactionState: LocalLlmContextCompactionState;
}): LocalLlmContextTelemetry {
  const contextPressureRatio =
    params.inputBudgetTokens != null && params.inputBudgetTokens > 0
      ? params.estimatedInputTokens / params.inputBudgetTokens
      : null;

  return {
    contextWindowTokens: params.contextWindowTokens,
    inputBudgetTokens: params.inputBudgetTokens,
    estimatedInputTokens: params.estimatedInputTokens,
    contextPressureRatio,
    compactionState: params.compactionState,
  };
}

export function buildNativeLocalLlmContextTelemetryFields(context: LocalLlmContextTelemetry): {
  estimatedInputTokens: number;
  inputBudgetTokens: number | null;
  contextPressureRatio: number | null;
  contextCompactionState: LocalLlmContextCompactionState;
} {
  return {
    estimatedInputTokens: context.estimatedInputTokens,
    inputBudgetTokens: context.inputBudgetTokens,
    contextPressureRatio: context.contextPressureRatio,
    contextCompactionState: context.compactionState,
  };
}
