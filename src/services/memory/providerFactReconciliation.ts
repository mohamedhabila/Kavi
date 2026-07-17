import type {
  ConsolidatorFact,
  ConsolidatorResult,
  ProviderConsolidatorResult,
} from './consolidator';
import type { StructuralExtraction } from './deterministicExtractor';
import { resolveCurrentFactsForReplacement } from './facts/currentReplacementResolution';
import { evaluateGroundedReplacement } from './groundedFactReplacement';
import { CANONICAL_SELF_MEMORY_SUBJECT } from './memorySubjectIdentity';
import type { SemanticFactProposalV1 } from './semanticFactProposal';
import { providerMemorySensitivityDeclaration } from './memorySensitivityPolicy';

export interface ProviderMergeContext {
  currentUserMessageId?: string;
  currentUserMessage: string;
  memoryConversationId: string;
  threadId: string;
  taskId?: string;
  sameSourceExplicitMemoryAuthority: boolean;
}

interface ResolvedProviderFact {
  proposal: SemanticFactProposalV1;
  fact: ConsolidatorFact;
}

/** Bind provider semantics to exact, code-owned current-user evidence. */
function bindExactProposalEvidence(
  proposal: SemanticFactProposalV1,
  context: ProviderMergeContext,
): ConsolidatorFact | null {
  if (proposal.assertionClass !== 'current_direct') return null;
  if (!context.currentUserMessageId || proposal.sourceMessageId !== context.currentUserMessageId) {
    return null;
  }
  if (!context.currentUserMessage.includes(proposal.evidenceQuote)) return null;
  if (!proposal.evidenceQuote.includes(proposal.value)) return null;
  if (
    proposal.subjectRef.kind === 'named' &&
    !proposal.evidenceQuote.includes(proposal.subjectRef.label)
  ) {
    return null;
  }

  return {
    subject:
      proposal.subjectRef.kind === 'self'
        ? CANONICAL_SELF_MEMORY_SUBJECT
        : proposal.subjectRef.label,
    predicate: proposal.predicate,
    value: proposal.value,
    scope: proposal.scope,
    importance: proposal.importance,
    confidence: proposal.confidence,
    sensitivityDeclaration: providerMemorySensitivityDeclaration(proposal.sensitivity),
    operation: 'replace_current',
    assertionClass: 'current_direct',
    evidenceMessageIds: [context.currentUserMessageId],
    evidenceQuote: proposal.evidenceQuote,
  };
}

function resolveProviderFact(
  proposal: SemanticFactProposalV1,
  context: ProviderMergeContext,
): ResolvedProviderFact | null {
  const fact = bindExactProposalEvidence(proposal, context);
  if (!fact) return null;

  const resolution = resolveCurrentFactsForReplacement(
    { subject: fact.subject, predicate: fact.predicate, scope: proposal.scope },
    {
      memoryConversationId: context.memoryConversationId,
      sourceThreadId: context.threadId,
      taskId: context.taskId,
    },
  );
  const decision = evaluateGroundedReplacement(fact, {
    ...context,
    currentFacts: resolution.currentFacts,
    hasAnyCurrentFact: resolution.hasAnyCurrentFact,
  });
  if (!decision.accepted) return null;
  if (proposal.operation === 'record' && decision.operation !== 'insert') return null;
  if (proposal.operation === 'replace_current' && decision.operation !== 'replace_current') {
    return null;
  }
  return { proposal, fact: decision.fact };
}

function factKey(fact: ConsolidatorFact): string {
  return JSON.stringify([fact.subject, fact.predicate, fact.value]);
}

function subjectPredicateKey(fact: ConsolidatorFact): string {
  return JSON.stringify([fact.subject, fact.predicate]);
}

function ambiguousReplacementKeys(facts: readonly ResolvedProviderFact[]): Set<string> {
  const groups = new Map<string, ResolvedProviderFact[]>();
  for (const resolved of facts) {
    const key = subjectPredicateKey(resolved.fact);
    const group = groups.get(key) ?? [];
    group.push(resolved);
    groups.set(key, group);
  }

  const ambiguous = new Set<string>();
  for (const [key, group] of groups) {
    if (!group.some(({ proposal }) => proposal.operation === 'replace_current')) continue;
    const signatures = new Set(
      group.map(({ proposal }) =>
        JSON.stringify([proposal.value, proposal.scope, proposal.operation]),
      ),
    );
    if (signatures.size > 1) ambiguous.add(key);
  }
  return ambiguous;
}

export function mergeProviderIntoStructural(
  structural: StructuralExtraction,
  provider: ProviderConsolidatorResult,
  context: ProviderMergeContext,
): ConsolidatorResult {
  const episodeSummary = provider.episodeSummary ?? structural.episodeSummary;
  const seen = new Set(structural.facts.map(factKey));
  const structuralSubjectsAndPredicates = new Set(structural.facts.map(subjectPredicateKey));
  const resolvedProviderFacts = context.sameSourceExplicitMemoryAuthority
    ? []
    : provider.newFacts.flatMap((proposal) => {
        const resolved = resolveProviderFact(proposal, context);
        return resolved ? [resolved] : [];
      });
  const ambiguous = ambiguousReplacementKeys(resolvedProviderFacts);
  const mergedFacts = [...structural.facts];

  for (const { fact } of resolvedProviderFacts) {
    const key = factKey(fact);
    const currentKey = subjectPredicateKey(fact);
    if (structuralSubjectsAndPredicates.has(currentKey) || ambiguous.has(currentKey)) continue;
    if (seen.has(key)) continue;
    mergedFacts.push(fact);
    seen.add(key);
  }

  return {
    episodeSummary: episodeSummary || null,
    episodeSensitivityDeclaration: providerMemorySensitivityDeclaration(
      provider.episodeSensitivity,
    ),
    newFacts: mergedFacts,
    activeFocus: provider.activeFocus,
    openThreads: provider.openThreads.slice(0, 5),
    notable: provider.notable,
  };
}
