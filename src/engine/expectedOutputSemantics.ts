export function trimExpectedOutput(value: string | undefined): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

export function readMeaningfulExpectedOutput(
  value: string | undefined,
): string | undefined {
  return trimExpectedOutput(value);
}
