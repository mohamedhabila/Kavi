import type { ConsolidatorResult } from './consolidator';
import type { StructuralExtraction } from './deterministicExtractor';
import {
  resolveCurrentFactsForReplacement,
  resolvePriorUserSelfCorrectionFacts,
  type CurrentReplacementResolution,
} from './facts/currentReplacementResolution';
import { evaluateGroundedReplacement } from './groundedFactReplacement';
import {
  deriveExactNamedSubjectClaimEvidence,
  deriveExactSelfClaimEvidence,
  deriveExactSelfCorrectionEvidence,
} from './exactSelfClaimEvidence';
import { isCanonicalSelfMemorySubject } from './memorySubjectIdentity';

export interface ProviderMergeContext {
  currentUserMessageId?: string;
  currentUserMessage: string;
  priorUserMessageId?: string;
  memoryConversationId: string;
  threadId: string;
  taskId?: string;
}

type ProviderFact = ConsolidatorResult['newFacts'][number];

interface ResolvedProviderFact {
  fact: ProviderFact;
  resolution: CurrentReplacementResolution;
}

function admitInitialGroundedSelfInsert(
  fact: ProviderFact,
  resolution: CurrentReplacementResolution,
  context: ProviderMergeContext,
): ProviderFact | null {
  if (!isCanonicalSelfMemorySubject(fact.subject) || resolution.hasAnyCurrentFact) {
    return fact;
  }
  const decision = evaluateGroundedReplacement(
    { ...fact, operation: 'replace_current' },
    {
      ...context,
      currentFacts: resolution.currentFacts,
      hasAnyCurrentFact: resolution.hasAnyCurrentFact,
    },
  );
  return decision.accepted && decision.operation === 'insert' ? decision.fact : null;
}

function withEvidenceQuote(fact: ProviderFact, evidenceQuote: string): ProviderFact {
  return {
    ...fact,
    assertionClass: 'current_direct',
    evidenceQuote,
  };
}

function resolveDirectProviderFact(
  fact: ProviderFact,
  context: ProviderMergeContext,
): ProviderFact | null {
  const evidence = isCanonicalSelfMemorySubject(fact.subject)
    ? deriveExactSelfClaimEvidence({
        userMessageText: context.currentUserMessage,
        predicate: fact.predicate,
        value: fact.value,
      })
    : deriveExactNamedSubjectClaimEvidence({
        userMessageText: context.currentUserMessage,
        subject: fact.subject,
        predicate: fact.predicate,
        value: fact.value,
      });
  return evidence ? withEvidenceQuote(fact, evidence.evidenceQuote) : null;
}

/** Resolve provider semantics only through exact user evidence and code-owned identity. */
function resolveProviderFact(
  fact: ProviderFact,
  context: ProviderMergeContext,
): ResolvedProviderFact | null {
  const scope = fact.scope ?? 'conversation';
  const resolutionContext = {
    memoryConversationId: context.memoryConversationId,
    sourceThreadId: context.threadId,
    taskId: context.taskId,
  };
  const resolution = resolveCurrentFactsForReplacement(
    { subject: fact.subject, predicate: fact.predicate, scope },
    resolutionContext,
  );
  const directFact = resolveDirectProviderFact(fact, context);
  const groundedDirectFact =
    directFact && context.currentUserMessageId
      ? { ...directFact, evidenceMessageIds: [context.currentUserMessageId] }
      : directFact;

  if (fact.operation !== 'replace_current' || !isCanonicalSelfMemorySubject(fact.subject)) {
    if (!groundedDirectFact) return null;
    const admittedFact =
      fact.operation === 'replace_current'
        ? groundedDirectFact
        : admitInitialGroundedSelfInsert(groundedDirectFact, resolution, context);
    return admittedFact ? { fact: admittedFact, resolution } : null;
  }

  if (resolution.currentFacts.length === 1) {
    const correction = deriveExactSelfCorrectionEvidence({
      userMessageText: context.currentUserMessage,
      predicate: fact.predicate,
      value: fact.value,
      currentValue: resolution.currentFacts[0]!.objectText,
    });
    if (correction?.correctionTarget === 'direct_property') {
      return {
        fact: withEvidenceQuote(fact, correction.evidenceQuote),
        resolution,
      };
    }
  }
  if (groundedDirectFact) return { fact: groundedDirectFact, resolution };
  if (!context.priorUserMessageId) return null;

  const corrections = resolvePriorUserSelfCorrectionFacts(
    {
      subject: fact.subject,
      sourceMessageId: context.priorUserMessageId,
      scope,
    },
    resolutionContext,
  ).flatMap((target) => {
    const evidence = deriveExactSelfCorrectionEvidence({
      userMessageText: context.currentUserMessage,
      predicate: target.predicate,
      value: fact.value,
      currentValue: target.objectText,
    });
    return evidence ? [{ evidence, target }] : [];
  });
  if (corrections.length !== 1) return null;

  const correction = corrections[0]!;
  return {
    fact: {
      ...fact,
      predicate: correction.target.predicate,
      evidenceQuote: correction.evidence.evidenceQuote,
    },
    resolution: { currentFacts: [correction.target], hasAnyCurrentFact: true },
  };
}

export function mergeProviderIntoStructural(
  structural: StructuralExtraction,
  provider: ConsolidatorResult,
  context: ProviderMergeContext,
): ConsolidatorResult {
  const episodeSummary = provider.episodeSummary ?? structural.episodeSummary;
  const keyPart = (value: string) => value.normalize('NFKC').trim().toLowerCase();
  const factKey = (fact: ProviderFact) =>
    `${keyPart(fact.subject)}:${keyPart(fact.predicate)}:${keyPart(fact.value)}`;
  const subjectPredicateKey = (fact: ProviderFact) =>
    `${keyPart(fact.subject)}:${keyPart(fact.predicate)}`;
  const seen = new Set(structural.facts.map(factKey));
  const structuralSubjectsAndPredicates = new Set(structural.facts.map(subjectPredicateKey));
  const providerFacts = provider.newFacts.flatMap((fact) => {
    const resolved = resolveProviderFact(fact, context);
    return resolved ? [resolved] : [];
  });
  const replacementGroups = new Map<string, ProviderFact[]>();
  for (const { fact } of providerFacts) {
    const groupKey = subjectPredicateKey(fact);
    const group = replacementGroups.get(groupKey) ?? [];
    group.push(fact);
    replacementGroups.set(groupKey, group);
  }
  const ambiguousReplacementKeys = new Set<string>();
  for (const [groupKey, facts] of replacementGroups) {
    if (!facts.some((fact) => fact.operation === 'replace_current')) continue;
    const signatures = new Set(
      facts.map((fact) =>
        JSON.stringify([
          fact.value.normalize('NFKC').trim(),
          fact.scope ?? 'conversation',
          fact.operation ?? 'insert',
        ]),
      ),
    );
    if (signatures.size > 1) ambiguousReplacementKeys.add(groupKey);
  }
  const mergedFacts = [...structural.facts];
  for (const { fact, resolution } of providerFacts) {
    const key = factKey(fact);
    const currentKey = subjectPredicateKey(fact);
    if (
      structuralSubjectsAndPredicates.has(currentKey) ||
      ambiguousReplacementKeys.has(currentKey)
    ) {
      continue;
    }
    if (seen.has(key)) continue;

    if (!resolution.hasAnyCurrentFact && fact.operation !== 'replace_current') {
      mergedFacts.push(fact);
      seen.add(key);
      continue;
    }

    const decision = evaluateGroundedReplacement(fact, {
      ...context,
      currentFacts: resolution.currentFacts,
      hasAnyCurrentFact: resolution.hasAnyCurrentFact,
    });
    if (!decision.accepted) continue;
    mergedFacts.push(decision.fact);
    seen.add(key);
  }
  return {
    episodeSummary: episodeSummary || null,
    newFacts: mergedFacts,
    activeFocus: provider.activeFocus,
    openThreads: provider.openThreads.slice(0, 5),
    notable: provider.notable ?? [],
  };
}
