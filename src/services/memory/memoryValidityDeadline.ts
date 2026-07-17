export type MemoryValidityDeadline = number;

export function isMemoryValidityTimestamp(value: unknown): value is MemoryValidityDeadline {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

export function isMemoryValidityDeadlineCurrent(
  validUntil: MemoryValidityDeadline | null | undefined,
  now = Date.now(),
): boolean {
  if (validUntil === null || validUntil === undefined) return true;
  return (
    isMemoryValidityTimestamp(now) && isMemoryValidityTimestamp(validUntil) && now < validUntil
  );
}

export function requireFutureMemoryValidityDeadline(
  validUntil: unknown,
  now: number,
  code = 'memory_validity_deadline_invalid',
): MemoryValidityDeadline {
  if (
    !isMemoryValidityTimestamp(now) ||
    !isMemoryValidityTimestamp(validUntil) ||
    validUntil <= now
  ) {
    throw new Error(code);
  }
  return validUntil;
}

export function earliestFutureMemoryValidityDeadline(
  deadlines: ReadonlyArray<number | null | undefined>,
  now: number,
): MemoryValidityDeadline | undefined {
  if (!isMemoryValidityTimestamp(now)) {
    throw new Error('memory_validity_observed_at_invalid');
  }
  let earliest: MemoryValidityDeadline | undefined;
  for (const candidate of deadlines) {
    if (candidate === null || candidate === undefined) continue;
    const validUntil = requireFutureMemoryValidityDeadline(candidate, now);
    if (earliest === undefined || validUntil < earliest) earliest = validUntil;
  }
  return earliest;
}
