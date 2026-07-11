export interface ExactSelfClaimEvidence {
  subject: 'user';
  predicate: string;
  value: string;
  evidenceQuote: string;
}

export interface ExactNamedSubjectClaimEvidence {
  subject: string;
  predicate: string;
  value: string;
  evidenceQuote: string;
}

interface TextToken {
  value: string;
  lower: string;
  start: number;
  end: number;
  quoted: boolean;
}

const TOKEN_PATTERN = /[\p{L}\p{M}\p{N}_+-]+(?:['’][\p{L}\p{M}\p{N}_+-]+)*/gu;
const IDENTIFIER_PATTERN = /[\p{L}\p{M}\p{N}_]/u;
const CLAUSE_BOUNDARY_PATTERN = /[.!?;\n\r]/u;

const SUBJECT_SELF_MARKERS = new Set([
  'i',
  "i'm",
  'im',
  "i've",
  'ive',
  'ik',
  'je',
  "j'ai",
  'ich',
  'yo',
  'eu',
  'أنا',
  'انا',
  '私',
  'わたし',
  '僕',
  '俺',
  '我',
]);

const POSSESSIVE_SELF_MARKERS = new Set([
  'my',
  'mine',
  'mijn',
  'mon',
  'ma',
  'mes',
  'mein',
  'meine',
  'mi',
  'mis',
  'meu',
  'minha',
  'لي',
  'عندي',
  'اسمي',
  '我的',
]);

const OBJECT_SELF_MARKERS = new Set(['me', 'mij', 'moi', 'mich', 'mir']);

const ALLOWED_SELF_RELATION_GAP = new Set([
  'am',
  'also',
  'always',
  'actually',
  'currently',
  'definitely',
  'do',
  'generally',
  'have',
  'just',
  'now',
  'personally',
  'really',
  'still',
  'typically',
  'usually',
  'want',
  'would',
  'will',
]);

const ALLOWED_POSSESSIVE_RELATION_GAP = new Set([
  'actual',
  'current',
  'default',
  'favorite',
  'favourite',
  'new',
  'preferred',
  'primary',
  'usual',
]);

const ATTRIBUTION_MARKERS = new Set([
  'according',
  'claimed',
  'claims',
  'noted',
  'notes',
  'quoted',
  'quotes',
  'said',
  'says',
  'stated',
  'states',
  'told',
  'wrote',
  'writes',
]);

const NEGATION_MARKERS = new Set([
  'cannot',
  "can't",
  'cant',
  'didnt',
  "didn't",
  'doesnt',
  "doesn't",
  'dont',
  "don't",
  'geen',
  'never',
  'niet',
  'no',
  'not',
  'nunca',
  'pas',
  'kein',
  'keine',
  'nicht',
  'لا',
  'لم',
  'لن',
  'ليس',
  '不',
  '没',
]);

const RESET_MARKERS = new Set(['but', 'however', 'instead', 'maar', 'aber', 'pero', 'mas']);

const HYPOTHETICAL_MARKERS = new Set([
  'assuming',
  'could',
  'if',
  'maybe',
  'may',
  'might',
  'perhaps',
  'possibly',
  'should',
  'suppose',
  'supposing',
  'would',
]);

const ALLOWED_NAMED_SUBJECT_RELATION_GAP = new Set([
  'a',
  'actually',
  'also',
  'always',
  'an',
  'are',
  'currently',
  'definitely',
  'generally',
  'has',
  'have',
  'is',
  'now',
  'really',
  'so',
  'still',
  'the',
  'typically',
  'usually',
]);

const PREDICATE_STOP_UNITS = new Set([
  'a',
  'an',
  'at',
  'be',
  'has',
  'have',
  'in',
  'is',
  'of',
  'on',
  'the',
  'to',
]);

const RELATION_ALIASES: ReadonlyArray<ReadonlySet<string>> = [
  new Set(['address', 'city', 'home', 'live', 'location', 'move', 'residence', 'reside']),
  new Set(['call', 'called', 'name', 'named']),
  new Set(['channel', 'contact', 'favorite', 'favourite', 'prefer', 'preference']),
  new Set(['job', 'occupation', 'profession', 'role', 'work']),
  new Set(['timezone', 'tz']),
];

function normalizeText(value: string): string {
  return value.normalize('NFKC').replace(/\s+/gu, ' ').trim();
}

function isIdentifierCodePoint(value: string | undefined): boolean {
  return value !== undefined && IDENTIFIER_PATTERN.test(value);
}

function exactOccurrences(text: string, value: string): number[] {
  const indexes: number[] = [];
  let offset = 0;
  while (offset <= text.length - value.length) {
    const index = text.indexOf(value, offset);
    if (index < 0) break;
    const before = Array.from(text.slice(0, index)).at(-1);
    const after = Array.from(text.slice(index + value.length))[0];
    if (!isIdentifierCodePoint(before) && !isIdentifierCodePoint(after)) indexes.push(index);
    offset = index + Math.max(value.length, 1);
  }
  return indexes;
}

function quoteMask(text: string): boolean[] {
  const mask = Array.from({ length: text.length }, () => false);
  const closeForOpen: Record<string, string> = {
    '"': '"',
    "'": "'",
    '“': '”',
    '‘': '’',
    '«': '»',
    '‹': '›',
    '「': '」',
    '『': '』',
  };
  let closing: string | null = null;
  let quoteStart = -1;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]!;
    if (closing) {
      mask[index] = true;
      if (char === closing) {
        for (let fill = quoteStart; fill <= index; fill += 1) mask[fill] = true;
        closing = null;
        quoteStart = -1;
      }
      continue;
    }
    const requestedClose = closeForOpen[char];
    if (!requestedClose) continue;
    const before = text[index - 1];
    const after = text[index + 1];
    if ((char === "'" || char === '’') && /[\p{L}\p{M}]/u.test(before ?? '') && /[\p{L}\p{M}]/u.test(after ?? '')) {
      continue;
    }
    closing = requestedClose;
    quoteStart = index;
    mask[index] = true;
  }
  if (closing && quoteStart >= 0) {
    for (let fill = quoteStart; fill < text.length; fill += 1) mask[fill] = true;
  }
  return mask;
}

function clauseRange(text: string, valueStart: number, valueEnd: number): { start: number; end: number } {
  let start = valueStart;
  while (start > 0 && !CLAUSE_BOUNDARY_PATTERN.test(text[start - 1]!)) start -= 1;
  let end = valueEnd;
  if (end > valueStart && CLAUSE_BOUNDARY_PATTERN.test(text[end - 1]!)) {
    return { start, end };
  }
  while (end < text.length && !CLAUSE_BOUNDARY_PATTERN.test(text[end]!)) end += 1;
  return { start, end };
}

function tokensForClause(text: string, start: number, end: number, mask: boolean[]): TextToken[] {
  const clause = text.slice(start, end);
  return Array.from(clause.matchAll(TOKEN_PATTERN), (match): TextToken => {
    const tokenStart = start + (match.index ?? 0);
    const tokenEnd = tokenStart + match[0].length;
    return {
      value: match[0],
      lower: match[0].toLocaleLowerCase(),
      start: tokenStart,
      end: tokenEnd,
      quoted: mask.slice(tokenStart, tokenEnd).some(Boolean),
    };
  });
}

function morphologicalForms(value: string): Set<string> {
  const lower = value.toLocaleLowerCase();
  const forms = new Set([lower]);
  if (lower.length > 3 && lower.endsWith('s')) forms.add(lower.slice(0, -1));
  if (lower.length > 4 && lower.endsWith('es')) forms.add(lower.slice(0, -2));
  if (lower.length > 4 && lower.endsWith('ed')) {
    const base = lower.slice(0, -2);
    forms.add(base);
    if (base.length > 2 && base.at(-1) === base.at(-2)) forms.add(base.slice(0, -1));
  }
  if (lower.length > 5 && lower.endsWith('ing')) {
    const base = lower.slice(0, -3);
    forms.add(base);
    if (base.length > 2 && base.at(-1) === base.at(-2)) forms.add(base.slice(0, -1));
  }
  return forms;
}

function predicateUnits(predicate: string): Set<string> {
  const separated = predicate
    .normalize('NFKC')
    .replace(/([\p{Ll}\p{N}])([\p{Lu}])/gu, '$1 $2')
    .toLocaleLowerCase();
  const units = new Set<string>();
  for (const match of separated.matchAll(/[\p{L}\p{M}\p{N}]+/gu)) {
    for (const form of morphologicalForms(match[0])) {
      if (!PREDICATE_STOP_UNITS.has(form)) units.add(form);
    }
  }
  return units;
}

function relationForms(units: ReadonlySet<string>): Set<string> {
  const forms = new Set(units);
  for (const aliases of RELATION_ALIASES) {
    if (Array.from(aliases).some((alias) => forms.has(alias))) {
      for (const alias of aliases) forms.add(alias);
    }
  }
  return forms;
}

function isRelationToken(token: TextToken, allowedForms: ReadonlySet<string>): boolean {
  if (token.quoted) return false;
  return (
    Array.from(morphologicalForms(token.lower)).some((form) => allowedForms.has(form)) ||
    Array.from(predicateUnits(token.value)).some((form) => allowedForms.has(form))
  );
}

function resetStart(tokens: readonly TextToken[], beforeIndex: number): number {
  let start = 0;
  for (let index = 0; index < beforeIndex; index += 1) {
    if (!tokens[index]!.quoted && RESET_MARKERS.has(tokens[index]!.lower)) start = index + 1;
  }
  return start;
}

function hasUnsafeModifier(
  tokens: readonly TextToken[],
  startIndex: number,
  endIndex: number,
  valueStart: number,
): boolean {
  const activeStart = resetStart(tokens, startIndex);
  for (let index = activeStart; index < tokens.length; index += 1) {
    const token = tokens[index]!;
    if (token.quoted) continue;
    if (index < startIndex && ATTRIBUTION_MARKERS.has(token.lower)) return true;
    if (token.start <= valueStart && NEGATION_MARKERS.has(token.lower)) return true;
    if (index > endIndex && token.start > valueStart) break;
  }
  return false;
}

function gapAllowed(
  tokens: readonly TextToken[],
  fromIndex: number,
  toIndex: number,
  allowed: ReadonlySet<string>,
): boolean {
  if (toIndex <= fromIndex) return false;
  const gap = tokens.slice(fromIndex + 1, toIndex).filter((token) => !token.quoted);
  return gap.length <= 4 && gap.every((token) => allowed.has(token.lower));
}

function hasBoundSelfRelation(
  tokens: readonly TextToken[],
  relationIndex: number,
  valueStart: number,
  predicateForms: ReadonlySet<string>,
): boolean {
  const relation = tokens[relationIndex]!;
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]!;
    if (token.quoted) continue;
    const lower = token.lower;
    if (SUBJECT_SELF_MARKERS.has(lower) || lower === 'user') {
      if (
        index < relationIndex &&
        gapAllowed(tokens, index, relationIndex, ALLOWED_SELF_RELATION_GAP) &&
        !hasUnsafeModifier(tokens, index, relationIndex, valueStart)
      ) {
        return true;
      }
    }
    if (POSSESSIVE_SELF_MARKERS.has(lower)) {
      const gap = tokens.slice(index + 1, relationIndex).filter((entry) => !entry.quoted);
      if (
        index < relationIndex &&
        gap.length <= 2 &&
        gap.every(
          (entry) =>
            ALLOWED_POSSESSIVE_RELATION_GAP.has(entry.lower) ||
            Array.from(morphologicalForms(entry.lower)).some((form) => predicateForms.has(form)),
        ) &&
        !hasUnsafeModifier(tokens, index, relationIndex, valueStart)
      ) {
        return true;
      }
    }
    if (OBJECT_SELF_MARKERS.has(lower) && index > relationIndex) {
      const relationFormsForToken = morphologicalForms(relation.lower);
      if (
        Array.from(relationFormsForToken).some((form) =>
          ['call', 'name', 'address'].includes(form),
        ) &&
        !hasUnsafeModifier(tokens, relationIndex, index, valueStart)
      ) {
        return true;
      }
    }
  }
  return false;
}

function rangeIsUnquoted(mask: readonly boolean[], start: number, end: number): boolean {
  return end > start && !mask.slice(start, end).some(Boolean);
}

function namedClaimHasUnsafeModifier(tokens: readonly TextToken[]): boolean {
  for (const token of tokens) {
    if (token.quoted) continue;
    if (
      ATTRIBUTION_MARKERS.has(token.lower) ||
      NEGATION_MARKERS.has(token.lower) ||
      HYPOTHETICAL_MARKERS.has(token.lower)
    ) {
      return true;
    }
  }
  return false;
}

function hasBoundNamedSubjectRelation(input: {
  tokens: readonly TextToken[];
  subjectEnd: number;
  relationIndex: number;
  valueStart: number;
  questionTerminated: boolean;
}): boolean {
  if (input.questionTerminated) return false;
  const relation = input.tokens[input.relationIndex]!;
  if (relation.start < input.subjectEnd || relation.end > input.valueStart) return false;
  const gap = input.tokens.filter(
    (token) => token.start >= input.subjectEnd && token.end <= relation.start && !token.quoted,
  );
  return (
    gap.length <= 3 &&
    gap.every((token) => ALLOWED_NAMED_SUBJECT_RELATION_GAP.has(token.lower)) &&
    !namedClaimHasUnsafeModifier(input.tokens)
  );
}

/**
 * Admit only a direct current-user claim whose exact clause structurally binds
 * canonical subject `user`, the proposed relation, and the exact value. This
 * intentionally prefers a missed write over promoting quoted, negated, or
 * third-party prose into authoritative profile memory.
 */
export function deriveExactSelfClaimEvidence(input: {
  userMessageText: string;
  predicate: string;
  value: string;
}): ExactSelfClaimEvidence | null {
  const text = normalizeText(input.userMessageText);
  const predicate = normalizeText(input.predicate);
  const value = normalizeText(input.value);
  if (!text || !predicate || !value) return null;
  const predicateForms = predicateUnits(predicate);
  if (predicateForms.size === 0) return null;
  const allowedRelationForms = relationForms(predicateForms);
  const mask = quoteMask(text);

  for (const valueStart of exactOccurrences(text, value)) {
    const range = clauseRange(text, valueStart, valueStart + value.length);
    const tokens = tokensForClause(text, range.start, range.end, mask);
    for (let relationIndex = 0; relationIndex < tokens.length; relationIndex += 1) {
      if (!isRelationToken(tokens[relationIndex]!, allowedRelationForms)) continue;
      if (!hasBoundSelfRelation(tokens, relationIndex, valueStart, predicateForms)) continue;
      return {
        subject: 'user',
        predicate,
        value,
        evidenceQuote: text.slice(range.start, range.end).trim(),
      };
    }
  }
  return null;
}

/**
 * Admit a named-subject claim only when one unquoted clause binds the exact
 * subject, a predicate relation, and the exact value in assertion order.
 * Ambiguous attribution, modality, quotation, and negation fail closed.
 */
export function deriveExactNamedSubjectClaimEvidence(input: {
  userMessageText: string;
  subject: string;
  predicate: string;
  value: string;
}): ExactNamedSubjectClaimEvidence | null {
  const text = normalizeText(input.userMessageText);
  const subject = normalizeText(input.subject);
  const predicate = normalizeText(input.predicate);
  const value = normalizeText(input.value);
  if (!text || !subject || !predicate || !value) return null;
  const predicateForms = predicateUnits(predicate);
  if (predicateForms.size === 0) return null;
  const allowedRelationForms = relationForms(predicateForms);
  const mask = quoteMask(text);

  for (const valueStart of exactOccurrences(text, value)) {
    if (!rangeIsUnquoted(mask, valueStart, valueStart + value.length)) continue;
    const range = clauseRange(text, valueStart, valueStart + value.length);
    const tokens = tokensForClause(text, range.start, range.end, mask);
    for (const subjectStart of exactOccurrences(text, subject)) {
      const subjectEnd = subjectStart + subject.length;
      if (
        subjectStart < range.start ||
        subjectEnd > valueStart ||
        !rangeIsUnquoted(mask, subjectStart, subjectEnd)
      ) {
        continue;
      }
      for (let relationIndex = 0; relationIndex < tokens.length; relationIndex += 1) {
        if (!isRelationToken(tokens[relationIndex]!, allowedRelationForms)) continue;
        if (
          !hasBoundNamedSubjectRelation({
            tokens,
            subjectEnd,
            relationIndex,
            valueStart,
            questionTerminated: text[range.end] === '?' || text[range.end - 1] === '?',
          })
        ) {
          continue;
        }
        return {
          subject,
          predicate,
          value,
          evidenceQuote: text.slice(subjectStart, valueStart + value.length).trim(),
        };
      }
    }
  }
  return null;
}
