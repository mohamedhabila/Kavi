const DIRECT_VALUE_SUFFIXES = new Set([
  '',
  'by default',
  'from now on',
  'going forward',
  'in general',
]);

function normalizeSuffix(value: string): string {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replace(/^[\p{P}\p{Z}\s]+|[\p{P}\p{Z}\s]+$/gu, '')
    .replace(/\s+/gu, ' ');
}

export function hasExactDirectClaimSuffix(input: {
  text: string;
  suffixBoundary: number;
  clauseEnd: number;
}): boolean {
  return DIRECT_VALUE_SUFFIXES.has(
    normalizeSuffix(input.text.slice(input.suffixBoundary, input.clauseEnd)),
  );
}
