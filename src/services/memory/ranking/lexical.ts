type WordSegment = {
  segment: string;
  isWordLike?: boolean;
};

type WordSegmenter = {
  segment(input: string): Iterable<WordSegment>;
};

type WordSegmenterConstructor = new (
  locales?: string | string[],
  options?: { granularity?: 'word' },
) => WordSegmenter;

const WORD_LIKE_SEQUENCE_PATTERN = /[\p{L}\p{M}\p{N}]+/gu;
const WORD_LIKE_CODE_POINT_PATTERN = /[\p{L}\p{N}]/u;
const CONTINUOUS_WORD_SCRIPT_PATTERN =
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}\p{Script=Lao}\p{Script=Khmer}\p{Script=Myanmar}]/u;

let cachedWordSegmenter: WordSegmenter | null | undefined;

function getWordSegmenter(): WordSegmenter | null {
  if (cachedWordSegmenter !== undefined) return cachedWordSegmenter;
  const segmenterCtor = (
    Intl as typeof Intl & {
      Segmenter?: WordSegmenterConstructor;
    }
  ).Segmenter;
  cachedWordSegmenter =
    typeof segmenterCtor === 'function'
      ? new segmenterCtor(undefined, { granularity: 'word' })
      : null;
  return cachedWordSegmenter;
}

function normalizeLexicalText(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase();
}

function hasWordLikeCodePoint(value: string): boolean {
  return WORD_LIKE_CODE_POINT_PATTERN.test(value);
}

function addSegmentUnits(units: Set<string>, rawSegment: string): void {
  const segment = normalizeLexicalText(rawSegment).trim();
  if (!segment || !hasWordLikeCodePoint(segment)) return;
  units.add(segment);

  if (!CONTINUOUS_WORD_SCRIPT_PATTERN.test(segment)) return;
  const codePoints = Array.from(segment);
  for (const width of [2, 3]) {
    if (codePoints.length < width) continue;
    for (let index = 0; index <= codePoints.length - width; index += 1) {
      units.add(`${width}:${codePoints.slice(index, index + width).join('')}`);
    }
  }
}

function addUnicodeSequenceUnits(units: Set<string>, value: string): void {
  WORD_LIKE_SEQUENCE_PATTERN.lastIndex = 0;
  for (const match of value.matchAll(WORD_LIKE_SEQUENCE_PATTERN)) {
    addSegmentUnits(units, match[0]);
  }
}

function incrementUnit(counts: Map<string, number>, unit: string): void {
  counts.set(unit, (counts.get(unit) ?? 0) + 1);
}

function countSegmentUnits(counts: Map<string, number>, rawSegment: string): void {
  const segment = normalizeLexicalText(rawSegment).trim();
  if (!segment || !hasWordLikeCodePoint(segment)) return;
  incrementUnit(counts, segment);

  if (!CONTINUOUS_WORD_SCRIPT_PATTERN.test(segment)) return;
  const codePoints = Array.from(segment);
  for (const width of [2, 3]) {
    if (codePoints.length < width) continue;
    for (let index = 0; index <= codePoints.length - width; index += 1) {
      incrementUnit(counts, `${width}:${codePoints.slice(index, index + width).join('')}`);
    }
  }
}

function countUnicodeSequenceUnits(counts: Map<string, number>, value: string): void {
  WORD_LIKE_SEQUENCE_PATTERN.lastIndex = 0;
  for (const match of value.matchAll(WORD_LIKE_SEQUENCE_PATTERN)) {
    countSegmentUnits(counts, match[0]);
  }
}

export function countLexicalUnits(value: string): Map<string, number> {
  const normalized = normalizeLexicalText(value);
  const counts = new Map<string, number>();
  const segmenter = getWordSegmenter();
  if (segmenter) {
    for (const segment of segmenter.segment(normalized)) {
      if (segment.isWordLike === false) continue;
      countSegmentUnits(counts, segment.segment);
    }
  }
  countUnicodeSequenceUnits(counts, normalized);
  return counts;
}

export function tokenizeLexicalUnits(value: string): Set<string> {
  const normalized = normalizeLexicalText(value);
  const units = new Set<string>();
  const segmenter = getWordSegmenter();
  if (segmenter) {
    for (const segment of segmenter.segment(normalized)) {
      if (segment.isWordLike === false) continue;
      addSegmentUnits(units, segment.segment);
    }
  }
  addUnicodeSequenceUnits(units, normalized);
  return units;
}

export function lexicalOverlap(
  queryUnits: Set<string>,
  factText: string,
  unitWeights?: ReadonlyMap<string, number>,
): number {
  if (queryUnits.size === 0) return 0;
  const factUnits = tokenizeLexicalUnits(factText);
  if (factUnits.size === 0) return 0;
  let hits = 0;
  let total = 0;
  for (const unit of queryUnits) {
    const weight = unitWeights?.get(unit) ?? 1;
    total += weight;
    if (factUnits.has(unit)) hits += weight;
  }
  return total > 0 ? hits / total : 0;
}

export function lexicalUnitJaccard(left: Set<string>, right: Set<string>): number {
  if (left.size === 0 || right.size === 0) return 0;
  let intersection = 0;
  for (const unit of left) {
    if (right.has(unit)) intersection += 1;
  }
  return intersection / (left.size + right.size - intersection);
}

export function buildQueryUnitWeights<T>(
  queryUnits: Set<string>,
  candidates: ReadonlyArray<T>,
  textForCandidate: (candidate: T) => string,
): Map<string, number> {
  const weights = new Map<string, number>();
  if (queryUnits.size === 0 || candidates.length === 0) return weights;
  const documentFrequency = new Map<string, number>();
  for (const candidate of candidates) {
    const factUnits = tokenizeLexicalUnits(textForCandidate(candidate));
    for (const unit of queryUnits) {
      if (factUnits.has(unit)) {
        documentFrequency.set(unit, (documentFrequency.get(unit) ?? 0) + 1);
      }
    }
  }
  const documentCount = candidates.length;
  for (const unit of queryUnits) {
    const df = documentFrequency.get(unit) ?? 0;
    weights.set(unit, Math.log((documentCount + 1) / (df + 1)) + 1);
  }
  return weights;
}
