export interface ExactSelfCorrectionToken {
  lower: string;
  start: number;
  end: number;
  quoted: boolean;
}

export const CORRECTION_MARKERS = new Set(
  'actually change changed correction instead make remember replace set switch update updated eigenlijk maak verander vervang voortaan wijzig zet désormais mets remplace'.split(
    ' ',
  ),
);

export const CORRECTION_ACTION_MARKERS = new Set(
  'change changed make replace set switch update updated maak verander vervang wijzig zet mets remplace'.split(
    ' ',
  ),
);

export const ANAPHORIC_CORRECTION_TARGETS = new Set(['it', 'that', 'this']);

export const DURABLE_CORRECTION_MARKERS = new Set(
  'default preference remember usual usually gebruikelijk gebruikelijke standaard voortaan désormais habituel habituelle'.split(
    ' ',
  ),
);

export const TEMPORARY_CORRECTION_MARKERS = new Set(
  "temporary temporarily today tonight until tijdelijk vandaag temporaire temporairement aujourd'hui".split(
    ' ',
  ),
);

const TEMPORARY_SCOPE_PATTERN =
  /\b(?:(?:just|only)\s+for|for\s+(?:now|the\s+moment|this|the\s+next|tomorrow)|(?:this|next)\s+(?:time|week|month|meeting|review)|voor\s+(?:deze|volgende|morgen)|(?:deze|volgende)\s+(?:keer|week|maand|vergadering|review)|pour\s+(?:cette|la\s+prochaine|demain)|(?:cette|prochaine)\s+(?:fois|semaine|mois|réunion|revue))\b/u;

const INTERROGATIVE_LEAD_MARKERS = new Set(
  'am are can could did do does had has have how is may might should was were what when where which who whom whose why will would ben bent heb heeft hoe is kan kun kunt mag mogen waar waarom wat wanneer welke wie wil wilt zou'.split(
    ' ',
  ),
);
const INTERROGATIVE_CLAUSE_MARKERS = new Set(
  'whether whenever quand lorsque où pourquoi comment si wanneer waarom waar hoe'.split(' '),
);
const NON_ASSERTIVE_REQUEST_MARKERS = new Set(
  'ask check confirm tell verify wonder vraag vragen controleer bevestig vertel verifieer demande demander confirmer contrôler dis dites vérifier'.split(
    ' ',
  ),
);
const DEICTIC_SCOPE_MARKERS = new Set(
  'this next deze volgende ce cet cette prochain prochaine'.split(' '),
);
const TEMPORAL_SCOPE_UNITS = new Set(
  "afternoon evening lunch dinner meeting moment month morning review time today tomorrow tonight week weekend year middag avond diner lunch vergadering moment maand ochtend review keer vandaag morgen vanavond week weekend jaar après-midi déjeuner dîner réunion moment mois matin revue fois aujourd'hui demain soir semaine week-end année".split(
    ' ',
  ),
);
const EVENT_SCOPE_MARKERS = new Set(
  'after before once until when whenever while après avant dès jusque lorsque quand totdat wanneer zodra'.split(
    ' ',
  ),
);
const TRAILING_SCOPE_MARKERS = new Set(
  'for during until pendant pour jusquà tijdens tot voor'.split(' '),
);

const ADMISSIBLE_PRIOR_ANCHOR_SUFFIX = new Set('anymore instead now'.split(' '));
const GENERIC_CORRECTION_RELATION_UNITS = new Set(
  'current default duration length meeting new preference preferred primary review time usual duur gebruikelijk gebruikelijke lengte tijd standaard voorkeur vergadering défaut durée habituel habituelle longueur préférence réunion revue temps'.split(
    ' ',
  ),
);
const ADMISSIBLE_CORRECTION_TARGET_GAP = new Set(
  'a an at be current de default des du for forward from going habituel habituelle is new now of on op pour preferred primary the to usual voor à'.split(
    ' ',
  ),
);
const ADMISSIBLE_CORRECTION_BRIDGE = new Set('forward from going now on'.split(' '));
const PREDICATE_STOP_UNITS = new Set('a an at be has have in is of on the to'.split(' '));
const SEMANTIC_UNIT_PATTERN = /[\p{L}\p{M}_+-]+(?:['’][\p{L}\p{M}_+-]+)*/gu;
const CORRECTION_SHAPE_TOKEN_PATTERN = /[\p{L}\p{M}\p{N}_+-]+(?:['’][\p{L}\p{M}\p{N}_+-]+)*/gu;
const CORRECTION_SHAPE_NEGATIONS = new Set(
  "cannot can't cant didnt didn't doesnt doesn't dont don't geen never niet no not nunca pas kein keine nicht لا لم لن ليس 不 没".split(
    ' ',
  ),
);

function isGenericCorrectionRelationUnit(value: string): boolean {
  const forms = new Set([value]);
  if (value.length > 3 && value.endsWith('s')) forms.add(value.slice(0, -1));
  if (value.length > 4 && value.endsWith('es')) forms.add(value.slice(0, -2));
  return Array.from(forms).some((form) => GENERIC_CORRECTION_RELATION_UNITS.has(form));
}

function predicateHasDistinguishingUnit(predicate: string): boolean {
  const separated = predicate
    .normalize('NFKC')
    .replace(/([\p{Ll}\p{N}])([\p{Lu}])/gu, '$1 $2')
    .toLocaleLowerCase();
  return Array.from(separated.matchAll(/[\p{L}\p{M}\p{N}]+/gu), (match) => match[0]).some(
    (unit) => !PREDICATE_STOP_UNITS.has(unit) && !isGenericCorrectionRelationUnit(unit),
  );
}

function semanticUnitForms(value: string): Set<string> {
  const forms = new Set<string>();
  for (const match of value.normalize('NFKC').toLocaleLowerCase().matchAll(SEMANTIC_UNIT_PATTERN)) {
    const unit = match[0];
    forms.add(unit);
    if (unit.length > 3 && unit.endsWith('s')) forms.add(unit.slice(0, -1));
    if (unit.length > 4 && unit.endsWith('es')) forms.add(unit.slice(0, -2));
  }
  return forms;
}

/** Unitless old-value shorthand cannot move a fact into another semantic unit. */
export function hasCompatibleNumericAnchorUnits(currentValue: string, nextValue: string): boolean {
  const currentUnits = semanticUnitForms(currentValue);
  const nextUnits = semanticUnitForms(nextValue);
  if (currentUnits.size === 0 || nextUnits.size === 0) {
    return currentUnits.size === nextUnits.size;
  }
  return Array.from(currentUnits).some((unit) => nextUnits.has(unit));
}

function correctionShapeTokens(value: string): string[] {
  return Array.from(
    value.normalize('NFKC').toLocaleLowerCase().matchAll(CORRECTION_SHAPE_TOKEN_PATTERN),
    (match) => match[0],
  );
}

function sequenceMatches(tokens: readonly string[], start: number, expected: readonly string[]) {
  return expected.every((token, offset) => tokens[start + offset] === token);
}

/**
 * Detect a negated old-value anchor independently of strict correction
 * admission. This can only suppress a weaker direct-claim fallback.
 */
export function hasPotentialSelfCorrectionAnchor(input: {
  text: string;
  value: string;
  currentValue: string;
}): boolean {
  const tokens = correctionShapeTokens(input.text);
  const nextTokens = correctionShapeTokens(input.value);
  const currentTokens = correctionShapeTokens(input.currentValue);
  if (nextTokens.length === 0 || currentTokens.length === 0) return false;
  const numericAnchors = currentTokens.filter((token) =>
    /^[+-]?\p{N}+(?:[.,]\p{N}+)?$/u.test(token),
  );

  const nextStart = tokens.findIndex((_, index) => sequenceMatches(tokens, index, nextTokens));
  if (nextStart < 0) return false;

  let hasNegation = false;
  for (
    let priorStart = nextStart + nextTokens.length;
    priorStart < tokens.length;
    priorStart += 1
  ) {
    const token = tokens[priorStart]!;
    if (CORRECTION_SHAPE_NEGATIONS.has(token)) {
      hasNegation = true;
      continue;
    }
    if (!hasNegation) continue;
    const fullAnchor =
      token === currentTokens[0] && sequenceMatches(tokens, priorStart, currentTokens);
    const partialAnchor = numericAnchors.length === 1 && token === numericAnchors[0];
    if (fullAnchor || partialAnchor) return true;
  }
  return false;
}

/** Reject qualifiers between the replacement value and its negated old anchor. */
export function hasAdmissibleCorrectionBridge(input: {
  tokens: readonly ExactSelfCorrectionToken[];
  valueEnd: number;
  priorAnchorStart: number;
  isNegation: (value: string) => boolean;
  isDurableMarker: (value: string) => boolean;
}): boolean {
  return input.tokens
    .filter((token) => token.start >= input.valueEnd && token.end <= input.priorAnchorStart)
    .every(
      (token) =>
        !token.quoted &&
        (input.isNegation(token.lower) ||
          input.isDurableMarker(token.lower) ||
          ADMISSIBLE_CORRECTION_BRIDGE.has(token.lower)),
    );
}

export function hasDurableCorrectionIntent(input: {
  text: string;
  tokens: readonly ExactSelfCorrectionToken[];
  intentStart: number;
  priorAnchorStart: number;
  valueStart: number;
}): boolean {
  return (
    /\b(?:from\s+now\s+on|going\s+forward)\b/u.test(
      input.text.slice(input.intentStart, input.priorAnchorStart).toLocaleLowerCase(),
    ) ||
    input.tokens.some(
      (token) =>
        !token.quoted &&
        token.start >= input.intentStart &&
        token.end <= input.valueStart &&
        DURABLE_CORRECTION_MARKERS.has(token.lower),
    )
  );
}

export function hasAdmissibleDurableCorrection(input: {
  text: string;
  tokens: readonly ExactSelfCorrectionToken[];
  intentStart: number;
  valueStart: number;
  valueEnd: number;
  priorAnchorStart: number;
  isNegation: (value: string) => boolean;
}): boolean {
  return (
    hasAdmissibleCorrectionBridge({
      tokens: input.tokens,
      valueEnd: input.valueEnd,
      priorAnchorStart: input.priorAnchorStart,
      isNegation: input.isNegation,
      isDurableMarker: (candidate) => DURABLE_CORRECTION_MARKERS.has(candidate),
    }) && hasDurableCorrectionIntent(input)
  );
}

/** A destructive correction cannot leave an unscoped trailing clause. */
export function hasTrailingCorrectionContent(text: string, clauseEnd: number): boolean {
  return text.slice(clauseEnd).replace(/^[\s.!?;,:]+/u, '').length > 0;
}

export function hasUnsafeSelfClaimQualifier(input: {
  tokens: readonly ExactSelfCorrectionToken[];
  lowerText: string;
  valueStart: number;
  valueEnd: number;
  isAttribution: (value: string) => boolean;
  isHypothetical: (value: string) => boolean;
}): boolean {
  const outsideValue = input.tokens.filter(
    (token) => !token.quoted && (token.end <= input.valueStart || token.start >= input.valueEnd),
  );
  const first = outsideValue[0];
  const beforeValue = outsideValue.filter((token) => token.end <= input.valueStart);
  const hasDeicticTemporalScope = outsideValue.some(
    (token, index) =>
      DEICTIC_SCOPE_MARKERS.has(token.lower) &&
      TEMPORAL_SCOPE_UNITS.has(outsideValue[index + 1]?.lower ?? ''),
  );
  const hasTrailingScope = outsideValue.some(
    (token) => token.start >= input.valueEnd && TRAILING_SCOPE_MARKERS.has(token.lower),
  );
  const hasInterrogativeShape =
    (first !== undefined && INTERROGATIVE_LEAD_MARKERS.has(first.lower)) ||
    outsideValue.some((token) => INTERROGATIVE_CLAUSE_MARKERS.has(token.lower));
  const hasNonAssertiveRequest = beforeValue.some((token) =>
    NON_ASSERTIVE_REQUEST_MARKERS.has(token.lower),
  );

  return (
    outsideValue.some(
      (token) =>
        input.isAttribution(token.lower) ||
        input.isHypothetical(token.lower) ||
        TEMPORARY_CORRECTION_MARKERS.has(token.lower) ||
        EVENT_SCOPE_MARKERS.has(token.lower),
    ) ||
    hasInterrogativeShape ||
    hasNonAssertiveRequest ||
    hasDeicticTemporalScope ||
    hasTrailingScope ||
    TEMPORARY_SCOPE_PATTERN.test(input.lowerText)
  );
}

/**
 * Require a direct correction target to name either multiple predicate units
 * or one distinguishing unit. A generic unit such as "duration" cannot by
 * itself retarget an unrelated persisted preference.
 */
export function hasDistinguishingCorrectionTarget(input: {
  tokens: readonly ExactSelfCorrectionToken[];
  predicate: string;
  correctionIndex: number;
  valueStart: number;
  isPredicateRelation: (index: number) => boolean;
  isBoundPredicateRelation: (index: number) => boolean;
}): boolean {
  const relationIndexes: number[] = [];
  for (let index = input.correctionIndex + 1; index < input.tokens.length; index += 1) {
    const token = input.tokens[index]!;
    if (token.end > input.valueStart) break;
    if (!token.quoted && input.isPredicateRelation(index)) relationIndexes.push(index);
  }
  const relationIndexSet = new Set(relationIndexes);
  const firstRelationIndex = relationIndexes[0];
  const targetIsContiguous =
    firstRelationIndex !== undefined &&
    input.tokens
      .slice(
        firstRelationIndex,
        input.tokens.findIndex((token) => token.end > input.valueStart),
      )
      .every(
        (token, offset) =>
          !token.quoted &&
          (relationIndexSet.has(firstRelationIndex + offset) ||
            ADMISSIBLE_CORRECTION_TARGET_GAP.has(token.lower) ||
            isGenericCorrectionRelationUnit(token.lower)),
      );
  return (
    targetIsContiguous &&
    relationIndexes.some(input.isBoundPredicateRelation) &&
    (relationIndexes.some(
      (index) => !isGenericCorrectionRelationUnit(input.tokens[index]!.lower),
    ) ||
      (!predicateHasDistinguishingUnit(input.predicate) && relationIndexes.length >= 2))
  );
}

/** An old-value anchor must terminate the clause apart from inert adverbs. */
export function hasAdmissiblePriorAnchorSuffix(
  tokens: readonly ExactSelfCorrectionToken[],
  priorTokenEndIndex: number,
): boolean {
  return tokens
    .slice(priorTokenEndIndex + 1)
    .every((candidate) => !candidate.quoted && ADMISSIBLE_PRIOR_ANCHOR_SUFFIX.has(candidate.lower));
}
