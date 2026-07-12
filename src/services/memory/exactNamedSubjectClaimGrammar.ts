import {
  hasAdmissibleEvidenceRawTokenEnvelope,
  type ExactClaimTextToken,
} from './exactClaimEvidenceSupport';
import {
  isAdmissibleExactPropertyHead,
  isExactPropertyAssertionLinker,
} from './exactSelfClaimGrammar';
import {
  predicateCoversExactPropertyDescriptor,
  predicateHasOnlyExactNamedPropertySemantics,
} from './exactPropertyPredicateGrammar';
import {
  ALLOWED_NAMED_SUBJECT_RELATION_GAP,
  ATTRIBUTION_MARKERS,
  HYPOTHETICAL_MARKERS,
  NEGATION_MARKERS,
} from './exactSelfClaimLanguage';

function namedClaimHasUnsafeModifier(input: {
  tokens: readonly ExactClaimTextToken[];
  valueStart: number;
  valueEnd: number;
  allowLiteralValue: boolean;
}): boolean {
  for (const token of input.tokens) {
    if (token.quoted) continue;
    if (input.allowLiteralValue && token.start >= input.valueStart && token.end <= input.valueEnd) {
      continue;
    }
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

export function hasBoundNamedSubjectRelation(input: {
  text: string;
  tokens: readonly ExactClaimTextToken[];
  predicate: string;
  subject: string;
  subjectEnd: number;
  relationIndex: number;
  valueStart: number;
  valueEnd: number;
  allowLiteralValue: boolean;
  questionTerminated: boolean;
}): boolean {
  if (input.questionTerminated) return false;
  const relation = input.tokens[input.relationIndex]!;
  const relationUnits = Array.from(
    relation.value.normalize('NFKC').matchAll(/[\p{L}\p{M}\p{N}]+/gu),
    (match) => match[0].toLocaleLowerCase(),
  );
  const predicateLabelUnits = Array.from(
    input.predicate.normalize('NFKC').matchAll(/[\p{L}\p{M}\p{N}]+/gu),
    (match) => match[0].toLocaleLowerCase(),
  );
  const exactCompoundPredicateLabel =
    relationUnits.length >= 2 &&
    relationUnits.length === predicateLabelUnits.length &&
    relationUnits.every((unit, index) => unit === predicateLabelUnits[index]);
  if (
    relation.start < input.subjectEnd ||
    relation.end > input.valueStart ||
    (!isAdmissibleExactPropertyHead(relation) && !exactCompoundPredicateLabel)
  ) {
    return false;
  }
  const gap = input.tokens.filter(
    (token) => token.start >= input.subjectEnd && token.end <= relation.start && !token.quoted,
  );
  const valueGap = input.tokens.filter(
    (token) => token.start >= relation.end && token.end <= input.valueStart && !token.quoted,
  );
  const propertyDescriptors = gap.filter(
    (token) => !ALLOWED_NAMED_SUBJECT_RELATION_GAP.has(token.lower),
  );
  return (
    gap.length <= 3 &&
    propertyDescriptors.length <= 2 &&
    propertyDescriptors.every(
      (token) =>
        !token.quoted && predicateCoversExactPropertyDescriptor(input.predicate, token.value),
    ) &&
    predicateHasOnlyExactNamedPropertySemantics({
      predicate: input.predicate,
      subject: input.subject,
      target: [...propertyDescriptors, relation],
    }) &&
    (valueGap.length === 0 ||
      (valueGap.length === 1 && isExactPropertyAssertionLinker(valueGap[0]!.lower))) &&
    hasAdmissibleEvidenceRawTokenEnvelope({
      text: input.text,
      tokens: input.tokens,
      start: input.subjectEnd,
      end: relation.start,
    }) &&
    hasAdmissibleEvidenceRawTokenEnvelope({
      text: input.text,
      tokens: input.tokens,
      start: relation.end,
      end: input.valueStart,
      allowOpeningQuoteAtEnd: input.allowLiteralValue,
    }) &&
    !namedClaimHasUnsafeModifier({
      tokens: input.tokens,
      valueStart: input.valueStart,
      valueEnd: input.valueEnd,
      allowLiteralValue: input.allowLiteralValue,
    })
  );
}
