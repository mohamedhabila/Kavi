import {
  hasAdmissibleExactFactSourceSpan,
  hasOnlyAdmissibleRawGap,
  type StructuredNumericValueKind,
} from './exactFactValueSource';
import {
  exactPropertyTargetAllowsLiteralValue,
  hasAdmissibleExactSelfFactValue,
  hasLiteralTargetBeforeValue,
  hasUnambiguousLiteralTargetBeforeValue,
  looksLikeTitleCaseLiteral,
} from './exactFactValueGrammar';
import {
  hasAdmissibleContextPrefix,
  isContextScopeEndMarker,
  isContextScopeStartMarker,
  isPredicateContextPrefix,
} from './exactClaimContextGrammar';
import { matchExactSelfRelation } from './exactSelfRelationGrammar';
import { exactPropertyTargetStructuredNumericKind } from './exactPropertyValuePolicy';
import { hasExactDirectClaimSuffix } from './exactDirectClaimSuffix';
import {
  hasInexactPropertyNominalMorphology,
  isAdmissiblePropertyDescriptor,
  isCodeOwnedPropertyDescriptor,
  isUnsafePropertyNominalUnit,
} from './exactPropertyDescriptorGrammar';
import {
  predicateCoversExactPropertyDescriptor,
  predicateHasOnlyExactPropertyTargetSemantics,
} from './exactPropertyPredicateGrammar';

export interface ExactSelfClaimGrammarToken {
  value: string;
  lower: string;
  start: number;
  end: number;
  quoted: boolean;
}

export type ExactSelfClaimSubjectKind = 'self' | 'possessive' | 'object';

export {
  hasAdmissibleExactSelfFactValue,
  hasLiteralTargetBeforeValue,
  hasQuestionTerminal,
  hasUnambiguousLiteralTargetBeforeValue,
  isLiteralFactUnit,
  looksLikeTitleCaseLiteral,
} from './exactFactValueGrammar';
export { exactPropertyHeadStructuredNumericKind } from './exactPropertyValuePolicy';

const DIRECT_ACTION_PREFIXES: readonly (readonly string[])[] = [
  ['change'],
  ['make'],
  ['note'],
  ['note', 'that'],
  ['please', 'change'],
  ['please', 'make'],
  ['please', 'note'],
  ['please', 'note', 'that'],
  ['please', 'remember'],
  ['please', 'remember', 'that'],
  ['please', 'set'],
  ['please', 'update'],
  ['please'],
  ['remember'],
  ['remember', 'that'],
  ['set'],
  ['update'],
  ['maak'],
  ['onthoud'],
  ['onthoud', 'dat'],
  ['verander'],
  ['zet'],
  ['mets'],
  ['mettez'],
  ['notez'],
  ['retenez'],
];

const PROPERTY_ASSERTION_LINKERS = new Set(
  'am are equals is to ben bent heet is op zijn est égale sont à entspricht ist sind zu equivale es son a é equivale são para'.split(
    ' ',
  ),
);

export function isExactPropertyAssertionLinker(value: string): boolean {
  return PROPERTY_ASSERTION_LINKERS.has(value.toLocaleLowerCase());
}
const NOMINAL_MODIFIERS = new Set(
  'actual actually current currently default favorite favourite preferred primary usual gebruikelijk gebruikelijke huidig huidige standaard favoriet favoriete voorkeur habituel habituelle actuel actuelle défaut favori favorite préféré préférée üblich übliche aktuell aktuelle standard bevorzugt bevorzugte bevorzugter bevorzugtes habitual actual predeterminado favorito favorita preferido preferida atual padrão favorito favorita preferido preferida'.split(
    ' ',
  ),
);
const SEMANTIC_PROPERTY_HEADS = new Set(
  'address age allergies allergy birthday budget certification channel city code color colour confidence contact deadline drink duration email font handle identifier id label language length location method name nationality number occupation pet phone preference profession pronoun pronouns protocol requirement requirements resolution restriction restrictions role size standard state status time timeout timezone title token type username version word adres leeftijd verjaardag budget kanaal kleur contact deadline duur e-mail lettertype locatie methode naam nummer beroep voorkeur resolutie rol grootte staat status tijd time-out tijdzone titel woord adresse âge anniversaire budget canal couleur contact délai durée e-mail emplacement libellé méthode nom numéro police profession préférence résolution rôle taille état statut temps fuseau titre mot adresse alter geburtstag budget kanal farbe kennzeichnung kontakt frist dauer e-mail schriftart sprache ort methode name nummer beruf präferenz auflösung rolle größe zustand status zeit zeitlimit zeitzone titel wort dirección edad cumpleaños presupuesto canal color contacto duración correo etiqueta fuente idioma ubicación método nombre número profesión preferencia resolución rol tamaño estado tiempo título palabra endereço idade aniversário orçamento canal cor contato prazo duração e-mail fonte idioma localização método nome número profissão preferência resolução rótulo função tamanho estado tempo título palavra'.split(
    ' ',
  ),
);
const CODE_OWNED_DESCRIPTOR_HEADS = new Set(
  'budget deadline duration length state status time timeout duur staat status tijd time-out budget délai durée état statut temps budget dauer frist zustand status zeit zeitlimit presupuesto duración estado tiempo orçamento prazo duração estado tempo'.split(
    ' ',
  ),
);
const DURABILITY_QUALIFIED_SCALAR_HEADS = new Set(
  'budget deadline duration length time timeout duur tijd time-out budget délai durée temps budget dauer frist zeit zeitlimit presupuesto duración tiempo orçamento prazo duração tempo'.split(
    ' ',
  ),
);
const PREFERENCE_OBJECT_MODIFIERS = new Set(
  'favorite favourite preferred favoriet favoriete préféré préférée favori favorite bevorzugt bevorzugte bevorzugter bevorzugtes favorito favorita preferido preferida'.split(
    ' ',
  ),
);
const NOMINAL_COMPLEMENT_MARKERS = new Set('of de des du van von del da do'.split(' '));
const OBJECT_RELATIONS = new Set(
  'address call name noem appelle nomme nenne llama chama'.split(' '),
);
const ANAPHORIC_VALUE_LINKER_SEQUENCES: readonly (readonly string[])[] = [
  [],
  ['to'],
  ['exactly'],
  ['to', 'exactly'],
  ['als'],
  ['exact'],
  ['naar'],
  ['op'],
  ['comme'],
  ['exactement'],
  ['à'],
  ['genau'],
  ['auf'],
  ['zu'],
  ['como'],
  ['exactamente'],
  ['a'],
  ['para'],
];
const POSSESSIVE_TARGET_MARKERS = new Set(
  'my mine mijn mon ma mes mein meine mi mis meu minha لي عندي اسمي 我的'.split(' '),
);
const UNSAFE_CLAIM_SCOPE_MARKERS = new Set(
  'next one only single this today tomorrow tonight upcoming friday monday saturday sunday thursday tuesday wednesday january february march april may june july august september october november december vrijdag maandag zaterdag zondag donderdag dinsdag woensdag januari februari maart april mei juni juli augustus september oktober november december vendredi lundi samedi dimanche jeudi mardi mercredi janvier février mars avril mai juin juillet août septembre octobre novembre décembre freitag montag samstag sonntag donnerstag dienstag mittwoch januar februar märz april mai juni juli august september oktober november dezember'.split(
    ' ',
  ),
);
function matchesExact(tokens: readonly ExactSelfClaimGrammarToken[], expected: readonly string[]) {
  return (
    tokens.length === expected.length && tokens.every((token, i) => token.lower === expected[i])
  );
}

function matchesOneOf(
  tokens: readonly ExactSelfClaimGrammarToken[],
  candidates: readonly (readonly string[])[],
) {
  return candidates.some((candidate) => matchesExact(tokens, candidate));
}

function hasUnsafePropertyUnit(token: ExactSelfClaimGrammarToken): boolean {
  const units = Array.from(
    token.value
      .normalize('NFKC')
      .replace(/([\p{Ll}\p{N}])([\p{Lu}])/gu, '$1 $2')
      .matchAll(/\p{L}+|\p{N}+/gu),
    (match) => match[0].toLocaleLowerCase(),
  );
  return (
    token.quoted ||
    isUnsafePropertyNominalUnit(token.lower) ||
    isContextScopeStartMarker(token.lower) ||
    isContextScopeEndMarker(token.lower) ||
    PROPERTY_ASSERTION_LINKERS.has(token.lower) ||
    POSSESSIVE_TARGET_MARKERS.has(token.lower) ||
    units.some((unit) => UNSAFE_CLAIM_SCOPE_MARKERS.has(unit) || isUnsafePropertyNominalUnit(unit))
  );
}

function tokenIsAdmissiblePropertyUnit(
  token: ExactSelfClaimGrammarToken,
  previous: ExactSelfClaimGrammarToken | undefined,
  isPredicateUnit: (value: string) => boolean,
): boolean {
  return isAdmissiblePropertyDescriptor({
    token,
    previous,
    isPredicateUnit,
    isNominalModifier: (value) => NOMINAL_MODIFIERS.has(value),
    hasUnsafeUnit: hasUnsafePropertyUnit,
  });
}

function tokenIsAdmissiblePropertyHead(
  token: ExactSelfClaimGrammarToken,
  hasPreferenceObjectModifier = false,
): boolean {
  return (
    !hasUnsafePropertyUnit(token) &&
    (NOMINAL_MODIFIERS.has(token.lower) || !hasInexactPropertyNominalMorphology(token.lower)) &&
    !/^\p{N}+$/u.test(token.lower) &&
    (SEMANTIC_PROPERTY_HEADS.has(token.lower) ||
      ['duration', 'duur', 'durée', 'dauer', 'duración', 'duração'].some((suffix) =>
        token.lower.endsWith(suffix),
      ) ||
      hasPreferenceObjectModifier)
  );
}

export function isAdmissibleExactPropertyHead(token: ExactSelfClaimGrammarToken): boolean {
  return tokenIsAdmissiblePropertyHead(token);
}

function findTrustedPropertyRelation(input: {
  tokens: readonly ExactSelfClaimGrammarToken[];
  predicate: string;
  subjectIndex: number;
  firstValueIndex: number;
  invertedAssertion: boolean;
  allowBareAssertion?: boolean;
  isPredicateUnit: (value: string) => boolean;
}): number | null {
  let linkerIndex = input.invertedAssertion ? input.firstValueIndex : input.firstValueIndex - 1;
  if (
    !input.invertedAssertion &&
    !PROPERTY_ASSERTION_LINKERS.has(input.tokens[linkerIndex]?.lower ?? '')
  ) {
    if (!input.allowBareAssertion) return null;
    linkerIndex = input.firstValueIndex;
  }
  let nominalEnd = linkerIndex;
  let complement: readonly ExactSelfClaimGrammarToken[] = [];
  const contextIndex = input.tokens.findIndex(
    (token, index) =>
      index > input.subjectIndex && index < linkerIndex && isContextScopeStartMarker(token.lower),
  );
  if (contextIndex >= 0) {
    if (
      !isPredicateContextPrefix(
        input.tokens.slice(contextIndex, linkerIndex),
        input.isPredicateUnit,
      )
    ) {
      return null;
    }
    nominalEnd = contextIndex;
  }

  const complementIndex = input.tokens.findIndex(
    (token, index) =>
      index > input.subjectIndex &&
      index < nominalEnd &&
      NOMINAL_COMPLEMENT_MARKERS.has(token.lower),
  );
  if (complementIndex >= 0) {
    complement = input.tokens
      .slice(complementIndex + 1, nominalEnd)
      .filter((token) => !NOMINAL_COMPLEMENT_MARKERS.has(token.lower));
    if (
      complement.length === 0 ||
      complement.length > 3 ||
      !complement.every((token, index) =>
        tokenIsAdmissiblePropertyUnit(token, complement[index - 1], (candidate) =>
          predicateCoversExactPropertyDescriptor(input.predicate, candidate),
        ),
      )
    ) {
      return null;
    }
    nominalEnd = complementIndex;
  }

  const fullNominalEnd = nominalEnd;
  while (
    nominalEnd > input.subjectIndex + 1 &&
    NOMINAL_MODIFIERS.has(input.tokens[nominalEnd - 1]!.lower) &&
    !tokenIsAdmissiblePropertyHead(input.tokens[nominalEnd - 1]!)
  ) {
    nominalEnd -= 1;
  }
  const headIndex = nominalEnd - 1;
  const head = input.tokens[headIndex];
  const descriptors = input.tokens.slice(input.subjectIndex + 1, headIndex);
  const hasPreferenceObjectModifier = input.tokens
    .slice(input.subjectIndex + 1, fullNominalEnd)
    .some((token) => PREFERENCE_OBJECT_MODIFIERS.has(token.lower));
  if (
    !head ||
    !input.isPredicateUnit(head.lower) ||
    !tokenIsAdmissiblePropertyHead(head, hasPreferenceObjectModifier)
  ) {
    return null;
  }
  if (
    descriptors.length > 6 ||
    !descriptors.every((token, index) =>
      tokenIsAdmissiblePropertyUnit(token, descriptors[index - 1], (candidate) =>
        predicateCoversExactPropertyDescriptor(input.predicate, candidate),
      ),
    )
  ) {
    return null;
  }
  const exactTarget = input.tokens
    .slice(input.subjectIndex + 1, fullNominalEnd)
    .filter((token) => !NOMINAL_COMPLEMENT_MARKERS.has(token.lower));
  if (
    !predicateHasOnlyExactPropertyTargetSemantics({
      predicate: input.predicate,
      target: exactTarget,
      source: input.tokens.slice(0, input.firstValueIndex),
      head,
      isNominalModifier: (value) => NOMINAL_MODIFIERS.has(value),
    })
  ) {
    return null;
  }
  if (
    CODE_OWNED_DESCRIPTOR_HEADS.has(head.lower) &&
    [...descriptors, ...complement].some(
      (token, index, tokens) =>
        !isCodeOwnedPropertyDescriptor({
          token,
          previous: tokens[index - 1],
          isNominalModifier: (value) => NOMINAL_MODIFIERS.has(value),
        }),
    )
  ) {
    return null;
  }
  if (
    DURABILITY_QUALIFIED_SCALAR_HEADS.has(head.lower) &&
    descriptors.length > 0 &&
    !descriptors.some((token) => NOMINAL_MODIFIERS.has(token.lower))
  ) {
    return null;
  }
  return headIndex;
}

export interface AdmissibleCorrectionActionToValueSpan {
  kind: 'anaphoric' | 'direct_property';
  allowLiteralValue: boolean;
  structuredNumericKind?: StructuredNumericValueKind;
}

function hasRawTokenContinuity(input: {
  text: string;
  tokens: readonly ExactSelfClaimGrammarToken[];
  startIndex: number;
  endIndexExclusive: number;
  valueStart: number;
  allowOpeningQuote?: boolean;
}): boolean {
  for (let index = input.startIndex; index + 1 < input.endIndexExclusive; index += 1) {
    if (
      !hasOnlyAdmissibleRawGap({
        text: input.text,
        start: input.tokens[index]!.end,
        end: input.tokens[index + 1]!.start,
        allowCommaOrColon: index === input.startIndex,
      })
    ) {
      return false;
    }
  }
  const last = input.tokens[input.endIndexExclusive - 1];
  return (
    last !== undefined &&
    hasOnlyAdmissibleRawGap({
      text: input.text,
      start: last.end,
      end: input.valueStart,
      allowOpeningQuote: input.allowOpeningQuote,
    })
  );
}

function hasAdmissibleRawPrefix(input: {
  text: string;
  clauseStart: number;
  tokens: readonly ExactSelfClaimGrammarToken[];
  coreStart: number;
}): boolean {
  const first = input.tokens[0];
  if (!first) return false;
  if (
    !hasOnlyAdmissibleRawGap({
      text: input.text,
      start: input.clauseStart,
      end: first.start,
    })
  ) {
    return false;
  }
  for (let index = 0; index < input.coreStart; index += 1) {
    const next = input.tokens[index + 1];
    if (
      !next ||
      !hasOnlyAdmissibleRawGap({
        text: input.text,
        start: input.tokens[index]!.end,
        end: next.start,
        allowCommaOrColon: true,
      })
    ) {
      return false;
    }
  }
  return true;
}

/** Match one complete correction action, target, linker, and exact value seam. */
export function matchAdmissibleCorrectionActionToValueSpan(input: {
  text: string;
  predicate: string;
  tokens: readonly ExactSelfClaimGrammarToken[];
  correctionIndex: number;
  valueStart: number;
  valueIsQuoted: boolean;
  valueLooksLikeTitle: boolean;
  allowLiteralTarget: boolean;
  isCorrectionAction: (value: string) => boolean;
  isAnaphoricTarget: (value: string) => boolean;
  isPredicateUnit: (value: string) => boolean;
}): AdmissibleCorrectionActionToValueSpan | null {
  const action = input.tokens[input.correctionIndex];
  const target = input.tokens[input.correctionIndex + 1];
  const firstValueIndex = input.tokens.findIndex((token) => token.start >= input.valueStart);
  if (!action || action.quoted || !target || target.quoted || firstValueIndex < 0) return null;

  if (input.isCorrectionAction(action.lower) && input.isAnaphoricTarget(target.lower)) {
    const linkerTokens = input.tokens.slice(input.correctionIndex + 2, firstValueIndex);
    if (
      !ANAPHORIC_VALUE_LINKER_SEQUENCES.some((sequence) => matchesExact(linkerTokens, sequence)) ||
      !hasRawTokenContinuity({
        text: input.text,
        tokens: input.tokens,
        startIndex: input.correctionIndex,
        endIndexExclusive: firstValueIndex,
        valueStart: input.valueStart,
      })
    ) {
      return null;
    }
    return {
      kind: 'anaphoric',
      allowLiteralValue: false,
    };
  }

  if (!POSSESSIVE_TARGET_MARKERS.has(target.lower)) return null;
  const headIndex = findTrustedPropertyRelation({
    tokens: input.tokens,
    predicate: input.predicate,
    subjectIndex: input.correctionIndex + 1,
    firstValueIndex,
    invertedAssertion: false,
    allowBareAssertion: true,
    isPredicateUnit: input.isPredicateUnit,
  });
  if (headIndex === null) return null;
  const literalTarget =
    input.allowLiteralTarget &&
    exactPropertyTargetAllowsLiteralValue(input.tokens, input.correctionIndex + 1, headIndex);
  if (
    !hasRawTokenContinuity({
      text: input.text,
      tokens: input.tokens,
      startIndex: input.correctionIndex,
      endIndexExclusive: firstValueIndex,
      valueStart: input.valueStart,
      allowOpeningQuote: literalTarget && input.valueIsQuoted,
    })
  ) {
    return null;
  }
  return {
    kind: 'direct_property',
    allowLiteralValue: literalTarget,
    structuredNumericKind: exactPropertyTargetStructuredNumericKind(
      input.tokens,
      input.correctionIndex + 1,
      headIndex,
    ),
  };
}

interface TrustedDirectRelation {
  relationIndex: number;
  durableSuffixBoundary: number;
}

function findTrustedDirectRelation(input: {
  text: string;
  tokens: readonly ExactSelfClaimGrammarToken[];
  subjectIndex: number;
  subjectKind: ExactSelfClaimSubjectKind;
  firstValueIndex: number;
  relationIndex: number;
  invertedAssertion: boolean;
  predicate: string;
  value: string;
  valueStart: number;
  valueEnd: number;
  isPredicateUnit: (value: string) => boolean;
  isRelationUnit: (value: string) => boolean;
}): TrustedDirectRelation | null {
  if (input.subjectKind === 'possessive') {
    const relationIndex = findTrustedPropertyRelation(input);
    return relationIndex === null ? null : { relationIndex, durableSuffixBoundary: input.valueEnd };
  }
  if (input.subjectKind === 'self') {
    return matchExactSelfRelation(input);
  }
  const relation = input.tokens[input.relationIndex];
  const subject = input.tokens[input.subjectIndex];
  if (
    !relation ||
    !subject ||
    !OBJECT_RELATIONS.has(relation.lower) ||
    input.subjectIndex !== input.relationIndex + 1
  ) {
    return null;
  }
  const trailing = input.tokens.slice(input.subjectIndex + 1, input.firstValueIndex);
  return trailing.every((token) => token.lower === 'as')
    ? { relationIndex: input.relationIndex, durableSuffixBoundary: input.valueEnd }
    : null;
}

export function hasAdmissibleDirectSelfClaimShape(input: {
  text: string;
  predicate: string;
  value: string;
  clauseStart: number;
  clauseEnd: number;
  tokens: readonly ExactSelfClaimGrammarToken[];
  subjectIndex: number;
  subjectKind: ExactSelfClaimSubjectKind;
  relationIndex: number;
  valueStart: number;
  valueEnd: number;
  allowLiteralTarget: boolean;
  isPredicateUnit: (value: string) => boolean;
  isRelationUnit: (value: string) => boolean;
}): boolean {
  const valueIndexes = input.tokens.flatMap((token, index) =>
    token.start >= input.valueStart && token.end <= input.valueEnd ? [index] : [],
  );
  const firstValueIndex = valueIndexes[0];
  if (firstValueIndex === undefined || input.relationIndex >= firstValueIndex) return false;

  const coreStart = input.subjectKind === 'object' ? input.relationIndex : input.subjectIndex;
  const literalClaim =
    input.allowLiteralTarget && hasLiteralTargetBeforeValue(input.tokens, input.valueStart);
  const unambiguousLiteralClaim = hasUnambiguousLiteralTargetBeforeValue(
    input.tokens,
    input.valueStart,
  );
  const hasQuotedValue = valueIndexes.some((index) => input.tokens[index]!.quoted);
  const allowLiteralValue =
    literalClaim &&
    (hasQuotedValue || unambiguousLiteralClaim || looksLikeTitleCaseLiteral(input.value));
  if (
    input.tokens.some(
      (token, index) => token.quoted && (!valueIndexes.includes(index) || !literalClaim),
    ) ||
    !hasAdmissibleExactSelfFactValue(input.value, { allowLiteral: allowLiteralValue })
  ) {
    return false;
  }
  if (
    !hasRawTokenContinuity({
      text: input.text,
      tokens: input.tokens,
      startIndex: coreStart,
      endIndexExclusive: firstValueIndex,
      valueStart: input.valueStart,
      allowOpeningQuote: literalClaim && hasQuotedValue,
    })
  ) {
    return false;
  }
  const prefix = input.tokens.slice(0, coreStart);
  if (
    !hasAdmissibleRawPrefix({
      text: input.text,
      clauseStart: input.clauseStart,
      tokens: input.tokens,
      coreStart,
    }) ||
    (!hasAdmissibleContextPrefix(prefix, input.isPredicateUnit) &&
      !(prefix.every((token) => !token.quoted) && matchesOneOf(prefix, DIRECT_ACTION_PREFIXES)))
  ) {
    return false;
  }
  const trustedRelationIndex = findTrustedDirectRelation({
    text: input.text,
    tokens: input.tokens,
    subjectIndex: input.subjectIndex,
    subjectKind: input.subjectKind,
    firstValueIndex,
    relationIndex: input.relationIndex,
    invertedAssertion: PROPERTY_ASSERTION_LINKERS.has(prefix.at(-1)?.lower ?? ''),
    predicate: input.predicate,
    value: input.value,
    valueStart: input.valueStart,
    valueEnd: input.valueEnd,
    isPredicateUnit: input.isPredicateUnit,
    isRelationUnit: input.isRelationUnit,
  });
  if (trustedRelationIndex?.relationIndex !== input.relationIndex) return false;
  if (
    !hasAdmissibleExactFactSourceSpan({
      text: input.text,
      valueStart: input.valueStart,
      valueEnd: input.valueEnd,
      allowLiteral: allowLiteralValue,
      structuredNumericKind:
        input.subjectKind === 'possessive'
          ? exactPropertyTargetStructuredNumericKind(
              input.tokens,
              input.subjectIndex,
              trustedRelationIndex.relationIndex,
            )
          : undefined,
    })
  ) {
    return false;
  }

  return hasExactDirectClaimSuffix({
    text: input.text,
    suffixBoundary: trustedRelationIndex.durableSuffixBoundary,
    clauseEnd: input.clauseEnd,
  });
}

export function hasAdmissibleCorrectionPrefix(input: {
  text: string;
  clauseStart: number;
  tokens: readonly ExactSelfClaimGrammarToken[];
  correctionIndex: number;
  isPredicateUnit: (value: string) => boolean;
}): boolean {
  const prefix = input.tokens.slice(0, input.correctionIndex);
  const substantive = prefix.filter(
    (token) => token.lower !== 'please' && token.lower !== 'actually',
  );
  return (
    prefix.every((token) => !token.quoted) &&
    hasAdmissibleRawPrefix({
      text: input.text,
      clauseStart: input.clauseStart,
      tokens: input.tokens,
      coreStart: input.correctionIndex,
    }) &&
    hasAdmissibleContextPrefix(substantive, input.isPredicateUnit)
  );
}
