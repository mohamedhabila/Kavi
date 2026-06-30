import {
  listUiInventoriesForObservationContexts,
} from './facts/queries';
import type { MemoryFact } from './facts/types';
import { parseJsonRecord } from './factJson';
import type { RecallFactsOptions, ScoredFact } from './factRecallTypes';
import { sourceRunStateKey } from './ranking/selection';
import { recordHasUiStateBearingValue } from './uiStateBearingFields';

type SelectedInventoryAdder = (fact: MemoryFact) => boolean;

export function isUiStateDetailFact(fact: MemoryFact): boolean {
  return fact.memoryKind === 'ui_field' || fact.memoryKind === 'ui_filter_state';
}

function uniqueFactsById(facts: ReadonlyArray<MemoryFact>): MemoryFact[] {
  const byId = new Map<string, MemoryFact>();
  for (const fact of facts) byId.set(fact.id, fact);
  return Array.from(byId.values());
}

function factObservationContext(fact: MemoryFact): {
  sourceRunId: string | null;
  stateIndex: string | number | null;
  url: string | null;
} {
  const stateIndex = fact.attributes.stateIndex;
  return {
    sourceRunId: fact.sourceRunId,
    stateIndex:
      typeof stateIndex === 'string' || typeof stateIndex === 'number' ? stateIndex : null,
    url: typeof fact.attributes.url === 'string' ? fact.attributes.url : null,
  };
}

export function uiInventoryHasStateBearingFields(fact: MemoryFact): boolean {
  if (fact.memoryKind !== 'ui_inventory') return false;
  const parsed = parseJsonRecord(fact.objectText);
  const fields = parsed?.fields;
  if (!Array.isArray(fields)) return false;
  return fields.some((field) => {
    if (!field || typeof field !== 'object' || Array.isArray(field)) return false;
    return recordHasUiStateBearingValue(field as Record<string, unknown>);
  });
}

function uiInventoryQueryOptions(options: RecallFactsOptions): {
  limit: number;
  includeInvalidated?: true;
  asOf?: number;
} {
  return {
    limit: 1,
    ...(options.includeHistorical ? { includeInvalidated: true as const } : {}),
    ...(options.asOf !== undefined ? { asOf: options.asOf } : {}),
  };
}

export function insertSelectedUiStateInventories(params: {
  selected: MemoryFact[];
  scoredById: Map<string, ScoredFact>;
  limit: number;
  options: RecallFactsOptions;
  addSelectedInventory: SelectedInventoryAdder;
  candidateFacts?: ReadonlyArray<MemoryFact>;
}): void {
  if (params.selected.length >= params.limit) return;
  const detailFacts = uniqueFactsById([
    ...params.selected.filter(isUiStateDetailFact),
    ...(params.candidateFacts ?? []).filter(isUiStateDetailFact),
  ]);
  if (detailFacts.length === 0) return;
  const inventories = listUiInventoriesForObservationContexts(
    detailFacts.map(factObservationContext),
    {
      ...uiInventoryQueryOptions(params.options),
      limit: Math.max(1, params.limit - params.selected.length),
    },
  ).filter(uiInventoryHasStateBearingFields);
  for (const inventory of inventories) {
    const anchor = detailFacts.find(
      (fact) => sourceRunStateKey(fact) === sourceRunStateKey(inventory),
    );
    const added = params.addSelectedInventory(inventory);
    if (added && anchor) {
      const scoredAnchor = params.scoredById.get(anchor.id);
      if (scoredAnchor) params.scoredById.set(inventory.id, { ...scoredAnchor, fact: inventory });
    }
    if (params.selected.length >= params.limit) break;
  }
}

export function ensureSelectedUiStateInventories(params: {
  selected: MemoryFact[];
  seenIds: Set<string>;
  seenKeys: Set<string>;
  scoredById: Map<string, ScoredFact>;
  limit: number;
  options: RecallFactsOptions;
  addSelectedInventory: SelectedInventoryAdder;
}): void {
  const detailFacts = params.selected.filter(isUiStateDetailFact);
  if (detailFacts.length === 0) return;
  for (const detailFact of detailFacts) {
    if (
      params.selected.some(
        (fact) =>
          fact.memoryKind === 'ui_inventory' &&
          sourceRunStateKey(fact) === sourceRunStateKey(detailFact),
      )
    ) {
      continue;
    }
    const [inventory] = listUiInventoriesForObservationContexts(
      [factObservationContext(detailFact)],
      uiInventoryQueryOptions(params.options),
    );
    if (!inventory || !uiInventoryHasStateBearingFields(inventory)) continue;
    if (params.selected.length >= params.limit) continue;
    const added = params.addSelectedInventory(inventory);
    if (!added) continue;
    const scoredAnchor = params.scoredById.get(detailFact.id);
    if (scoredAnchor) params.scoredById.set(inventory.id, { ...scoredAnchor, fact: inventory });
  }
}
