const SPOKEN_UNIT_PATTERN = /[\p{L}\p{M}\p{N}\p{S}]+/gu;
const WHITESPACE_PATTERN = /\s+/gu;

/**
 * Normalize acoustic transcript text without assuming a language or writing system.
 * Punctuation and spacing are presentation details; letters, marks, numbers, and symbols remain.
 */
export function normalizeVoiceEchoText(value: string): string {
  const compatible = value.normalize('NFKC').toLowerCase();
  const units = compatible.match(SPOKEN_UNIT_PATTERN);
  return units ? units.join(' ').replace(WHITESPACE_PATTERN, ' ').trim() : '';
}

function compactCodePoints(value: string): string[] {
  return Array.from(value.replace(WHITESPACE_PATTERN, ''));
}

function ngramCounts(codePoints: readonly string[], width: number): Map<string, number> {
  const counts = new Map<string, number>();
  for (let index = 0; index <= codePoints.length - width; index += 1) {
    const gram = codePoints.slice(index, index + width).join('');
    counts.set(gram, (counts.get(gram) ?? 0) + 1);
  }
  return counts;
}

function containedNgramRatio(shorter: readonly string[], longer: readonly string[]): number {
  const width = shorter.length >= 12 ? 3 : 2;
  if (shorter.length < width) return 0;
  const shorterCounts = ngramCounts(shorter, width);
  const longerCounts = ngramCounts(longer, width);
  let matched = 0;
  let total = 0;
  for (const [gram, count] of shorterCounts) {
    matched += Math.min(count, longerCounts.get(gram) ?? 0);
    total += count;
  }
  return total > 0 ? matched / total : 0;
}

function tokenCoverage(shorter: string, longer: string): { count: number; ratio: number } {
  const shorterTokens = shorter.split(' ');
  const available = new Map<string, number>();
  for (const token of longer.split(' ')) {
    available.set(token, (available.get(token) ?? 0) + 1);
  }
  let matched = 0;
  for (const token of shorterTokens) {
    const remaining = available.get(token) ?? 0;
    if (remaining < 1) continue;
    matched += 1;
    available.set(token, remaining - 1);
  }
  return {
    count: shorterTokens.length,
    ratio: shorterTokens.length > 0 ? matched / shorterTokens.length : 0,
  };
}

function tokenBigramCoverage(
  shorter: string,
  longer: string,
): {
  count: number;
  ratio: number;
} {
  const shorterTokens = shorter.split(' ');
  const longerTokens = longer.split(' ');
  if (shorterTokens.length < 2) return { count: 0, ratio: 1 };
  const shorterBigrams = Array.from(
    { length: shorterTokens.length - 1 },
    (_, index) => `${shorterTokens[index]}\u0000${shorterTokens[index + 1]}`,
  );
  const available = new Map<string, number>();
  for (let index = 0; index < longerTokens.length - 1; index += 1) {
    const bigram = `${longerTokens[index]}\u0000${longerTokens[index + 1]}`;
    available.set(bigram, (available.get(bigram) ?? 0) + 1);
  }
  let matched = 0;
  for (const bigram of shorterBigrams) {
    const remaining = available.get(bigram) ?? 0;
    if (remaining < 1) continue;
    matched += 1;
    available.set(bigram, remaining - 1);
  }
  return { count: shorterBigrams.length, ratio: matched / shorterBigrams.length };
}

/** Conservative identity matching for recently spoken TTS and a new ASR transcript. */
export function isLikelyVoiceEcho(transcript: string, spokenResponse: string): boolean {
  const normalizedTranscript = normalizeVoiceEchoText(transcript);
  const normalizedResponse = normalizeVoiceEchoText(spokenResponse);
  if (!normalizedTranscript || !normalizedResponse) return false;
  if (normalizedTranscript === normalizedResponse) return true;

  const transcriptCodePoints = compactCodePoints(normalizedTranscript);
  const responseCodePoints = compactCodePoints(normalizedResponse);
  const [shorterText, longerText, shorterCodePoints, longerCodePoints] =
    transcriptCodePoints.length <= responseCodePoints.length
      ? [normalizedTranscript, normalizedResponse, transcriptCodePoints, responseCodePoints]
      : [normalizedResponse, normalizedTranscript, responseCodePoints, transcriptCodePoints];

  if (shorterCodePoints.length < 8) return false;
  const compactShorter = shorterCodePoints.join('');
  const compactLonger = longerCodePoints.join('');
  if (compactLonger.includes(compactShorter)) return true;

  const lengthRatio = shorterCodePoints.length / Math.max(longerCodePoints.length, 1);
  const characterCoverage = containedNgramRatio(shorterCodePoints, longerCodePoints);
  const tokenOrder = tokenBigramCoverage(shorterText, longerText);
  if (
    characterCoverage >= 0.92 &&
    lengthRatio >= 0.35 &&
    (tokenOrder.count === 0 || tokenOrder.ratio >= 0.6)
  ) {
    return true;
  }

  const tokens = tokenCoverage(shorterText, longerText);
  return (
    tokens.count >= 4 &&
    tokens.ratio >= 0.8 &&
    tokenOrder.ratio >= 0.5 &&
    characterCoverage >= 0.72 &&
    lengthRatio >= 0.6
  );
}
