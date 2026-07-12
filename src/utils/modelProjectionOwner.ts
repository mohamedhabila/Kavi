import type { ModelProjectionOwner } from '../types/conversation';

function validId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value === value.trim() &&
    value.length >= 1 &&
    value.length <= 200 &&
    !/[\u0000-\u001f\u007f]/u.test(value)
  );
}

export function isValidModelProjectionOwner(value: unknown): value is ModelProjectionOwner {
  if (!value || typeof value !== 'object') return false;
  const owner = value as Partial<ModelProjectionOwner>;
  return (
    (owner.surface === 'foreground' || owner.surface === 'scheduler') &&
    validId(owner.runId) &&
    validId(owner.requestMessageId) &&
    validId(owner.assistantMessageId) &&
    Number.isSafeInteger(owner.controlEpoch) &&
    (owner.controlEpoch ?? -1) >= 0
  );
}

export function modelProjectionOwnersEqual(
  left: ModelProjectionOwner | undefined,
  right: ModelProjectionOwner,
): boolean {
  return (
    left?.surface === right.surface &&
    left.runId === right.runId &&
    left.requestMessageId === right.requestMessageId &&
    left.assistantMessageId === right.assistantMessageId &&
    left.controlEpoch === right.controlEpoch
  );
}
