export const AGENT_RUNTIME_ERROR_CODES = {
  AGENT_RUN_ABORTED: 'agent_run_aborted',
  FOREGROUND_MODEL_GENERATION_CHANGED: 'foreground_model_journal_generation_changed',
} as const;

export type AgentRuntimeErrorCode =
  (typeof AGENT_RUNTIME_ERROR_CODES)[keyof typeof AGENT_RUNTIME_ERROR_CODES];

export class AgentRuntimeError<TCode extends AgentRuntimeErrorCode> extends Error {
  readonly code: TCode;

  constructor(code: TCode, message: string, cause?: unknown) {
    super(message);
    this.name = 'AgentRuntimeError';
    this.code = code;
    if (cause !== undefined) {
      this.cause = cause;
    }
  }
}

export function isAgentRuntimeErrorCode<TCode extends AgentRuntimeErrorCode>(
  error: unknown,
  code: TCode,
): error is AgentRuntimeError<TCode> {
  return error instanceof AgentRuntimeError && error.code === code;
}

export function createAgentRunAbortError(
  message: string,
  cause?: unknown,
): AgentRuntimeError<typeof AGENT_RUNTIME_ERROR_CODES.AGENT_RUN_ABORTED> {
  const error = new AgentRuntimeError(AGENT_RUNTIME_ERROR_CODES.AGENT_RUN_ABORTED, message, cause);
  error.name = 'AbortError';
  return error;
}

export function createForegroundModelGenerationChangedError(): AgentRuntimeError<
  typeof AGENT_RUNTIME_ERROR_CODES.FOREGROUND_MODEL_GENERATION_CHANGED
> {
  return new AgentRuntimeError(
    AGENT_RUNTIME_ERROR_CODES.FOREGROUND_MODEL_GENERATION_CHANGED,
    AGENT_RUNTIME_ERROR_CODES.FOREGROUND_MODEL_GENERATION_CHANGED,
  );
}
