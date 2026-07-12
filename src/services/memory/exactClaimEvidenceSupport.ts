import { hasOnlyAdmissibleRawGap } from './exactFactValueSource';
import { hasQuestionTerminal } from './exactSelfClaimGrammar';
import { PREDICATE_STOP_UNITS, RELATION_ALIASES } from './exactSelfClaimLanguage';

export interface ExactClaimTextToken {
  value: string;
  lower: string;
  start: number;
  end: number;
  quoted: boolean;
}

const TOKEN_PATTERN = /[\p{L}\p{M}\p{N}_+-]+(?:['’][\p{L}\p{M}\p{N}_+-]+)*/gu;
const IDENTIFIER_PATTERN = /[\p{L}\p{M}\p{N}_]/u;
const CLAUSE_BOUNDARY_PATTERN = /[.!?;՞؟⁇⁈⁉‽;\n\r]/u;

export function isQuestionTerminated(text: string, range: { end: number }): boolean {
  return (
    hasQuestionTerminal(text[range.end] ?? '') || hasQuestionTerminal(text[range.end - 1] ?? '')
  );
}

export function normalizeEvidenceText(value: string): string {
  return value.normalize('NFKC').replace(/\s+/gu, ' ').trim();
}

function isIdentifierCodePoint(value: string | undefined): boolean {
  return value !== undefined && IDENTIFIER_PATTERN.test(value);
}

export function exactEvidenceOccurrences(text: string, value: string): number[] {
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

export function evidenceQuoteMask(text: string): boolean[] {
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
    if (
      (char === "'" || char === '’') &&
      /[\p{L}\p{M}]/u.test(before ?? '') &&
      /[\p{L}\p{M}]/u.test(after ?? '')
    ) {
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

export function evidenceClauseRange(
  text: string,
  valueStart: number,
  valueEnd: number,
): { start: number; end: number } {
  let start = valueStart;
  while (start > 0 && !CLAUSE_BOUNDARY_PATTERN.test(text[start - 1]!)) start -= 1;
  let end = valueEnd;
  if (end > valueStart && CLAUSE_BOUNDARY_PATTERN.test(text[end - 1]!)) return { start, end };
  while (end < text.length && !CLAUSE_BOUNDARY_PATTERN.test(text[end]!)) end += 1;
  return { start, end };
}

export function evidenceTokensForClause(
  text: string,
  start: number,
  end: number,
  mask: boolean[],
): ExactClaimTextToken[] {
  const clause = text.slice(start, end);
  return Array.from(clause.matchAll(TOKEN_PATTERN), (match): ExactClaimTextToken => {
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

export function evidenceMorphologicalForms(value: string): Set<string> {
  const lower = value.toLocaleLowerCase();
  const forms = new Set([lower]);
  if (lower.length > 3 && lower.endsWith('s')) forms.add(lower.slice(0, -1));
  if (lower.length > 4 && lower.endsWith('es')) forms.add(lower.slice(0, -2));
  if (lower.length > 4 && lower.endsWith('en')) forms.add(lower.slice(0, -2));
  if (lower.length > 4 && lower.endsWith('ed')) {
    const base = lower.slice(0, -2);
    forms.add(base);
    forms.add(lower.slice(0, -1));
    if (base.length > 2 && base.at(-1) === base.at(-2)) forms.add(base.slice(0, -1));
  }
  if (lower.length > 5 && lower.endsWith('ing')) {
    const base = lower.slice(0, -3);
    forms.add(base);
    if (base.length > 2 && base.at(-1) === base.at(-2)) forms.add(base.slice(0, -1));
  }
  return forms;
}

export function evidencePredicateUnits(predicate: string): Set<string> {
  const normalized = predicate.normalize('NFKC');
  const separated = normalized.replace(/([\p{Ll}\p{N}])([\p{Lu}])/gu, '$1 $2');
  const units = new Set<string>();
  for (const source of [normalized, separated]) {
    for (const match of source.toLocaleLowerCase().matchAll(/[\p{L}\p{M}\p{N}]+/gu)) {
      for (const form of evidenceMorphologicalForms(match[0])) {
        if (!PREDICATE_STOP_UNITS.has(form)) units.add(form);
      }
    }
  }
  return units;
}

export function evidenceRelationForms(units: ReadonlySet<string>): Set<string> {
  const forms = new Set(units);
  for (const aliases of RELATION_ALIASES) {
    if (Array.from(aliases).some((alias) => forms.has(alias))) {
      for (const alias of aliases) forms.add(alias);
    }
  }
  return forms;
}

export function isEvidenceRelationToken(
  token: ExactClaimTextToken,
  allowedForms: ReadonlySet<string>,
): boolean {
  if (token.quoted) return false;
  return (
    Array.from(evidenceMorphologicalForms(token.lower)).some((form) => allowedForms.has(form)) ||
    Array.from(evidencePredicateUnits(token.value)).some((form) => allowedForms.has(form))
  );
}

export function evidenceRangeIsUnquoted(
  mask: readonly boolean[],
  start: number,
  end: number,
): boolean {
  return end > start && !mask.slice(start, end).some(Boolean);
}

export function hasAdmissibleEvidenceRawTokenEnvelope(input: {
  text: string;
  tokens: readonly ExactClaimTextToken[];
  start: number;
  end: number;
  allowCommaOrColon?: boolean;
  allowOpeningQuoteAtEnd?: boolean;
}): boolean {
  const enclosed = input.tokens.filter(
    (token) => token.start >= input.start && token.end <= input.end,
  );
  let cursor = input.start;
  for (const token of enclosed) {
    if (
      !hasOnlyAdmissibleRawGap({
        text: input.text,
        start: cursor,
        end: token.start,
        allowCommaOrColon: input.allowCommaOrColon,
      })
    ) {
      return false;
    }
    cursor = token.end;
  }
  return hasOnlyAdmissibleRawGap({
    text: input.text,
    start: cursor,
    end: input.end,
    allowCommaOrColon: input.allowCommaOrColon,
    allowOpeningQuote: input.allowOpeningQuoteAtEnd,
  });
}
