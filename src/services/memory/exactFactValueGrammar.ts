export interface ExactFactValueGrammarToken {
  value: string;
  lower: string;
  start: number;
  end: number;
  quoted: boolean;
}

const UNSAFE_VALUE_MARKERS = new Set(
  "about alleged almost approx approximate approximately around assuming between circa either estimated expected guess if interim isn't isnt likely maximum maybe minimum nearly onetime or perhaps possible possibly presumed probable probably projected provided provisional reported roughly should supposed tentative trial under unless whenever whether would als misschien mogelijk ongeveer ofwel waarschijnlijk wellicht zou ou peut-être possiblement probablement approximativement environ pourrait oder vielleicht möglicherweise wahrscheinlich ungefähr etwa würde quizás quizá posiblemente probablemente aproximadamente tal-vez talvez possivelmente provavelmente aproximadamente forse probabilmente ربما محتمل تقريباً 可能 大概 也许 たぶん おそらく أو 或 或者".split(
    ' ',
  ),
);
const VALUE_TAG_MARKERS = new Set(
  "correct okay ok right yes no aren't arent isn't isnt wasn't wasnt weren't werent klopt toch correct non oui nein richtig".split(
    ' ',
  ),
);
const TEMPORAL_VALUE_MARKERS = new Set(
  'today tomorrow tonight friday monday saturday sunday thursday tuesday wednesday januari februari maart april mei juni juli augustus september oktober november december january february march april may june july august september october november december aujourd’hui demain vendredi lundi samedi dimanche jeudi mardi mercredi heute morgen freitag montag samstag sonntag donnerstag dienstag mittwoch'.split(
    ' ',
  ),
);
const CALENDAR_MONTH_MARKERS = new Set(
  'january february march april may june july august september october november december januari februari maart april mei juni juli augustus september oktober november december janvier février mars avril mai juin juillet août septembre octobre novembre décembre januar februar märz april mai juni juli august september oktober november dezember'.split(
    ' ',
  ),
);
const VALUE_TOKEN_PATTERN = /[\p{L}\p{M}\p{N}_+-]+(?:['’][\p{L}\p{M}\p{N}_+-]+)*/gu;
const QUESTION_TERMINAL_PATTERN = /[?;՞؟⁇⁈⁉‽]/u;
const MAX_EXACT_FACT_VALUE_CHARS = 200;
const UNSAFE_VALUE_PHRASE_PATTERN =
  /\b(?:as\s+much\s+as|at\s+(?:least|most)|by\s+default|cerca\s+de|(?:could|may|might)\s+be|from\s+now\s+on|give\s+or\s+take|going\s+forward|i\s+(?:guess|think)|in\s+general|more\s+or\s+less|peut\s+être|somewhere\s+between|tal\s+vez|up\s+to)\b/u;
const EXPLICIT_LITERAL_HEADS = new Set(
  'code label name title word code label naam titel woord code libellé nom titre mot code kennzeichnung name titel wort código etiqueta nombre título palabra código etiqueta nome rótulo título palavra'.split(
    ' ',
  ),
);
const LITERAL_CATEGORY_HEADS = new Set(
  'book film hotel model movie project boek film hotel model project livre film hôtel modèle projet buch film hotel modell projekt película pelicula filme livro livro hotel modelo projeto'.split(
    ' ',
  ),
);
const LITERAL_PREFERENCE_MARKERS = new Set(
  'favorite favourite prefer preferred preference favoriet favoriete voorkeur préféré préférée préférence favori favorite bevorzugt bevorzugte bevorzugter bevorzugtes präferenz preferido preferida preferência favorito favorita'.split(
    ' ',
  ),
);
const LITERAL_VALUE_LINKERS = new Set(
  'am are as is to ben bent heet noem op zijn est nomme nommé sont à ist nenne sind zu es llama llamado a é chama chamado para'.split(
    ' ',
  ),
);
const LITERAL_HEAD_MODIFIERS = new Set(
  'actual actually current currently default favorite favourite preferred primary gebruikelijk gebruikelijke voorkeur préféré préférée favori favorite aktuell bevorzugt bevorzugte bevorzugter bevorzugtes preferido preferida favorito favorita'.split(
    ' ',
  ),
);

function markerUnits(value: string): string[] {
  return value.split(/[-_+]/u);
}

export function isLiteralFactUnit(value: string): boolean {
  return EXPLICIT_LITERAL_HEADS.has(value.toLocaleLowerCase());
}

function literalTargetKindBeforeValue(
  tokens: readonly ExactFactValueGrammarToken[],
  valueStart: number,
): 'explicit' | 'preferred' | 'call' | null {
  const beforeValue = tokens.filter((token) => !token.quoted && token.end <= valueStart);
  const linkerIndex = beforeValue.findLastIndex((token) => LITERAL_VALUE_LINKERS.has(token.lower));
  if (linkerIndex > 0) {
    const nominal = beforeValue.slice(0, linkerIndex);
    for (let index = linkerIndex - 1; index >= 0; index -= 1) {
      const token = beforeValue[index]!;
      if (LITERAL_HEAD_MODIFIERS.has(token.lower)) continue;
      if (isLiteralFactUnit(token.lower)) return 'explicit';
      if (LITERAL_CATEGORY_HEADS.has(token.lower)) {
        return nominal.some((candidate) => LITERAL_PREFERENCE_MARKERS.has(candidate.lower))
          ? 'preferred'
          : null;
      }
      return LITERAL_PREFERENCE_MARKERS.has(token.lower) &&
        nominal.some((candidate) => LITERAL_CATEGORY_HEADS.has(candidate.lower))
        ? 'preferred'
        : null;
    }
  }
  const last = beforeValue.at(-1)?.lower;
  const prior = beforeValue.at(-2)?.lower;
  return ['me', 'mij', 'moi', 'mich', 'mir'].includes(last ?? '') &&
    ['call', 'name', 'noem', 'nomme', 'nenne', 'llama', 'chama'].includes(prior ?? '')
    ? 'call'
    : null;
}

export function hasLiteralTargetBeforeValue(
  tokens: readonly ExactFactValueGrammarToken[],
  valueStart: number,
): boolean {
  return literalTargetKindBeforeValue(tokens, valueStart) !== null;
}

export function hasUnambiguousLiteralTargetBeforeValue(
  tokens: readonly ExactFactValueGrammarToken[],
  valueStart: number,
): boolean {
  const kind = literalTargetKindBeforeValue(tokens, valueStart);
  return kind === 'explicit' || kind === 'preferred' || kind === 'call';
}

export function exactPropertyTargetAllowsLiteralValue(
  tokens: readonly ExactFactValueGrammarToken[],
  subjectIndex: number,
  headIndex: number,
): boolean {
  const head = tokens[headIndex]!;
  if (isLiteralFactUnit(head.lower)) return true;
  return (
    LITERAL_CATEGORY_HEADS.has(head.lower) &&
    tokens
      .slice(subjectIndex + 1, headIndex)
      .some((token) => LITERAL_PREFERENCE_MARKERS.has(token.lower))
  );
}

export function looksLikeTitleCaseLiteral(value: string): boolean {
  const words = Array.from(value.matchAll(/[\p{L}\p{M}\p{N}]+/gu), (match) => match[0]);
  return words.length > 1 && words.every((word) => /^(?:\p{Lu}|\p{Lt}|\p{N})/u.test(word));
}

export function hasQuestionTerminal(value: string): boolean {
  return QUESTION_TERMINAL_PATTERN.test(value);
}

export function hasAdmissibleExactSelfFactValue(
  value: string,
  options: { allowLiteral?: boolean } = {},
): boolean {
  if (Array.from(value).length > MAX_EXACT_FACT_VALUE_CHARS) return false;
  const normalized = value.normalize('NFKC').toLocaleLowerCase();
  if (hasQuestionTerminal(normalized)) return false;
  const literalValue = options.allowLiteral === true;
  if (!literalValue && UNSAFE_VALUE_PHRASE_PATTERN.test(normalized)) return false;
  const tokens = Array.from(normalized.matchAll(VALUE_TOKEN_PATTERN), (match) => match[0]);
  if (tokens.length === 0) return false;
  if (
    !literalValue &&
    tokens.some((token, index) => UNSAFE_VALUE_MARKERS.has(token) || (token === 'o' && index > 0))
  ) {
    return false;
  }
  if (!literalValue && tokens.length > 1 && VALUE_TAG_MARKERS.has(tokens.at(-1)!)) return false;
  const hasExactDayMonthOrder =
    tokens.length === 2 &&
    /^(?:[1-9]|[12]\p{N}|3[01])$/u.test(tokens[0]!) &&
    markerUnits(tokens[1]!).some((unit) => CALENDAR_MONTH_MARKERS.has(unit));
  if (
    !hasExactDayMonthOrder &&
    tokens.some(
      (token, index) =>
        index > 0 && markerUnits(token).some((unit) => TEMPORAL_VALUE_MARKERS.has(unit)),
    )
  ) {
    return false;
  }
  if (literalValue) return true;
  if (
    tokens.some((token, index) => index > 0 && ['next', 'one', 'single', 'this'].includes(token))
  ) {
    return false;
  }
  const onlyIndex = tokens.findIndex((token) => token === 'only');
  if (onlyIndex < 0) return true;
  return !(
    /\p{N}/u.test(tokens[0] ?? '') ||
    tokens.some((token) =>
      markerUnits(token).some(
        (unit) =>
          TEMPORAL_VALUE_MARKERS.has(unit) ||
          ['for', 'next', 'one', 'single', 'this'].includes(unit),
      ),
    )
  );
}
