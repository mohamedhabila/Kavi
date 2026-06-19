import type { GoalValidationError } from './validation';

export function formatGoalValidationErrorMessage(error: GoalValidationError): string {
  return error.goalId ? `[${error.goalId}] ${error.message}` : error.message;
}

export function serializeGoalMutationToolErrors(
  errors: ReadonlyArray<GoalValidationError>,
): Array<{ goalId?: string; code: string; message: string }> {
  return errors.map((error) => ({
    ...(error.goalId ? { goalId: error.goalId } : {}),
    code: error.code,
    message: error.message,
  }));
}

export function parseGoalMutationToolResultCodes(
  result: string | undefined,
): ReadonlyArray<string> {
  if (!result?.trim()) {
    return [];
  }

  try {
    const parsed: unknown = JSON.parse(result);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return [];
    }
    const record = parsed as Record<string, unknown>;
    if (record.status !== 'error') {
      return [];
    }

    const structuredErrors = Array.isArray(record.structuredErrors)
      ? record.structuredErrors
      : [];
    const codes = structuredErrors
      .filter(
        (entry): entry is Record<string, unknown> =>
          Boolean(entry) && typeof entry === 'object' && !Array.isArray(entry),
      )
      .map((entry) => (typeof entry.code === 'string' ? entry.code.trim() : ''))
      .filter(Boolean);

    return Array.from(new Set(codes));
  } catch {
    return [];
  }
}