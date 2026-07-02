import { type MemoryFact } from './facts/types';
import {
  compareSupportCandidates,
  compareSupportPhaseRepresentatives,
  sourceRunStateKey,
  supportPhaseKey,
  type ScoredSelectionFact,
} from './ranking/selection';

export interface WorkflowSupportEntry {
  exactContext: boolean;
  fact: MemoryFact;
  queryEvidenceScore: number;
  scored: ScoredSelectionFact;
}

export function sourceBalancedSupportEntries<T extends { fact: MemoryFact }>(params: {
  entries: ReadonlyArray<T>;
  selectedSourceRuns: ReadonlyArray<string>;
  supportSlots: number;
}): T[] {
  const { entries, selectedSourceRuns, supportSlots } = params;
  if (supportSlots <= 1 || entries.length <= 1) return [...entries];
  const selectedIds = new Set<string>();
  const balancedSourceRuns = new Set<string>();
  const balanced: T[] = [];
  const selectedSourceRunSet = new Set(selectedSourceRuns);
  for (const entry of entries) {
    if (balanced.length >= supportSlots) break;
    const sourceRunId = entry.fact.sourceRunId;
    if (!sourceRunId || !selectedSourceRunSet.has(sourceRunId)) continue;
    if (balancedSourceRuns.has(sourceRunId) || selectedIds.has(entry.fact.id)) continue;
    balanced.push(entry);
    selectedIds.add(entry.fact.id);
    balancedSourceRuns.add(sourceRunId);
  }
  for (const entry of entries) {
    if (selectedIds.has(entry.fact.id)) continue;
    balanced.push(entry);
  }
  return balanced;
}

export function compareRankedSupportEntries<
  T extends {
    exactContext: boolean;
    fact: MemoryFact;
    queryEvidenceScore: number;
    scored: ScoredSelectionFact;
  },
>(left: T, right: T, sourceRunSupportRank: ReadonlyMap<string, number>): number {
  if (right.queryEvidenceScore !== left.queryEvidenceScore) {
    return right.queryEvidenceScore - left.queryEvidenceScore;
  }
  const supportComparison = compareSupportCandidates(left, right);
  if (supportComparison !== 0) return supportComparison;
  if (left.exactContext !== right.exactContext) return left.exactContext ? -1 : 1;
  const leftRank = sourceRunSupportRank.get(left.fact.sourceRunId ?? '') ?? Number.MAX_SAFE_INTEGER;
  const rightRank =
    sourceRunSupportRank.get(right.fact.sourceRunId ?? '') ?? Number.MAX_SAFE_INTEGER;
  return leftRank - rightRank;
}

export function isActionResultOutcome(fact: MemoryFact): boolean {
  return fact.memoryKind === 'outcome';
}

export function selectedActionResultSourceRuns(facts: ReadonlyArray<MemoryFact>): Set<string> {
  return new Set(
    facts
      .filter((fact) => isActionResultOutcome(fact) && fact.sourceRunId)
      .map((fact) => fact.sourceRunId as string),
  );
}

export function isImmediateActionResultContinuation(
  candidate: MemoryFact,
  selected: ReadonlyArray<MemoryFact>,
): boolean {
  if (!isActionResultOutcome(candidate) || !candidate.sourceRunId) return false;
  const candidateStateKey = sourceRunStateKey(candidate);
  if (!candidateStateKey) return false;
  return selected.some(
    (fact) =>
      isActionResultOutcome(fact) &&
      fact.sourceRunId === candidate.sourceRunId &&
      sourceRunStateKey(fact) === candidateStateKey,
  );
}

export function rankWorkflowSupportEntries<T extends WorkflowSupportEntry>(params: {
  entries: ReadonlyArray<T>;
  sourceRunSupportRank: ReadonlyMap<string, number>;
}): T[] {
  const { entries, sourceRunSupportRank } = params;
  const supportEntriesByPhase = new Map<string, T>();
  const ungroupedSupportEntries: T[] = [];
  for (const entry of entries) {
    const phaseKey = supportPhaseKey(entry.fact);
    if (!phaseKey) {
      ungroupedSupportEntries.push(entry);
      continue;
    }
    const existing = supportEntriesByPhase.get(phaseKey);
    if (!existing || compareSupportPhaseRepresentatives(entry, existing) < 0) {
      supportEntriesByPhase.set(phaseKey, entry);
    }
  }

  return [...supportEntriesByPhase.values(), ...ungroupedSupportEntries].sort((left, right) =>
    compareRankedSupportEntries(left, right, sourceRunSupportRank),
  );
}

export function supportEvidenceRichness(fact: MemoryFact): number {
  const textLength = fact.objectText.trim().length;
  const attributeCount = Object.keys(fact.attributes ?? {}).length;
  return Math.min(10, Math.ceil(textLength / 400) + attributeCount);
}

export function supportQueryEvidenceScore(
  fact: MemoryFact,
  queryUnits: ReadonlySet<string>,
  unitWeights: ReadonlyMap<string, number>,
): number {
  if (queryUnits.size === 0) return 0;
  let queryWeight = 0;
  let matchedWeight = 0;
  const text = `${fact.predicate} ${fact.objectText} ${fact.sourceSummary ?? ''}`.toLocaleLowerCase();
  for (const unit of queryUnits) {
    const weight = unitWeights.get(unit) ?? 1;
    queryWeight += weight;
    if (text.includes(unit.toLocaleLowerCase())) matchedWeight += weight;
  }
  return queryWeight > 0 ? matchedWeight / queryWeight : 0;
}
