import type { MemoryFact, MemoryFactKind } from '../facts/types';
import { parseJsonRecord } from '../factJson';

const SOURCE_RUN_SUPPORT_CONTEXTS_PER_RUN = 3;
const SOURCE_RUN_SUPPORT_MAX_SLOTS = 3;
const WORKFLOW_REPRESENTATIVE_MIN_SCORE_RATIO = 0.75;

export interface ScoredSelectionFact {
  fact: MemoryFact;
  score: number;
  textScore: number;
  relevanceScore: number;
}

function scalarString(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === 'string' && value.trim().length > 0) return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  return '';
}

function factStateIndex(fact: MemoryFact): string | number | null {
  const parsed = parseJsonRecord(fact.objectText);
  return (
    scalarString(fact.attributes.stateIndex, parsed?.stateIndex) ||
    scalarString(fact.attributes.state_index, parsed?.state_index) ||
    null
  );
}

function factStateIndexes(fact: MemoryFact): Array<string | number> {
  const directStateIndex = factStateIndex(fact);
  const indexes: Array<string | number> = directStateIndex !== null ? [directStateIndex] : [];
  const parsed = parseJsonRecord(fact.objectText);
  const steps = parsed?.steps;
  if (!Array.isArray(steps)) return indexes;
  const seen = new Set(indexes.map((index) => String(index)));
  for (const step of steps.slice(0, SOURCE_RUN_SUPPORT_CONTEXTS_PER_RUN * 2)) {
    if (!step || typeof step !== 'object' || Array.isArray(step)) continue;
    const stateIndex = scalarString(
      (step as Record<string, unknown>).stateIndex,
      (step as Record<string, unknown>).state_index,
    );
    if (!stateIndex || seen.has(stateIndex)) continue;
    seen.add(stateIndex);
    indexes.push(stateIndex);
  }
  return indexes;
}

export function selectionDedupeKey(fact: MemoryFact): string | null {
  if (!fact.sourceRunId) return null;
  return `${fact.memoryKind}:${fact.sourceRunId}:${fact.predicate}`;
}

export function supportDiversityKey(fact: MemoryFact): string | null {
  return selectionDedupeKey(fact);
}

export function supportPhaseKey(fact: MemoryFact): string | null {
  const stateIndex = factStateIndex(fact);
  if (!fact.sourceRunId || stateIndex === null) return null;
  return `${fact.sourceRunId}:${stateIndex}`;
}

export function sourceRunStateKey(fact: MemoryFact): string | null {
  const stateIndex = factStateIndex(fact);
  if (!fact.sourceRunId || stateIndex === null) return null;
  return `${fact.sourceRunId}:${stateIndex}`;
}

export function primarySelectionGroupKey(fact: MemoryFact): string {
  if (!fact.sourceRunId) return `fact:${fact.id}`;
  return `source_run:${fact.sourceRunId}`;
}

function procedureStepCount(fact: MemoryFact): number | null {
  if (fact.memoryKind !== 'procedure') return null;
  const parsed = parseJsonRecord(fact.objectText);
  if (typeof parsed?.stepCount === 'number' && Number.isFinite(parsed.stepCount)) {
    return parsed.stepCount;
  }
  const steps = parsed?.steps;
  return Array.isArray(steps) ? steps.length : null;
}

function productEvidencePriority(kind: MemoryFactKind): number {
  switch (kind) {
    case 'procedure':
      return 8;
    case 'outcome':
      return 7;
    case 'decision':
      return 6;
    case 'risk':
    case 'gotcha':
      return 5;
    case 'artifact':
    case 'source':
      return 4;
    case 'summary':
      return 3;
    case 'tool_result':
      return 2;
    default:
      return 1;
  }
}

function hasWorkflowProcedureEvidence(outcome: MemoryFact, procedure: MemoryFact): boolean {
  if (outcome.memoryKind !== 'outcome' || procedure.memoryKind !== 'procedure') return false;
  if (!outcome.sourceRunId || outcome.sourceRunId !== procedure.sourceRunId) return false;
  return (procedureStepCount(procedure) ?? 0) > 0;
}

export function workflowProcedureRepresentativeForOutcome(
  outcome: MemoryFact,
  procedures: ReadonlyArray<MemoryFact>,
): MemoryFact | null {
  if (!outcome.sourceRunId || outcome.memoryKind !== 'outcome') return null;
  let best: MemoryFact | null = null;
  for (const procedure of procedures) {
    if (!hasWorkflowProcedureEvidence(outcome, procedure)) continue;
    if (!best) {
      best = procedure;
      continue;
    }
    const procedureSteps = procedureStepCount(procedure) ?? 0;
    const bestSteps = procedureStepCount(best) ?? 0;
    if (procedureSteps !== bestSteps) {
      if (procedureSteps > bestSteps) best = procedure;
      continue;
    }
    if (procedure.updatedAt > best.updatedAt) best = procedure;
  }
  return best;
}

export function primaryWorkflowRepresentative(
  entry: ScoredSelectionFact,
  scoredFacts: ReadonlyArray<ScoredSelectionFact>,
  threshold: number,
): ScoredSelectionFact {
  if (!entry.fact.sourceRunId) return entry;
  const minScore = Math.max(threshold, entry.score * WORKFLOW_REPRESENTATIVE_MIN_SCORE_RATIO);
  let best: ScoredSelectionFact = entry;
  let bestPriority = productEvidencePriority(entry.fact.memoryKind);
  for (const candidate of scoredFacts) {
    if (candidate.fact.sourceRunId !== entry.fact.sourceRunId) continue;
    if (candidate.score < minScore && candidate.relevanceScore < threshold) continue;
    const priority = productEvidencePriority(candidate.fact.memoryKind);
    if (
      priority > bestPriority ||
      (priority === bestPriority && candidate.score > best.score) ||
      (priority === bestPriority &&
        candidate.score === best.score &&
        candidate.fact.updatedAt > best.fact.updatedAt)
    ) {
      best = candidate;
      bestPriority = priority;
    }
  }
  return best;
}

export function supportSlotCount(limit: number): number {
  if (limit < 5) return 0;
  return Math.min(SOURCE_RUN_SUPPORT_MAX_SLOTS, Math.max(1, Math.ceil(limit * 0.25)));
}

export function sourceRunSupportContexts(
  facts: ReadonlyArray<MemoryFact>,
  scoredFacts: ReadonlyArray<ScoredSelectionFact>,
): Array<{
  sourceRunId: string;
  stateIndex: string | number;
}> {
  const selectedRunOrder: string[] = [];
  const selectedRuns = new Set<string>();
  for (const fact of facts) {
    if (!fact.sourceRunId || selectedRuns.has(fact.sourceRunId)) continue;
    selectedRuns.add(fact.sourceRunId);
    selectedRunOrder.push(fact.sourceRunId);
  }

  const byKey = new Map<string, { sourceRunId: string; stateIndex: string | number }>();
  const addFactContexts = (fact: MemoryFact): void => {
    if (!fact.sourceRunId || !selectedRuns.has(fact.sourceRunId)) return;
    const runContextCount = Array.from(byKey.values()).filter(
      (context) => context.sourceRunId === fact.sourceRunId,
    ).length;
    if (runContextCount >= SOURCE_RUN_SUPPORT_CONTEXTS_PER_RUN) return;
    for (const stateIndex of factStateIndexes(fact)) {
      byKey.set(`${fact.sourceRunId}:${stateIndex}`, {
        sourceRunId: fact.sourceRunId,
        stateIndex,
      });
      if (
        Array.from(byKey.values()).filter((context) => context.sourceRunId === fact.sourceRunId)
          .length >= SOURCE_RUN_SUPPORT_CONTEXTS_PER_RUN
      ) {
        break;
      }
    }
  };

  for (const fact of facts) addFactContexts(fact);
  for (const sourceRunId of selectedRunOrder) {
    const currentCount = Array.from(byKey.values()).filter(
      (context) => context.sourceRunId === sourceRunId,
    ).length;
    if (currentCount >= SOURCE_RUN_SUPPORT_CONTEXTS_PER_RUN) continue;
    for (const entry of scoredFacts) {
      if (entry.fact.sourceRunId !== sourceRunId) continue;
      if (entry.textScore <= 0 && entry.score <= 0) continue;
      addFactContexts(entry.fact);
    }
  }
  return Array.from(byKey.values());
}

function supportFactPriority(fact: MemoryFact): number {
  return productEvidencePriority(fact.memoryKind);
}

export function compareSupportCandidates(
  left: { fact: MemoryFact; scored: ScoredSelectionFact },
  right: { fact: MemoryFact; scored: ScoredSelectionFact },
): number {
  const rightPriority = supportFactPriority(right.fact);
  const leftPriority = supportFactPriority(left.fact);
  if (right.scored.score !== left.scored.score) return right.scored.score - left.scored.score;
  if (right.scored.relevanceScore !== left.scored.relevanceScore) {
    return right.scored.relevanceScore - left.scored.relevanceScore;
  }
  if (rightPriority !== leftPriority) return rightPriority - leftPriority;
  if (right.fact.retrievability !== left.fact.retrievability) {
    return right.fact.retrievability - left.fact.retrievability;
  }
  return right.fact.updatedAt - left.fact.updatedAt;
}

export function compareSupportPhaseRepresentatives(
  left: { fact: MemoryFact; scored: ScoredSelectionFact },
  right: { fact: MemoryFact; scored: ScoredSelectionFact },
): number {
  const supportComparison = compareSupportCandidates(left, right);
  if (supportComparison !== 0) return supportComparison;
  const leftState = Number(factStateIndex(left.fact));
  const rightState = Number(factStateIndex(right.fact));
  if (Number.isFinite(leftState) && Number.isFinite(rightState) && leftState !== rightState) {
    return rightState - leftState;
  }
  return 0;
}
