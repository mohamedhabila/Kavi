import type { ForegroundModelProjectionOwner } from '../types/conversation';

function validId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value === value.trim() &&
    value.length >= 1 &&
    value.length <= 200 &&
    !/[\u0000-\u001f\u007f]/u.test(value)
  );
}

export function isValidForegroundModelProjectionOwner(
  value: unknown,
): value is ForegroundModelProjectionOwner {
  if (!value || typeof value !== 'object') return false;
  const owner = value as Partial<ForegroundModelProjectionOwner>;
  return (
    validId(owner.runId) &&
    validId(owner.requestMessageId) &&
    validId(owner.assistantMessageId) &&
    Number.isSafeInteger(owner.controlEpoch) &&
    (owner.controlEpoch ?? -1) >= 0
  );
}

export function foregroundModelProjectionOwnersEqual(
  left: ForegroundModelProjectionOwner | undefined,
  right: ForegroundModelProjectionOwner,
): boolean {
  return (
    left?.runId === right.runId &&
    left.requestMessageId === right.requestMessageId &&
    left.assistantMessageId === right.assistantMessageId &&
    left.controlEpoch === right.controlEpoch
  );
}
