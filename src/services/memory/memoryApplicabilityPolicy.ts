import {
  closedMemoryFactClass,
  closedMemoryFactReviewState,
  closedMemoryFactSensitivity,
  closedMemorySourceAuthority,
} from './facts/applicabilityProvenance';
import { isMemoryFactScope, type MemoryFact } from './facts/types';
import { isExactMemoryScopeId, requireMemoryAccessScopeIdentity } from './memoryScopeIdentity';
import {
  MEMORY_APPLICABILITY_ACTIONS,
  MEMORY_APPLICABILITY_REASONS,
  MEMORY_EVIDENCE_SOURCE_KINDS,
  type MemoryApplicabilityAction,
  type MemoryApplicabilityContext,
  type MemoryApplicabilityReason,
  type MemoryApplicabilitySummary,
  type MemoryExternalEvidenceSignal,
  type MemoryFactApplicabilityDecision,
  type MemoryFactClass,
  type MemorySourceAuthority,
} from './memoryApplicabilityTypes';

export const MEMORY_APPLICABILITY_MIN_CONFIDENCE = 0.6;

export interface MemoryApplicabilityPolicyInput {
  facts: ReadonlyArray<MemoryFact>;
  context: MemoryApplicabilityContext;
}

export interface MemoryApplicabilityPolicyResult {
  factDecisions: MemoryFactApplicabilityDecision[];
  summary: MemoryApplicabilitySummary;
}

type FactBasis = Readonly<{
  factClass: MemoryFactClass;
  sourceAuthority: MemorySourceAuthority;
  factClassValid: boolean;
  sourceAuthorityValid: boolean;
}>;

type FactDecisionCore = Readonly<{
  action: MemoryApplicabilityAction;
  reason: MemoryApplicabilityReason;
}>;

function factBasis(fact: MemoryFact): FactBasis {
  const factClass = closedMemoryFactClass(fact.factClass);
  const sourceAuthority = closedMemorySourceAuthority(fact.sourceAuthority);
  return {
    factClass: factClass ?? 'unknown',
    sourceAuthority: sourceAuthority ?? 'unknown',
    factClassValid: factClass !== null,
    sourceAuthorityValid: sourceAuthority !== null,
  };
}

function hardFactGate(
  fact: MemoryFact,
  basis: FactBasis,
  context: MemoryApplicabilityContext,
): FactDecisionCore | null {
  if (!context.enabled) return { action: 'silent', reason: 'memory_disabled' };
  if (!Number.isSafeInteger(context.now) || context.now < 0) {
    return { action: 'silent', reason: 'not_yet_valid' };
  }
  if (fact.deletedAt !== null) return { action: 'silent', reason: 'deleted' };
  if (
    !Number.isSafeInteger(fact.validAt) ||
    fact.validAt < 0 ||
    !Number.isSafeInteger(fact.createdAt) ||
    fact.createdAt < 0 ||
    (fact.invalidAt !== null && (!Number.isSafeInteger(fact.invalidAt) || fact.invalidAt < 0)) ||
    (fact.expiresAt !== null && (!Number.isSafeInteger(fact.expiresAt) || fact.expiresAt < 0))
  ) {
    return { action: 'silent', reason: 'not_yet_valid' };
  }
  if (fact.validAt > context.now || fact.createdAt > context.now) {
    return { action: 'silent', reason: 'not_yet_valid' };
  }
  if (fact.invalidAt !== null && fact.invalidAt <= context.now) {
    return { action: 'silent', reason: 'invalidated' };
  }
  if (fact.expiresAt !== null && fact.expiresAt <= context.now) {
    return { action: 'silent', reason: 'expired' };
  }

  if (!basis.factClassValid || basis.factClass === 'unknown') {
    return { action: 'silent', reason: 'unknown_fact_class' };
  }
  if (!basis.sourceAuthorityValid || basis.sourceAuthority === 'unknown') {
    return { action: 'silent', reason: 'unknown_source_authority' };
  }
  if (!isMemoryFactScope(fact.scope)) {
    return { action: 'silent', reason: 'unknown_scope' };
  }
  if (!context.scope) return { action: 'silent', reason: 'scope_context_missing' };
  if (!isExactMemoryScopeId(fact.memoryOwnerId)) {
    return { action: 'silent', reason: 'owner_binding_missing' };
  }
  if (fact.memoryOwnerId !== context.scope.memoryOwnerId) {
    return { action: 'silent', reason: 'owner_mismatch' };
  }

  const memoryConversationId = context.scope.memoryConversationId;
  const sourceThreadId = context.scope.sourceThreadId;
  const taskId = context.scope.taskId;
  if (fact.scope === 'global') {
    return fact.personaId === null &&
      fact.originConversationId === null &&
      fact.originThreadId === null &&
      fact.originTaskId === null
      ? null
      : { action: 'silent', reason: 'scope_mismatch' };
  }
  if (fact.scope === 'persona') {
    const boundPersonaId = fact.personaId;
    const activePersonaId = context.scope.personaId;
    if (!isExactMemoryScopeId(boundPersonaId)) {
      return { action: 'silent', reason: 'persona_binding_missing' };
    }
    if (
      fact.originConversationId !== null ||
      fact.originThreadId !== null ||
      fact.originTaskId !== null
    ) {
      return { action: 'silent', reason: 'scope_mismatch' };
    }
    return boundPersonaId === activePersonaId
      ? null
      : { action: 'silent', reason: 'persona_mismatch' };
  }
  if (fact.personaId !== null) {
    return { action: 'silent', reason: 'scope_mismatch' };
  }
  if (!isExactMemoryScopeId(fact.originConversationId)) {
    return { action: 'silent', reason: 'scope_context_missing' };
  }
  if (fact.originConversationId !== memoryConversationId) {
    return { action: 'silent', reason: 'scope_mismatch' };
  }
  if (fact.scope === 'conversation' || fact.scope === 'project') {
    if (
      fact.originTaskId !== null ||
      (fact.originThreadId !== null && !isExactMemoryScopeId(fact.originThreadId))
    ) {
      return { action: 'silent', reason: 'scope_mismatch' };
    }
    return null;
  }

  if (!isExactMemoryScopeId(fact.originThreadId)) {
    return { action: 'silent', reason: 'scope_context_missing' };
  }
  if (fact.originThreadId !== sourceThreadId) {
    return { action: 'silent', reason: 'scope_mismatch' };
  }
  if (!isExactMemoryScopeId(fact.originTaskId) || taskId === null) {
    return { action: 'silent', reason: 'scope_context_missing' };
  }
  if (fact.originTaskId !== taskId) {
    return { action: 'silent', reason: 'scope_mismatch' };
  }
  return null;
}

function authorityFactGate(
  fact: MemoryFact,
  basis: FactBasis,
  context: MemoryApplicabilityContext,
): FactDecisionCore | null {
  if (basis.factClass === 'subjective_user' && basis.sourceAuthority !== 'grounded_user') {
    return {
      action: context.useIntent === 'automatic_prompt' ? 'silent' : 'ask',
      reason: 'subjective_authority_confirmation_required',
    };
  }
  if (
    basis.factClass === 'objective' &&
    basis.sourceAuthority !== 'grounded_user' &&
    basis.sourceAuthority !== 'tool_observed' &&
    basis.sourceAuthority !== 'external_source'
  ) {
    return { action: 'abstain', reason: 'objective_authority_insufficient' };
  }
  if (
    basis.factClass === 'workflow' &&
    basis.sourceAuthority === 'assistant_inferred' &&
    fact.reviewState !== 'verified'
  ) {
    return {
      action: context.useIntent === 'automatic_prompt' ? 'silent' : 'ask',
      reason: 'workflow_authority_confirmation_required',
    };
  }
  return null;
}

function silentFactGate(
  fact: MemoryFact,
  basis: FactBasis,
  context: MemoryApplicabilityContext,
): FactDecisionCore | null {
  const hardGate = hardFactGate(fact, basis, context);
  if (hardGate) return hardGate;
  const reviewState = closedMemoryFactReviewState(fact.reviewState);
  if (!reviewState) return { action: 'silent', reason: 'unknown_review_state' };
  if (reviewState === 'rejected') return { action: 'silent', reason: 'rejected_review' };
  const sensitivity = closedMemoryFactSensitivity(fact.sensitivity);
  if (!sensitivity) return { action: 'silent', reason: 'unknown_sensitivity' };
  if (sensitivity === 'restricted') {
    return { action: 'silent', reason: 'restricted_sensitivity' };
  }
  if (sensitivity === 'sensitive' && context.useIntent === 'automatic_prompt') {
    return { action: 'silent', reason: 'sensitive_proactive_suppressed' };
  }
  return authorityFactGate(fact, basis, context);
}

function factConflictKey(fact: MemoryFact): string {
  const scopeIdentity =
    fact.scope === 'global'
      ? 'global'
      : fact.scope === 'persona'
        ? `persona:${fact.personaId ?? 'unbound'}`
        : `${fact.scope}:${fact.originConversationId ?? ''}:${
            fact.scope === 'session' ? (fact.originThreadId ?? '') : ''
          }:${fact.scope === 'session' ? (fact.originTaskId ?? '') : ''}`;
  return `${scopeIdentity}\u0000${fact.subjectId}\u0000${fact.predicate
    .normalize('NFKC')
    .trim()
    .toLowerCase()}`;
}

function normalizedFactValue(fact: MemoryFact): string {
  return fact.objectText.normalize('NFKC').replace(/\s+/gu, ' ').trim();
}

function participatesInCurrentValueConflict(fact: MemoryFact): boolean {
  // Semantic facts describe the current value of a subject/predicate pair.
  // Experience records are additive events or observations; several distinct
  // runs, results, artifacts, and evidence spans are expected to coexist.
  return fact.memoryKind === 'semantic_fact';
}

function conflictingCurrentFacts(
  facts: ReadonlyArray<MemoryFact>,
  bases: ReadonlyMap<string, FactBasis>,
  context: MemoryApplicabilityContext,
): { conflicting: Set<string>; objective: Set<string> } {
  const groups = new Map<string, MemoryFact[]>();
  for (const fact of facts) {
    const basis = bases.get(fact.id)!;
    if (silentFactGate(fact, basis, context)) continue;
    if (!participatesInCurrentValueConflict(fact)) continue;
    const key = factConflictKey(fact);
    const group = groups.get(key) ?? [];
    group.push(fact);
    groups.set(key, group);
  }
  const conflicting = new Set<string>();
  const objective = new Set<string>();
  for (const group of groups.values()) {
    if (new Set(group.map(normalizedFactValue)).size <= 1) continue;
    const objectiveGroup = group.some((fact) => bases.get(fact.id)?.factClass === 'objective');
    for (const fact of group) {
      conflicting.add(fact.id);
      if (objectiveGroup) objective.add(fact.id);
    }
  }
  return { conflicting, objective };
}

function validExternalEvidence(
  signal: MemoryExternalEvidenceSignal,
  context: MemoryApplicabilityContext,
): boolean {
  const expectedAuthority =
    signal.sourceKind === 'user_message'
      ? 'grounded_user'
      : signal.sourceKind === 'tool_run'
        ? 'tool_observed'
        : signal.sourceKind === 'external_record'
          ? 'external_source'
          : null;
  return (
    isExactMemoryScopeId(signal.factId) &&
    isExactMemoryScopeId(signal.sourceId) &&
    (signal.relation === 'supports' || signal.relation === 'conflicts') &&
    closedMemoryFactClass(signal.factClass) !== null &&
    MEMORY_EVIDENCE_SOURCE_KINDS.includes(signal.sourceKind) &&
    signal.sourceAuthority === expectedAuthority &&
    Number.isSafeInteger(signal.observedAt) &&
    signal.observedAt >= 0 &&
    signal.observedAt <= context.now
  );
}

function externalEvidenceForFact(
  factId: string,
  context: MemoryApplicabilityContext,
): { invalid: boolean; conflicts: MemoryExternalEvidenceSignal[] } {
  const signals = (context.externalEvidence ?? []).filter((signal) => signal.factId === factId);
  return {
    invalid: signals.some((signal) => !validExternalEvidence(signal, context)),
    conflicts: signals.filter(
      (signal) => validExternalEvidence(signal, context) && signal.relation === 'conflicts',
    ),
  };
}

function hasExplicitStoredConflict(fact: MemoryFact): boolean {
  // Observation-derived timestamps are denormalized diagnostics and do not
  // carry their evidence row's created-at clock. Applicability therefore uses
  // the bi-temporal observation read above; only an explicit review decision
  // can establish a stored conflict independently of that read.
  return fact.reviewState === 'conflicted';
}

function decisionAfterHardGates(
  fact: MemoryFact,
  basis: FactBasis,
  context: MemoryApplicabilityContext,
  groupConflicts: ReturnType<typeof conflictingCurrentFacts>,
): FactDecisionCore {
  const reviewState = closedMemoryFactReviewState(fact.reviewState);
  if (!reviewState) return { action: 'silent', reason: 'unknown_review_state' };
  if (reviewState === 'rejected') return { action: 'silent', reason: 'rejected_review' };
  const sensitivity = closedMemoryFactSensitivity(fact.sensitivity);
  if (!sensitivity) return { action: 'silent', reason: 'unknown_sensitivity' };
  if (sensitivity === 'restricted') {
    return { action: 'silent', reason: 'restricted_sensitivity' };
  }
  if (sensitivity === 'sensitive' && context.useIntent === 'automatic_prompt') {
    return { action: 'silent', reason: 'sensitive_proactive_suppressed' };
  }
  if (context.conflictObservationReadState === 'failed') {
    return { action: 'abstain', reason: 'conflict_observation_read_failed' };
  }

  const external = externalEvidenceForFact(fact.id, context);
  if (external.invalid) return { action: 'abstain', reason: 'invalid_external_evidence' };
  if (external.conflicts.length > 0) {
    const objective =
      basis.factClass === 'objective' ||
      external.conflicts.some((signal) => signal.factClass === 'objective');
    return objective
      ? { action: 'abstain', reason: 'objective_external_conflict' }
      : { action: 'ask', reason: 'external_conflict_needs_clarification' };
  }
  if (groupConflicts.conflicting.has(fact.id)) {
    return groupConflicts.objective.has(fact.id)
      ? { action: 'abstain', reason: 'objective_current_conflict' }
      : { action: 'ask', reason: 'conflicting_current_memories' };
  }
  if (hasExplicitStoredConflict(fact)) {
    return basis.factClass === 'objective'
      ? { action: 'abstain', reason: 'objective_stored_conflict' }
      : { action: 'ask', reason: 'stored_conflict' };
  }
  if (reviewState === 'pending_review') return { action: 'ask', reason: 'pending_review' };
  if (reviewState === 'stale') return { action: 'ask', reason: 'stale_memory' };
  if (!Number.isFinite(fact.confidence) || fact.confidence < MEMORY_APPLICABILITY_MIN_CONFIDENCE) {
    return { action: 'ask', reason: 'low_confidence' };
  }
  if (
    sensitivity === 'sensitive' &&
    reviewState !== 'verified' &&
    basis.sourceAuthority !== 'grounded_user'
  ) {
    return { action: 'ask', reason: 'sensitive_confirmation_required' };
  }
  return { action: 'use', reason: 'eligible' };
}

function decideFact(
  fact: MemoryFact,
  basis: FactBasis,
  context: MemoryApplicabilityContext,
  groupConflicts: ReturnType<typeof conflictingCurrentFacts>,
): MemoryFactApplicabilityDecision {
  const decision =
    silentFactGate(fact, basis, context) ??
    decisionAfterHardGates(fact, basis, context, groupConflicts);
  return {
    factId: fact.id,
    factClass: basis.factClass,
    sourceAuthority: basis.sourceAuthority,
    ...decision,
  };
}

function buildSummary(
  context: MemoryApplicabilityContext,
  factDecisions: ReadonlyArray<MemoryFactApplicabilityDecision>,
): MemoryApplicabilitySummary {
  const factActions = Object.fromEntries(
    MEMORY_APPLICABILITY_ACTIONS.map((action) => [
      action,
      factDecisions.filter((decision) => decision.action === action).length,
    ]),
  ) as Record<MemoryApplicabilityAction, number>;
  return {
    state: !context.enabled
      ? 'disabled'
      : context.conflictObservationReadState === 'failed'
        ? 'degraded'
        : 'applied',
    candidateFactCount: factDecisions.length,
    promptVisibleFactCount: factDecisions.filter((decision) => decision.action !== 'silent').length,
    promptBudgetDroppedFactCount: 0,
    factActions,
    reasonCounts: MEMORY_APPLICABILITY_REASONS.map((reason) => ({
      reason,
      count: factDecisions.filter((decision) => decision.reason === reason).length,
    })),
  };
}

export function applyMemoryApplicabilityPolicy(
  input: MemoryApplicabilityPolicyInput,
): MemoryApplicabilityPolicyResult {
  let validatedScope = null;
  if (input.context.scope) {
    try {
      validatedScope = requireMemoryAccessScopeIdentity(input.context.scope);
    } catch {
      validatedScope = null;
    }
  }
  const context: MemoryApplicabilityContext = {
    ...input.context,
    scope: validatedScope,
  };
  const bases = new Map(input.facts.map((fact) => [fact.id, factBasis(fact)] as const));
  const groupConflicts = conflictingCurrentFacts(input.facts, bases, context);
  const factDecisions = input.facts.map((fact) =>
    decideFact(fact, bases.get(fact.id)!, context, groupConflicts),
  );
  return {
    factDecisions,
    summary: buildSummary(context, factDecisions),
  };
}

export function emptyMemoryApplicabilitySummary(
  state: MemoryApplicabilitySummary['state'],
): MemoryApplicabilitySummary {
  return buildSummary(
    {
      enabled: state !== 'disabled',
      now: 0,
      useIntent: 'automatic_prompt',
      scope: null,
      conflictObservationReadState: state === 'degraded' ? 'failed' : 'available',
    },
    [],
  );
}
