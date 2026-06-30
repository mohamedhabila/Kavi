import { type MemoryFact } from './facts/types';
import { parseJsonRecord } from './factJson';
import {
  compareSupportCandidates,
  compareSupportPhaseRepresentatives,
  sourceRunStateKey,
  supportPhaseKey,
  type ScoredSelectionFact,
} from './ranking/selection';
import { countLexicalUnits } from './ranking/lexical';
import { collectUiObservationEvidenceTexts, isUiObservationFact } from './uiObservationEvidence';
import { uiInventoryHasStateBearingFields } from './factRecallUiStateInventorySupport';

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
  return fact.memoryKind === 'outcome' && fact.predicate === 'ui_action_result';
}

export function selectedActionResultSourceRuns(facts: ReadonlyArray<MemoryFact>): Set<string> {
  return new Set(
    facts
      .filter((fact) => isActionResultOutcome(fact) && fact.sourceRunId)
      .map((fact) => fact.sourceRunId as string),
  );
}

function observedStateSupportPriority(fact: MemoryFact): number {
  if (fact.memoryKind === 'ui_inventory' && uiInventoryHasStateBearingFields(fact)) return 5;
  if (fact.memoryKind === 'ui_field' || fact.memoryKind === 'ui_filter_state') return 4;
  if (fact.memoryKind === 'ui_inventory') return 3;
  if (isActionResultOutcome(fact)) return 2;
  return 1;
}

export function rankWorkflowSupportEntries<T extends WorkflowSupportEntry>(params: {
  entries: ReadonlyArray<T>;
  sourceRunSupportRank: ReadonlyMap<string, number>;
}): T[] {
  const { entries, sourceRunSupportRank } = params;
  const supportEntriesByObservedState = new Map<string, T>();
  const ungroupedObservedStateSupportEntries: T[] = [];
  const compareObservedStateSupportEntries = (left: T, right: T): number => {
    const rightPriority = observedStateSupportPriority(right.fact);
    const leftPriority = observedStateSupportPriority(left.fact);
    if (rightPriority !== leftPriority) return rightPriority - leftPriority;
    return compareRankedSupportEntries(left, right, sourceRunSupportRank);
  };
  for (const entry of entries) {
    const stateKey = sourceRunStateKey(entry.fact);
    if (!stateKey) {
      ungroupedObservedStateSupportEntries.push(entry);
      continue;
    }
    const existing = supportEntriesByObservedState.get(stateKey);
    if (!existing || compareObservedStateSupportEntries(entry, existing) < 0) {
      supportEntriesByObservedState.set(stateKey, entry);
    }
  }

  const supportEntriesByPhase = new Map<string, T>();
  const ungroupedSupportEntries: T[] = [];
  for (const entry of [
    ...supportEntriesByObservedState.values(),
    ...ungroupedObservedStateSupportEntries,
  ]) {
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
  if (fact.memoryKind !== 'ui_inventory') return 0;
  const parsed = parseJsonRecord(fact.objectText);
  if (!parsed) return 0;
  const countArray = (value: unknown): number => (Array.isArray(value) ? value.length : 0);
  const fields = Array.isArray(parsed.fields) ? parsed.fields : [];
  const fieldOptionCount = fields.reduce((total, field) => {
    if (!field || typeof field !== 'object' || Array.isArray(field)) return total;
    return total + countArray((field as Record<string, unknown>).options);
  }, 0);
  return (
    countArray(parsed.fields) * 2 +
    countArray(parsed.visibleTextSnippets) * 2 +
    countArray(parsed.controlNames) +
    countArray(parsed.popupControls) * 2 +
    countArray(parsed.labelValues) +
    fieldOptionCount
  );
}

export function supportQueryEvidenceScore(
  fact: MemoryFact,
  queryUnits: ReadonlySet<string>,
  unitWeights: ReadonlyMap<string, number>,
): number {
  if (queryUnits.size === 0) return 0;
  const parsed = parseJsonRecord(fact.objectText);
  if (!isUiObservationFact(fact, parsed)) return 0;
  const evidenceTexts = collectUiObservationEvidenceTexts(parsed, fact.attributes);
  if (evidenceTexts.length === 0) return 0;
  let queryWeight = 0;
  for (const unit of queryUnits) queryWeight += unitWeights.get(unit) ?? 1;
  if (queryWeight <= 0) return 0;
  let best = 0;
  for (const text of evidenceTexts) {
    const evidenceUnits = Array.from(countLexicalUnits(text).keys());
    if (evidenceUnits.length === 0) continue;
    let matchedWeight = 0;
    let evidenceWeight = 0;
    for (const unit of evidenceUnits) {
      const weight = unitWeights.get(unit) ?? 1;
      evidenceWeight += weight;
      if (queryUnits.has(unit)) matchedWeight += weight;
    }
    if (matchedWeight <= 0 || evidenceWeight <= 0) continue;
    best = Math.max(
      best,
      (matchedWeight / evidenceWeight) * 0.7 + (matchedWeight / queryWeight) * 0.3,
    );
  }
  return best;
}
