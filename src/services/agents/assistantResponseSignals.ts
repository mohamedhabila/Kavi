const MACHINE_READABLE_PREFIX_PATTERN = /^[\[{]/;

function normalizeText(value: string | undefined): string {
  return typeof value === 'string'
    ? value.replace(/\s+/g, ' ').trim()
    : '';
}

function isMachineReadableText(value: string): boolean {
  return MACHINE_READABLE_PREFIX_PATTERN.test(value);
}

export function responseIsUserVisibleText(
  responseText: string | undefined,
): boolean {
  const normalized = normalizeText(responseText);
  return normalized.length > 0 && !isMachineReadableText(normalized);
}

export function responseDeliversVerifiedResult(params: {
  responseText: string | undefined;
  evidenceTexts: ReadonlyArray<string | undefined>;
}): boolean {
  const normalizedResponse = normalizeText(params.responseText);
  if (!responseIsUserVisibleText(normalizedResponse)) {
    return false;
  }

  const normalizedEvidenceTexts = params.evidenceTexts
    .map((value) => normalizeText(value))
    .filter(Boolean);
  if (normalizedEvidenceTexts.length === 0) {
    return true;
  }

  return normalizedEvidenceTexts.some((value) => value === normalizedResponse);
}
