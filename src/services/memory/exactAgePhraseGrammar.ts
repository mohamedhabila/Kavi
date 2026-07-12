export interface ExactAgePhraseToken {
  value: string;
  lower: string;
  start: number;
  end: number;
  quoted: boolean;
}

export interface ExactAgePhraseMatch {
  durableSuffixBoundary: number;
}

type AgeTail = (age: number) => readonly string[] | null;

type AgeFrame =
  | {
      kind: 'explicit';
      subject: string;
      relation: string;
      tail?: AgeTail;
    }
  | {
      kind: 'implicit';
      relation: string;
      tail?: AgeTail;
    };

const ENGLISH_TAIL = (age: number) => [age === 1 ? 'year' : 'years', 'old'] as const;
const DUTCH_TAIL = () => ['jaar', 'oud'] as const;
const FRENCH_TAIL = (age: number) => [age === 1 ? 'an' : 'ans'] as const;
const GERMAN_TAIL = (age: number) => [age === 1 ? 'jahr' : 'jahre', 'alt'] as const;
const SPANISH_TAIL = (age: number) => [age === 1 ? 'año' : 'años'] as const;
const PORTUGUESE_TAIL = (age: number) => [age === 1 ? 'ano' : 'anos'] as const;
const ARABIC_TAIL = (age: number) => {
  // The dual noun itself carries the number two, so a provider scalar cannot
  // be bound to it without inferring rather than quoting the exact value.
  if (age === 2) return null;
  return [age >= 3 && age <= 10 ? 'سنوات' : 'سنة'] as const;
};
const JAPANESE_TAIL = () => ['歳です'] as const;
const SIMPLIFIED_CHINESE_TAIL = () => ['岁'] as const;

interface CompactAgeFrame {
  relation: string;
  tail: (age: number) => readonly string[];
}

// These languages conventionally bind the subject/relation and age unit
// without whitespace. They are split only after the complete code-owned frame
// has matched; the general evidence tokenizer remains deliberately unchanged.
const COMPACT_AGE_FRAMES: readonly CompactAgeFrame[] = [
  { relation: '私は', tail: JAPANESE_TAIL },
  { relation: '我', tail: SIMPLIFIED_CHINESE_TAIL },
  { relation: '我今年', tail: SIMPLIFIED_CHINESE_TAIL },
];

// Unit-bearing frames precede bare frames so their grammar-owned tail is
// consumed before the generic durable-claim suffix policy is evaluated.
const AGE_FRAMES: readonly AgeFrame[] = [
  { kind: 'explicit', subject: 'i', relation: 'am', tail: ENGLISH_TAIL },
  { kind: 'implicit', relation: "i'm", tail: ENGLISH_TAIL },
  { kind: 'implicit', relation: 'i’m', tail: ENGLISH_TAIL },
  { kind: 'explicit', subject: 'ik', relation: 'ben', tail: DUTCH_TAIL },
  { kind: 'implicit', relation: "j'ai", tail: FRENCH_TAIL },
  { kind: 'implicit', relation: 'j’ai', tail: FRENCH_TAIL },
  { kind: 'explicit', subject: 'ich', relation: 'bin', tail: GERMAN_TAIL },
  { kind: 'explicit', subject: 'yo', relation: 'tengo', tail: SPANISH_TAIL },
  { kind: 'implicit', relation: 'tengo', tail: SPANISH_TAIL },
  { kind: 'explicit', subject: 'eu', relation: 'tenho', tail: PORTUGUESE_TAIL },
  { kind: 'implicit', relation: 'tenho', tail: PORTUGUESE_TAIL },
  { kind: 'implicit', relation: 'عمري', tail: ARABIC_TAIL },
  ...COMPACT_AGE_FRAMES.map(
    (frame): AgeFrame => ({ kind: 'implicit', relation: frame.relation, tail: frame.tail }),
  ),
  { kind: 'explicit', subject: 'i', relation: 'am' },
  { kind: 'implicit', relation: "i'm" },
  { kind: 'implicit', relation: 'i’m' },
  { kind: 'explicit', subject: 'ik', relation: 'ben' },
  { kind: 'explicit', subject: 'ich', relation: 'bin' },
];

const AGE_RELATION_SURFACES = new Set(AGE_FRAMES.map((frame) => frame.relation));
const IMPLICIT_SELF_RELATIONS = new Set(
  AGE_FRAMES.flatMap((frame) => (frame.kind === 'implicit' ? [frame.relation] : [])),
);

function exactAge(value: string): number | null {
  const normalized = value.normalize('NFKC').trim();
  if (!/^(?:0|[1-9][0-9]{0,2})$/u.test(normalized)) return null;
  const age = Number(normalized);
  return age <= 120 ? age : null;
}

interface CompactAgePhraseMatch {
  relationStart: number;
  tailEnd: number;
}

function isIdentifierCodePoint(value: string | undefined): boolean {
  return value !== undefined && /[\p{L}\p{M}\p{N}_]/u.test(value);
}

function compactAgeFrameAtValue(input: {
  text: string;
  value: string;
  valueStart: number;
  valueEnd: number;
}): CompactAgePhraseMatch | null {
  const age = exactAge(input.value);
  if (age === null || input.text.slice(input.valueStart, input.valueEnd) !== input.value) {
    return null;
  }
  for (const frame of COMPACT_AGE_FRAMES) {
    const relationStart = input.valueStart - frame.relation.length;
    const tail = frame.tail(age).join('');
    const tailEnd = input.valueEnd + tail.length;
    if (
      relationStart >= 0 &&
      input.text.slice(relationStart, input.valueStart) === frame.relation &&
      input.text.slice(input.valueEnd, tailEnd) === tail &&
      !isIdentifierCodePoint(Array.from(input.text.slice(0, relationStart)).at(-1)) &&
      !isIdentifierCodePoint(Array.from(input.text.slice(tailEnd))[0])
    ) {
      return { relationStart, tailEnd };
    }
  }
  return null;
}

/** Find scalar occurrences embedded in one complete compact self-age frame. */
export function exactCompactAgeValueOccurrences(text: string, value: string): number[] {
  if (exactAge(value) === null) return [];
  const occurrences: number[] = [];
  let offset = 0;
  while (offset <= text.length - value.length) {
    const valueStart = text.indexOf(value, offset);
    if (valueStart < 0) break;
    const valueEnd = valueStart + value.length;
    if (compactAgeFrameAtValue({ text, value, valueStart, valueEnd })) {
      occurrences.push(valueStart);
    }
    offset = valueStart + Math.max(value.length, 1);
  }
  return occurrences;
}

/**
 * Split only the matched compact frame at its code-owned relation/value/unit
 * boundaries. Prefixes and suffixes in the same generic token are preserved so
 * the ordinary context and durable-suffix checks can still reject them.
 */
export function splitExactCompactAgeTokens(input: {
  text: string;
  tokens: readonly ExactAgePhraseToken[];
  value: string;
  valueStart: number;
  valueEnd: number;
}): readonly ExactAgePhraseToken[] {
  const match = compactAgeFrameAtValue(input);
  if (!match) return input.tokens;
  const boundaries = new Set([
    match.relationStart,
    input.valueStart,
    input.valueEnd,
    match.tailEnd,
  ]);
  return input.tokens.flatMap((token) => {
    const offsets = [token.start, ...boundaries, token.end]
      .filter((offset) => offset >= token.start && offset <= token.end)
      .sort((left, right) => left - right)
      .filter((offset, index, all) => index === 0 || offset !== all[index - 1]);
    return offsets.slice(0, -1).flatMap((start, index) => {
      const end = offsets[index + 1]!;
      if (end <= start) return [];
      const value = input.text.slice(start, end);
      return [{ value, lower: value.toLocaleLowerCase(), start, end, quoted: token.quoted }];
    });
  });
}

function frameMatches(input: {
  frame: AgeFrame;
  tokens: readonly ExactAgePhraseToken[];
  subjectIndex: number;
  relationIndex: number;
}): boolean {
  const subject = input.tokens[input.subjectIndex];
  const relation = input.tokens[input.relationIndex];
  if (!subject || !relation || subject.quoted || relation.quoted) return false;
  if (input.frame.kind === 'implicit') {
    return input.subjectIndex === input.relationIndex && relation.lower === input.frame.relation;
  }
  return (
    input.relationIndex === input.subjectIndex + 1 &&
    subject.lower === input.frame.subject &&
    relation.lower === input.frame.relation
  );
}

function hasOnlyWhitespace(text: string, start: number, end: number): boolean {
  return end >= start && /^\s*$/u.test(text.slice(start, end));
}

function matchTail(input: {
  text: string;
  tokens: readonly ExactAgePhraseToken[];
  firstValueIndex: number;
  valueEnd: number;
  expected: readonly string[];
}): number | null {
  let boundary = input.valueEnd;
  for (let offset = 0; offset < input.expected.length; offset += 1) {
    const token = input.tokens[input.firstValueIndex + 1 + offset];
    if (
      !token ||
      token.quoted ||
      token.lower !== input.expected[offset] ||
      !hasOnlyWhitespace(input.text, boundary, token.start)
    ) {
      return null;
    }
    boundary = token.end;
  }
  return boundary;
}

export function isExactAgeRelationSurface(value: string): boolean {
  return AGE_RELATION_SURFACES.has(value.normalize('NFKC').toLocaleLowerCase());
}

export function isExactAgeImplicitSelfRelation(value: string): boolean {
  return IMPLICIT_SELF_RELATIONS.has(value.normalize('NFKC').toLocaleLowerCase());
}

/**
 * Bind one code-owned first-person age frame to an exact scalar value. The
 * optional unit tail is language- and number-specific and never becomes part
 * of the provider value.
 */
export function matchExactAgePhrase(input: {
  text: string;
  tokens: readonly ExactAgePhraseToken[];
  subjectIndex: number;
  relationIndex: number;
  firstValueIndex: number;
  value: string;
  valueStart: number;
  valueEnd: number;
}): ExactAgePhraseMatch | null {
  const age = exactAge(input.value);
  const valueToken = input.tokens[input.firstValueIndex];
  if (
    age === null ||
    !valueToken ||
    valueToken.quoted ||
    input.firstValueIndex !== input.relationIndex + 1 ||
    valueToken.start !== input.valueStart ||
    valueToken.end !== input.valueEnd ||
    valueToken.value.normalize('NFKC') !== input.value.normalize('NFKC').trim()
  ) {
    return null;
  }

  for (const frame of AGE_FRAMES) {
    if (!frameMatches({ ...input, frame })) continue;
    if (!frame.tail) return { durableSuffixBoundary: input.valueEnd };
    const expected = frame.tail(age);
    if (!expected) continue;
    const durableSuffixBoundary = matchTail({
      text: input.text,
      tokens: input.tokens,
      firstValueIndex: input.firstValueIndex,
      valueEnd: input.valueEnd,
      expected,
    });
    if (durableSuffixBoundary !== null) return { durableSuffixBoundary };
  }
  return null;
}
