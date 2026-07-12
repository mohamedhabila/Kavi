const NON_EXACT_OPERATOR_PATTERN = /[~≈≃≅∼<>≤≥≠±≲≳]/u;
const TRAILING_OPEN_RANGE_PATTERN = /\p{N}\s*\+(?:\s|$)/u;
const NUMERIC_RANGE_PATTERN =
  /(?:^|\s)\p{N}{1,3}(?:[.,]\p{N}+)?\s*(?:\p{Pd}|−|…|\.{2,}|\/|\bto\b|\bthrough\b)\s*\p{N}{1,3}(?:[.,]\p{N}+)?(?:\s|$)/u;
const NUMERIC_COMPARISON_PATTERN =
  /(?:^|\s)(?:(?:a\s+little|just)\s+(?:over|under)|(?:at\s+)?(?:least|most)|less\s+than|more\s+than|maximum|minimum|over|under|up\s+to)\s*\p{N}/u;
const ATTACHED_NUMERIC_QUALIFIER_PATTERN =
  /(?:\b(?:approx(?:imately)?|around|circa|roughly)\s*\p{N}|\p{N}\s*(?:-?ish)\b)/u;
const FROM_TO_NUMERIC_RANGE_PATTERN =
  /(?:^|\s)(?:between|from)\s+\p{N}+(?:[.,]\p{N}+)?\s+(?:and|to)\s+\p{N}+(?:[.,]\p{N}+)?(?:\s|$)/u;
const NUMERIC_PATTERN = /[+-]?\p{N}+(?:[.,]\p{N}+)?/gu;
const NON_EXACT_LEXICAL_PATTERN =
  /(?:^|[^\p{L}\p{M}])(?:above|alrededor\s+de|approx(?:imately)?|aproximadamente|around|below|between|circa|cerca\s+de|close\s+to|environ|entre|etwa|fewer\s+than|from|greater\s+than|intorno\s+a|just\s+under|less\s+than|max(?:imum)?|menos\s+de|min(?:imum)?|moins\s+de|more\s+than|near|ongeveer|over|por\s+volta\s+(?:d[aeo]s?|de)|près\s+(?:d['’]|de|des|du)|rough|roughly|rund|thru|through|to|tussen|under|ungefähr|unter|up\s+to)(?:$|[^\p{L}\p{M}])/u;
const NUMBER_WORD_RANGE_PATTERN =
  /\b(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)(?:[-\s]\p{L}+)*\s+(?:thru|through|to)\s+(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)\b/u;
const EXACT_MONTH_OR_DAY_PATTERN =
  /^(?:january|february|march|april|may|june|july|august|september|october|november|december|januari|februari|maart|mei|juni|juli|augustus|oktober|november|december|janvier|février|mars|avril|mai|juin|juillet|août|septembre|octobre|novembre|décembre|januar|februar|märz|april|mai|juni|juli|august|september|oktober|november|dezember)$/u;
const EXACT_SCALAR_UNIT_PATTERN =
  /^(?:%|percent|percentage|milliseconds?|milliseconden|millisecondes|millisekunden|seconds?|seconden|secondes|sekunden|minutes?|minuten|hours?|uren|heures|stunden|days?|dagen|jours?|tage|weeks?|weken|semaines?|wochen|months?|maanden|mois|monate|years?|jaren|ans|années|jahre|ms|sec|secs|min|mins|hrs?|pixels?|px|words?|woorden|mots|wörter|characters?|chars?|bytes?|kb|mb|gb|tb|grams?|kilograms?|kg|meters?|metres?|centimeters?|centimetres?|cm|kilometers?|kilometres?|km|miles?|feet|foot|inches?|dollars?|euros?|pounds?|usd|eur|gbp|attendees?|people|items?|degrees?|°c|°f)$/u;

export type StructuredNumericValueKind =
  | 'address'
  | 'contact'
  | 'identifier'
  | 'phone'
  | 'standard'
  | 'version';

function digits(value: string): number {
  return Array.from(value.matchAll(/\p{N}/gu)).length;
}

function hasAdmissibleStructuredNumericValueShape(
  value: string,
  kind: StructuredNumericValueKind,
): boolean {
  const normalized = value.normalize('NFKC').trim();
  if (kind === 'phone') {
    return /^\+?[\p{N}\s().-]+$/u.test(normalized) && digits(normalized) >= 6;
  }
  if (kind === 'version') {
    return /^(?:v?\p{N}+(?:\.\p{N}+){0,4}(?:[-+][\p{L}\p{M}\p{N}.-]+)?|[\p{Lu}\p{Lt}][\p{L}\p{M}\p{N}.-]*[/:_-]\p{N}+(?:\.\p{N}+){0,4}|[\p{Lu}\p{Lt}][\p{L}\p{M}\p{N}.-]*(?:\s+|(?=\p{N}))v?\p{N}+(?:\.\p{N}+){0,4})$/u.test(
      normalized,
    );
  }
  if (kind === 'standard') {
    return /^[\p{Lu}\p{Lt}][\p{Lu}\p{Lt}\p{N}-]{1,15}\s+\p{N}+(?::\p{N}+)?$/u.test(normalized);
  }
  if (kind === 'identifier') {
    return (
      /^\p{N}+(?:\s+\p{N}+)+$/u.test(normalized) ||
      (/^[\p{L}\p{M}\p{N}._:/+ -]+$/u.test(normalized) &&
        !/\s/u.test(normalized) &&
        /\p{N}/u.test(normalized))
    );
  }
  if (kind === 'contact') {
    if (/^\+?[\p{N}\s().-]+$/u.test(normalized)) return digits(normalized) >= 6;
    const phoneStart = normalized.search(/\+\p{N}/u);
    if (phoneStart < 0 || digits(normalized.slice(phoneStart)) < 6) return false;
    const contactPrefix = normalized
      .slice(0, phoneStart)
      .trim()
      .replace(/\s+at$/iu, '');
    const nameUnits = contactPrefix.split(/\s+/u).filter(Boolean);
    return (
      nameUnits.length > 0 &&
      nameUnits.length <= 4 &&
      nameUnits.every((unit) => /^[\p{Lu}\p{Lt}][\p{L}\p{M}'’-]*$/u.test(unit))
    );
  }
  if (!/^[\p{L}\p{M}\p{N}\s,.'#\/-]+$/u.test(normalized) || !/\p{N}/u.test(normalized)) {
    return false;
  }
  if (/^\p{N}/u.test(normalized)) return true;
  const firstNumber = normalized.search(/\p{N}/u);
  if (firstNumber < 0) return false;
  const streetUnits = normalized.slice(0, firstNumber).trim().split(/\s+/u).filter(Boolean);
  return (
    streetUnits.length > 0 &&
    streetUnits.length <= 3 &&
    streetUnits.every((unit) => /^[\p{Lu}\p{Lt}][\p{L}\p{M}'’-]*$/u.test(unit))
  );
}

function looksLikeStructuredIdentifier(value: string): boolean {
  return (
    /\p{N}/u.test(value) &&
    /\p{L}/u.test(value) &&
    (/[\p{Lu}\p{Lt}]/u.test(value) || /\p{Ll}\p{Lu}/u.test(value)) &&
    !NON_EXACT_LEXICAL_PATTERN.test(value.toLocaleLowerCase())
  );
}

function hasAdmissibleNumericValueShape(
  sourceValue: string,
  structuredNumericKind: StructuredNumericValueKind | undefined,
): boolean {
  const normalized = sourceValue.normalize('NFKC');
  const lower = normalized.toLocaleLowerCase().trim();
  if (
    NON_EXACT_LEXICAL_PATTERN.test(lower) ||
    NUMBER_WORD_RANGE_PATTERN.test(lower) ||
    /\p{N}\s*至\s*\p{N}/u.test(lower)
  ) {
    return false;
  }
  const numbers = Array.from(normalized.matchAll(NUMERIC_PATTERN));
  if (numbers.length === 0) return true;
  if (structuredNumericKind) {
    return hasAdmissibleStructuredNumericValueShape(normalized, structuredNumericKind);
  }
  if (looksLikeStructuredIdentifier(normalized)) return true;
  if (numbers.length > 1) {
    if (
      /^\p{N}{4}-\p{N}{1,2}-\p{N}{1,2}$/u.test(lower) ||
      /^\p{N}{1,2}[/.]\p{N}{1,2}[/.]\p{N}{2,4}$/u.test(lower)
    ) {
      return true;
    }
    return false;
  }

  const number = numbers[0]!;
  const numberStart = number.index ?? 0;
  const numberEnd = numberStart + number[0].length;
  const prefix = normalized
    .slice(0, numberStart)
    .trim()
    .replace(/[\s,.:/+-]+$/gu, '');
  const suffix = normalized
    .slice(numberEnd)
    .trim()
    .replace(/^[\s,.:/+-]+/gu, '');
  if (
    prefix &&
    !EXACT_MONTH_OR_DAY_PATTERN.test(prefix.toLocaleLowerCase()) &&
    !looksLikeStructuredIdentifier(`${prefix}${number[0]}`)
  ) {
    return false;
  }
  if (!suffix) return true;
  const suffixUnits = suffix.toLocaleLowerCase().split(/\s+/u).filter(Boolean);
  return (
    (suffixUnits.length === 1 && EXACT_MONTH_OR_DAY_PATTERN.test(suffixUnits[0]!)) ||
    (suffixUnits.length > 0 &&
      suffixUnits.length <= 2 &&
      suffixUnits.every((unit) => EXACT_SCALAR_UNIT_PATTERN.test(unit)))
  );
}

function nearestNonWhitespaceBefore(text: string, offset: number): string {
  for (let index = offset - 1; index >= 0; index -= 1) {
    if (!/\s/u.test(text[index]!)) return text[index]!;
  }
  return '';
}

function nearestNonWhitespaceAfter(text: string, offset: number): string {
  for (let index = offset; index < text.length; index += 1) {
    if (!/\s/u.test(text[index]!)) return text[index]!;
  }
  return '';
}

/**
 * Word tokenization must not erase operators that weaken or reverse a value.
 * Literal-name/title relations are the only escape because punctuation can be
 * intentional content there and the relation itself provides exact semantics.
 */
export function hasAdmissibleExactFactSourceSpan(input: {
  text: string;
  valueStart: number;
  valueEnd: number;
  allowLiteral?: boolean;
  structuredNumericKind?: StructuredNumericValueKind;
}): boolean {
  if (input.valueEnd <= input.valueStart) return false;
  if (input.allowLiteral === true) return true;

  const sourceValue = input.text.slice(input.valueStart, input.valueEnd).normalize('NFKC');
  const structuredNumericText = input.structuredNumericKind !== undefined;
  if (
    NON_EXACT_OPERATOR_PATTERN.test(sourceValue) ||
    /\+\s*\/\s*-/u.test(sourceValue) ||
    (!structuredNumericText && TRAILING_OPEN_RANGE_PATTERN.test(sourceValue)) ||
    (!structuredNumericText && NUMERIC_RANGE_PATTERN.test(sourceValue)) ||
    NUMERIC_COMPARISON_PATTERN.test(sourceValue.toLocaleLowerCase()) ||
    ATTACHED_NUMERIC_QUALIFIER_PATTERN.test(sourceValue.toLocaleLowerCase()) ||
    FROM_TO_NUMERIC_RANGE_PATTERN.test(sourceValue.toLocaleLowerCase()) ||
    !hasAdmissibleNumericValueShape(sourceValue, input.structuredNumericKind)
  ) {
    return false;
  }

  return (
    !NON_EXACT_OPERATOR_PATTERN.test(nearestNonWhitespaceBefore(input.text, input.valueStart)) &&
    !NON_EXACT_OPERATOR_PATTERN.test(nearestNonWhitespaceAfter(input.text, input.valueEnd)) &&
    nearestNonWhitespaceAfter(input.text, input.valueEnd) !== '+'
  );
}

export function hasOnlyAdmissibleRawGap(input: {
  text: string;
  start: number;
  end: number;
  allowCommaOrColon?: boolean;
  allowOpeningQuote?: boolean;
}): boolean {
  if (input.end < input.start) return false;
  const gap = input.text.slice(input.start, input.end);
  const punctuation = input.allowCommaOrColon ? ',:' : '';
  const quotes = input.allowOpeningQuote ? '"\u201c\u2018\u00ab\u2039\u300c\u300e' : '';
  return new RegExp(`^[\\s${punctuation}${quotes}]*$`, 'u').test(gap);
}
