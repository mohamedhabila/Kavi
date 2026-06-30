const BOOLEAN_STATE_FIELD_NAMES = ['checked', 'selected'] as const;

function hasObservedScalar(value: unknown): boolean {
  return value !== undefined && value !== null && value !== '';
}

function isAffirmativeState(value: unknown): boolean {
  if (value === true) return true;
  if (typeof value !== 'string') return false;
  return value.trim().toLocaleLowerCase() === 'true';
}

export function recordHasUiStateBearingValue(record: Record<string, unknown>): boolean {
  return (
    BOOLEAN_STATE_FIELD_NAMES.some((key) => hasObservedScalar(record[key])) ||
    isAffirmativeState(record.disabled) ||
    isAffirmativeState(record.expanded)
  );
}
