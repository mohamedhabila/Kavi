function findAssistantContinuationOverlap(existingText: string, incomingText: string): number {
  const maxOverlap = Math.min(existingText.length, incomingText.length);
  for (let overlapLength = maxOverlap; overlapLength > 0; overlapLength -= 1) {
    if (existingText.slice(-overlapLength) === incomingText.slice(0, overlapLength)) {
      return overlapLength;
    }
  }

  return 0;
}

function extractAssistantContinuationLead(text: string): string {
  const normalized = text.trim();
  if (!normalized) {
    return '';
  }

  const paragraphBreakIndex = normalized.indexOf('\n\n');
  const listBreakIndex = normalized.search(/\n(?:[-*]|\d+\.)\s/);
  const boundaryCandidates = [paragraphBreakIndex, listBreakIndex].filter((value) => value >= 0);
  const endIndex =
    boundaryCandidates.length > 0
      ? Math.min(...boundaryCandidates, 160)
      : Math.min(normalized.length, 160);

  return normalized.slice(0, endIndex).replace(/\s+/g, ' ').trim();
}

function shouldReplaceRestartedAssistantContinuation(
  existingText: string,
  incomingText: string,
): boolean {
  const existingLead = extractAssistantContinuationLead(existingText);
  const incomingLead = extractAssistantContinuationLead(incomingText);
  if (!existingLead || !incomingLead) {
    return false;
  }

  const leadMatches =
    existingLead === incomingLead ||
    existingLead.startsWith(incomingLead) ||
    incomingLead.startsWith(existingLead);
  if (!leadMatches || Math.min(existingLead.length, incomingLead.length) < 32) {
    return false;
  }

  const existingStructured = existingText.includes('\n') || existingText.length >= 80;
  const incomingStructured =
    incomingText.includes('\n') || incomingText.length >= Math.min(160, existingText.length);
  return existingStructured && incomingStructured;
}

function normalizeAssistantContinuationLine(line: string): string {
  return line
    .replace(/^\s*[-*•]\s+/, '')
    .replace(/^\s*\d+\.\s+/, '')
    .replace(/^\s*#+\s*/, '')
    .replace(/\*\*/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractStructuredAssistantContinuationLines(text: string): string[] {
  return [
    ...new Set(
      text
        .split('\n')
        .map((line) => normalizeAssistantContinuationLine(line))
        .filter((line) => line.length >= 24),
    ),
  ];
}

function countStructuredAssistantContinuationLineMatches(
  sourceLines: ReadonlyArray<string>,
  candidateLines: ReadonlyArray<string>,
): number {
  return sourceLines.filter((sourceLine) =>
    candidateLines.some(
      (candidateLine) =>
        candidateLine === sourceLine ||
        candidateLine.includes(sourceLine) ||
        sourceLine.includes(candidateLine),
    ),
  ).length;
}

function shouldReplaceOverlappingStructuredAssistantContinuation(
  existingText: string,
  incomingText: string,
): boolean {
  const existingLines = extractStructuredAssistantContinuationLines(existingText);
  const incomingLines = extractStructuredAssistantContinuationLines(incomingText);
  if (existingLines.length < 2 || incomingLines.length < 2) {
    return false;
  }

  const overlapCount = countStructuredAssistantContinuationLineMatches(
    existingLines,
    incomingLines,
  );
  if (overlapCount < 2) {
    return false;
  }

  const existingCoverage = overlapCount / existingLines.length;
  const incomingCoverage = overlapCount / incomingLines.length;
  const incomingSupersedesExisting =
    incomingText.trim().length >= Math.floor(existingText.trim().length * 0.75) ||
    incomingLines.length >= existingLines.length;
  return existingCoverage >= 0.5 && incomingCoverage >= 0.25 && incomingSupersedesExisting;
}

export function mergeAssistantContinuationText(
  existingText: string,
  incomingText: string,
  options?: { preserveExistingPrefix?: boolean },
): string {
  if (!existingText) {
    return incomingText;
  }

  if (!incomingText) {
    return existingText;
  }

  if (incomingText.startsWith(existingText)) {
    return incomingText;
  }

  if (existingText.startsWith(incomingText)) {
    return existingText;
  }

  if (shouldReplaceRestartedAssistantContinuation(existingText, incomingText)) {
    return incomingText;
  }

  if (shouldReplaceOverlappingStructuredAssistantContinuation(existingText, incomingText)) {
    return incomingText;
  }

  const normalizedExisting = existingText.trim();
  const normalizedIncoming = incomingText.trim();
  if (!options?.preserveExistingPrefix && normalizedExisting && normalizedIncoming) {
    const anchorLength = Math.min(96, Math.max(24, Math.floor(normalizedExisting.length / 3)));
    const existingAnchor = normalizedExisting.slice(0, anchorLength);
    if (normalizedIncoming.startsWith(existingAnchor)) {
      return incomingText;
    }
  }

  const overlapLength = findAssistantContinuationOverlap(existingText, incomingText);
  if (overlapLength > 0) {
    return `${existingText}${incomingText.slice(overlapLength)}`;
  }

  if (
    existingText.endsWith('\n') ||
    incomingText.startsWith('\n') ||
    /[ \t]$/.test(existingText) ||
    /^[ \t,.;:!?)]/.test(incomingText)
  ) {
    return `${existingText}${incomingText}`;
  }

  return incomingText.includes('\n')
    ? `${existingText}\n\n${incomingText}`
    : `${existingText} ${incomingText}`;
}
