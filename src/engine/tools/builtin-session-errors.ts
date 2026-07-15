import { failedToolOutcome, type ToolRuntimeOutcome } from '../../types/toolRuntimeOutcome';

export const SESSION_NOT_FOUND_ERROR_CODE = 'session_not_found';

export function failedSessionNotFoundOutcome(sessionId: string): ToolRuntimeOutcome {
  return failedToolOutcome(
    JSON.stringify({
      status: 'failed',
      code: SESSION_NOT_FOUND_ERROR_CODE,
      sessionId,
      message: 'Session not found.',
    }),
  );
}
