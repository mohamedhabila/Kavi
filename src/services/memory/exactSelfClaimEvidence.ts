import {
  ANAPHORIC_CORRECTION_TARGETS,
  CORRECTION_ACTION_MARKERS,
  CORRECTION_MARKERS,
  hasAdmissibleDurableCorrection,
  hasAdmissiblePriorAnchorSuffix,
  hasCompatibleNumericAnchorUnits,
  hasDistinguishingCorrectionTarget,
  hasTrailingCorrectionContent,
  hasUnsafeSelfClaimQualifier,
} from './exactSelfCorrectionStructure';
import {
  evidenceClauseRange as clauseRange,
  evidenceMorphologicalForms as morphologicalForms,
  evidencePredicateUnits as predicateUnits,
  evidenceQuoteMask as quoteMask,
  evidenceRangeIsUnquoted as rangeIsUnquoted,
  evidenceRelationForms as relationForms,
  evidenceTokensForClause as tokensForClause,
  exactEvidenceOccurrences as exactOccurrences,
  hasAdmissibleEvidenceRawTokenEnvelope as hasAdmissibleRawTokenEnvelope,
  isEvidenceRelationToken as isRelationToken,
  isQuestionTerminated,
  normalizeEvidenceText as normalizeText,
  type ExactClaimTextToken as TextToken,
} from './exactClaimEvidenceSupport';
import {
  hasAdmissibleCorrectionPrefix,
  hasAdmissibleDirectSelfClaimShape,
  hasAdmissibleExactSelfFactValue,
  exactPropertyHeadStructuredNumericKind,
  isLiteralFactUnit,
  looksLikeTitleCaseLiteral,
  matchAdmissibleCorrectionActionToValueSpan,
  type ExactSelfClaimSubjectKind,
} from './exactSelfClaimGrammar';
import {
  exactCompactAgeValueOccurrences,
  isExactAgeImplicitSelfRelation,
  splitExactCompactAgeTokens,
} from './exactAgePhraseGrammar';
import {
  isTrustedSelfRelationContraction,
  isTrustedSelfRelationSurface,
} from './exactSelfRelationGrammar';
import { hasAdmissibleExactFactSourceSpan } from './exactFactValueSource';
import { hasUnambiguousExactCommonSelfPredicate } from './exactCommonSelfFactValues';
import {
  ALLOWED_POSSESSIVE_RELATION_GAP,
  ALLOWED_SELF_RELATION_GAP,
  ATTRIBUTION_MARKERS,
  HYPOTHETICAL_MARKERS,
  NEGATION_MARKERS,
  OBJECT_SELF_MARKERS,
  POSSESSIVE_SELF_MARKERS,
  RESET_MARKERS,
  SUBJECT_SELF_MARKERS,
} from './exactSelfClaimLanguage';
import { hasBoundNamedSubjectRelation } from './exactNamedSubjectClaimGrammar';

export interface ExactSelfClaimEvidence {
  subject: 'user';
  predicate: string;
  value: string;
  evidenceQuote: string;
}

export interface ExactSelfCorrectionEvidence extends ExactSelfClaimEvidence {
  correctionTarget: 'anaphoric' | 'direct_property';
}

export interface ExactNamedSubjectClaimEvidence {
  subject: string;
  predicate: string;
  value: string;
  evidenceQuote: string;
}

const NON_LITERAL_STATE_PREDICATE_UNITS = new Set(
  'active complete completed inactive open ready state status'.split(' '),
);
const VALUE_TOKEN_PATTERN = /[\p{L}\p{M}\p{N}_+-]+(?:['’][\p{L}\p{M}\p{N}_+-]+)*/gu;

function predicateAllowsLiteralTarget(units: ReadonlySet<string>): boolean {
  return !Array.from(units).some((unit) => NON_LITERAL_STATE_PREDICATE_UNITS.has(unit));
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

interface BoundSelfRelation {
  subjectIndex: number;
  subjectKind: ExactSelfClaimSubjectKind;
}

function findBoundSelfRelation(
  tokens: readonly TextToken[],
  relationIndex: number,
  valueStart: number,
  predicateForms: ReadonlySet<string>,
): BoundSelfRelation | null {
  const relation = tokens[relationIndex]!;
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]!;
    if (token.quoted) continue;
    const lower = token.lower;
    if (SUBJECT_SELF_MARKERS.has(lower) || lower === 'user') {
      if (
        ((index === relationIndex && isTrustedSelfRelationContraction(lower)) ||
          (index < relationIndex &&
            gapAllowed(tokens, index, relationIndex, ALLOWED_SELF_RELATION_GAP))) &&
        !hasUnsafeModifier(tokens, index, relationIndex, valueStart)
      ) {
        return { subjectIndex: index, subjectKind: 'self' };
      }
    }
    if (
      index === relationIndex &&
      isExactAgeImplicitSelfRelation(lower) &&
      !hasUnsafeModifier(tokens, index, relationIndex, valueStart)
    ) {
      return { subjectIndex: index, subjectKind: 'self' };
    }
    if (POSSESSIVE_SELF_MARKERS.has(lower)) {
      const gap = tokens.slice(index + 1, relationIndex).filter((entry) => !entry.quoted);
      if (
        index < relationIndex &&
        gap.length <= 4 &&
        gap.every(
          (entry) =>
            ALLOWED_POSSESSIVE_RELATION_GAP.has(entry.lower) ||
            Array.from(predicateUnits(entry.value)).some((form) => predicateForms.has(form)),
        ) &&
        !hasUnsafeModifier(tokens, index, relationIndex, valueStart)
      ) {
        return { subjectIndex: index, subjectKind: 'possessive' };
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
        return { subjectIndex: index, subjectKind: 'object' };
      }
    }
  }
  return null;
}

function closingLiteralQuoteEnd(text: string, valueEnd: number, valueIsQuoted: boolean): number {
  return valueIsQuoted && /^["'”’»›」』]$/u.test(text[valueEnd] ?? '') ? valueEnd + 1 : valueEnd;
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
  if (!text || !predicate || !value || !hasUnambiguousExactCommonSelfPredicate(predicate)) {
    return null;
  }
  const predicateForms = predicateUnits(predicate);
  if (predicateForms.size === 0) return null;
  const allowedRelationForms = relationForms(predicateForms);
  const mask = quoteMask(text);

  const valueOccurrences = Array.from(
    new Set([...exactOccurrences(text, value), ...exactCompactAgeValueOccurrences(text, value)]),
  ).sort((left, right) => left - right);
  for (const valueStart of valueOccurrences) {
    const valueEnd = valueStart + value.length;
    const range = clauseRange(text, valueStart, valueEnd);
    if (isQuestionTerminated(text, range)) continue;
    const tokens = splitExactCompactAgeTokens({
      text,
      tokens: tokensForClause(text, range.start, range.end, mask),
      value,
      valueStart,
      valueEnd,
    });
    if (
      hasUnsafeSelfClaimQualifier({
        tokens,
        lowerText: text.slice(range.start, range.end).toLocaleLowerCase(),
        valueStart,
        valueEnd: valueStart + value.length,
        isAttribution: (candidate) => ATTRIBUTION_MARKERS.has(candidate),
        isHypothetical: (candidate) => HYPOTHETICAL_MARKERS.has(candidate),
      })
    ) {
      continue;
    }
    for (let relationIndex = 0; relationIndex < tokens.length; relationIndex += 1) {
      if (
        !isRelationToken(tokens[relationIndex]!, allowedRelationForms) &&
        !isTrustedSelfRelationSurface(tokens[relationIndex]!.lower)
      ) {
        continue;
      }
      const binding = findBoundSelfRelation(tokens, relationIndex, valueStart, predicateForms);
      if (!binding) continue;
      if (
        !hasAdmissibleDirectSelfClaimShape({
          text,
          predicate,
          value,
          clauseStart: range.start,
          clauseEnd: range.end,
          tokens,
          subjectIndex: binding.subjectIndex,
          subjectKind: binding.subjectKind,
          relationIndex,
          valueStart,
          valueEnd: valueStart + value.length,
          allowLiteralTarget: predicateAllowsLiteralTarget(predicateForms),
          isPredicateUnit: (candidate) =>
            Array.from(predicateUnits(candidate)).some((form) => allowedRelationForms.has(form)),
          isRelationUnit: (candidate) =>
            Array.from(morphologicalForms(candidate)).some((form) =>
              allowedRelationForms.has(form),
            ),
        })
      ) {
        continue;
      }
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

/** Admit only a durable, target-bound correction with an old-value anchor. */
export function deriveExactSelfCorrectionEvidence(input: {
  userMessageText: string;
  predicate: string;
  value: string;
  currentValue: string;
}): ExactSelfCorrectionEvidence | null {
  const text = normalizeText(input.userMessageText);
  const predicate = normalizeText(input.predicate);
  const value = normalizeText(input.value);
  const currentValue = normalizeText(input.currentValue);
  if (!text || !predicate || !value || !currentValue || value === currentValue) {
    return null;
  }
  if (!hasUnambiguousExactCommonSelfPredicate(predicate)) return null;
  const predicateForms = predicateUnits(predicate);
  if (predicateForms.size === 0) return null;
  const correctionRelationForms = relationForms(predicateForms);
  const mask = quoteMask(text);
  const currentTokens = Array.from(currentValue.matchAll(VALUE_TOKEN_PATTERN), (match) =>
    match[0].toLocaleLowerCase(),
  );
  if (currentTokens.length === 0) return null;

  for (const valueStart of exactOccurrences(text, value)) {
    const valueEnd = valueStart + value.length;
    const range = clauseRange(text, valueStart, valueEnd);
    if (isQuestionTerminated(text, range)) continue;
    if (hasTrailingCorrectionContent(text, range.end)) continue;
    const tokens = tokensForClause(text, range.start, range.end, mask);
    const valueMask = mask.slice(valueStart, valueEnd);
    const valueIsUnquoted = !valueMask.some(Boolean);
    const valueIsQuoted = valueMask.length > 0 && valueMask.every(Boolean);
    if (!valueIsUnquoted && !valueIsQuoted) continue;
    const valueTokenIndexes = tokens.flatMap((token, index) =>
      token.start >= valueStart && token.end <= valueEnd ? [index] : [],
    );
    const valueTokenIndex = valueTokenIndexes[0] ?? -1;
    const valueTokenEndIndex = valueTokenIndexes.at(-1) ?? -1;
    if (valueTokenIndex < 0) continue;
    if (
      hasUnsafeSelfClaimQualifier({
        tokens,
        lowerText: text.slice(range.start, range.end).toLocaleLowerCase(),
        valueStart,
        valueEnd,
        isAttribution: (candidate) => ATTRIBUTION_MARKERS.has(candidate),
        isHypothetical: (candidate) => HYPOTHETICAL_MARKERS.has(candidate),
      }) ||
      tokens
        .slice(0, valueTokenIndex)
        .some((token) => !token.quoted && NEGATION_MARKERS.has(token.lower))
    ) {
      continue;
    }

    const correctionIndexes = tokens.flatMap((token, index) =>
      !token.quoted && token.end <= valueStart && CORRECTION_MARKERS.has(token.lower)
        ? [index]
        : [],
    );
    const correctionMatches = correctionIndexes.flatMap((correctionIndex) => {
      const span = matchAdmissibleCorrectionActionToValueSpan({
        text,
        predicate,
        tokens,
        correctionIndex,
        valueStart,
        valueIsQuoted,
        valueLooksLikeTitle: looksLikeTitleCaseLiteral(value),
        allowLiteralTarget: predicateAllowsLiteralTarget(predicateForms),
        isCorrectionAction: (candidate) => CORRECTION_ACTION_MARKERS.has(candidate),
        isAnaphoricTarget: (candidate) => ANAPHORIC_CORRECTION_TARGETS.has(candidate),
        isPredicateUnit: (candidate) =>
          Array.from(predicateUnits(candidate)).some((form) => correctionRelationForms.has(form)),
      });
      if (!span) return [];
      if (
        span.kind === 'direct_property' &&
        !hasDistinguishingCorrectionTarget({
          tokens,
          predicate,
          correctionIndex,
          valueStart,
          isPredicateRelation: (index) => isRelationToken(tokens[index]!, predicateForms),
          isBoundPredicateRelation: (index) =>
            findBoundSelfRelation(tokens, index, valueStart, predicateForms) !== null,
        })
      ) {
        return [];
      }
      if (
        !hasAdmissibleCorrectionPrefix({
          text,
          clauseStart: range.start,
          tokens,
          correctionIndex,
          isPredicateUnit: (candidate) =>
            Array.from(predicateUnits(candidate)).some((form) => predicateForms.has(form)),
        })
      ) {
        return [];
      }
      return [{ correctionIndex, span }];
    });
    if (correctionMatches.length !== 1) continue;
    const [{ span }] = correctionMatches;
    const allowLiteralValue = span.allowLiteralValue;
    if (
      (!valueIsUnquoted && !allowLiteralValue) ||
      !hasAdmissibleExactSelfFactValue(value, { allowLiteral: allowLiteralValue }) ||
      !hasAdmissibleExactFactSourceSpan({
        text,
        valueStart,
        valueEnd,
        allowLiteral: allowLiteralValue,
        structuredNumericKind: span.structuredNumericKind,
      })
    ) {
      continue;
    }
    let priorAnchorStart = -1;
    let priorAnchorEnd = -1;
    exactOccurrences(text, currentValue).some((priorStart) => {
      const priorEnd = priorStart + currentValue.length;
      if (
        priorStart < valueEnd ||
        priorStart < range.start ||
        priorEnd > range.end ||
        !rangeIsUnquoted(mask, priorStart, priorEnd) ||
        !hasAdmissibleExactFactSourceSpan({
          text,
          valueStart: priorStart,
          valueEnd: priorEnd,
          structuredNumericKind: span.structuredNumericKind,
        })
      ) {
        return false;
      }
      const priorTokenIndexes = tokens.flatMap((token, index) =>
        token.start >= priorStart && token.end <= priorEnd && !token.quoted ? [index] : [],
      );
      const priorTokenIndex = priorTokenIndexes[0] ?? -1;
      const priorTokenEndIndex = priorTokenIndexes.at(-1) ?? -1;
      const negated =
        priorTokenIndex > valueTokenEndIndex &&
        tokens
          .slice(Math.max(valueTokenEndIndex + 1, priorTokenIndex - 3), priorTokenIndex)
          .some((token) => !token.quoted && NEGATION_MARKERS.has(token.lower)) &&
        hasAdmissiblePriorAnchorSuffix(tokens, priorTokenEndIndex);
      if (negated) {
        priorAnchorStart = priorStart;
        priorAnchorEnd = priorEnd;
      }
      return negated;
    });
    if (priorAnchorStart < 0) {
      if (!hasCompatibleNumericAnchorUnits(currentValue, value)) continue;
      const numericAnchors = currentTokens.filter((token) =>
        /^[+-]?\p{N}+(?:[.,]\p{N}+)?$/u.test(token),
      );
      if (numericAnchors.length !== 1) continue;
      const partialAnchorIndex = tokens.findIndex(
        (token, index) =>
          index > valueTokenEndIndex &&
          !token.quoted &&
          token.lower === numericAnchors[0] &&
          tokens
            .slice(Math.max(valueTokenEndIndex + 1, index - 3), index)
            .some((candidate) => !candidate.quoted && NEGATION_MARKERS.has(candidate.lower)) &&
          hasAdmissiblePriorAnchorSuffix(tokens, index),
      );
      if (partialAnchorIndex < 0) continue;
      priorAnchorStart = tokens[partialAnchorIndex]!.start;
      priorAnchorEnd = tokens[partialAnchorIndex]!.end;
      if (
        !hasAdmissibleExactFactSourceSpan({
          text,
          valueStart: priorAnchorStart,
          valueEnd: priorAnchorEnd,
          structuredNumericKind: span.structuredNumericKind,
        })
      ) {
        continue;
      }
    }
    if (
      priorAnchorEnd < priorAnchorStart ||
      !hasAdmissibleRawTokenEnvelope({
        text,
        tokens,
        start: closingLiteralQuoteEnd(text, valueEnd, allowLiteralValue && valueIsQuoted),
        end: priorAnchorStart,
        allowCommaOrColon: true,
      }) ||
      !hasAdmissibleRawTokenEnvelope({
        text,
        tokens,
        start: priorAnchorEnd,
        end: range.end,
        allowCommaOrColon: true,
      }) ||
      !hasAdmissibleDurableCorrection({
        text,
        tokens,
        intentStart: range.start,
        valueStart,
        valueEnd,
        priorAnchorStart,
        isNegation: (candidate) => NEGATION_MARKERS.has(candidate),
      })
    ) {
      continue;
    }

    return {
      subject: 'user',
      predicate,
      value,
      evidenceQuote: text.slice(range.start, range.end).trim(),
      correctionTarget: span.kind,
    };
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
  if (
    !text ||
    !subject ||
    !predicate ||
    !value ||
    !hasUnambiguousExactCommonSelfPredicate(predicate)
  ) {
    return null;
  }
  const predicateForms = predicateUnits(predicate);
  if (predicateForms.size === 0) return null;
  const allowedRelationForms = relationForms(predicateForms);
  const mask = quoteMask(text);

  for (const valueStart of exactOccurrences(text, value)) {
    const valueEnd = valueStart + value.length;
    const valueMask = mask.slice(valueStart, valueEnd);
    const valueIsUnquoted = !valueMask.some(Boolean);
    const valueIsQuoted = valueMask.length > 0 && valueMask.every(Boolean);
    if (!valueIsUnquoted && !valueIsQuoted) continue;
    const range = clauseRange(text, valueStart, valueEnd);
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
        const allowLiteralValue =
          predicateAllowsLiteralTarget(predicateForms) &&
          isLiteralFactUnit(tokens[relationIndex]!.lower) &&
          (valueIsQuoted || valueIsUnquoted);
        const trailing = text.slice(valueEnd, range.end);
        if (
          (!valueIsUnquoted && !allowLiteralValue) ||
          !hasAdmissibleExactSelfFactValue(value, { allowLiteral: allowLiteralValue }) ||
          !hasAdmissibleExactFactSourceSpan({
            text,
            valueStart,
            valueEnd,
            allowLiteral: allowLiteralValue,
            structuredNumericKind: exactPropertyHeadStructuredNumericKind(tokens[relationIndex]!),
          }) ||
          !(valueIsQuoted ? /^[\s"'”’»›」』]*$/u.test(trailing) : /^\s*$/u.test(trailing))
        ) {
          continue;
        }
        if (
          !hasBoundNamedSubjectRelation({
            text,
            tokens,
            predicate,
            subject,
            subjectEnd,
            relationIndex,
            valueStart,
            valueEnd,
            allowLiteralValue,
            questionTerminated: isQuestionTerminated(text, range),
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
