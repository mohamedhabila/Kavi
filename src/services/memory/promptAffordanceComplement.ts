import { tokenizeLexicalUnits } from './ranking/lexical';

const MAX_OBSERVED_AFFORDANCE_COMPLEMENT_ITEMS = 8;

function trimString(value: unknown, maxChars: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed.length <= maxChars ? trimmed : `${trimmed.slice(0, maxChars - 3).trimEnd()}...`;
}

function dropEmptyRecord(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined && entry !== null && entry !== ''),
  );
}

function matchedQueryUnitSet(
  value: string,
  queryUnits: ReadonlySet<string> | null,
): Set<string> {
  if (!queryUnits || queryUnits.size === 0) return new Set();
  const valueUnits = tokenizeLexicalUnits(value);
  const hits = new Set<string>();
  for (const unit of queryUnits) {
    if (valueUnits.has(unit)) hits.add(unit);
  }
  return hits;
}

function compactAffordanceEntry(entry: Record<string, unknown>): Record<string, unknown> {
  return dropEmptyRecord({
    role: trimString(entry.role, 80),
    label: trimString(entry.label, 180),
    attributes: trimString(entry.attributes, 160),
    section: trimString(entry.section, 180),
  });
}

export function compactObservedAffordanceComplementForPrompt(params: {
  observedAffordances: unknown;
  compactedControlSequence: unknown;
  queryUnits: ReadonlySet<string> | null;
}): unknown {
  const { observedAffordances, compactedControlSequence, queryUnits } = params;
  if (!Array.isArray(observedAffordances) || observedAffordances.length === 0) return undefined;
  if (!queryUnits || queryUnits.size === 0) return undefined;

  const controlHits = matchedQueryUnitSet(JSON.stringify(compactedControlSequence), queryUnits);
  const selected = observedAffordances
    .map((entry, index) => {
      const hits = matchedQueryUnitSet(JSON.stringify(entry), queryUnits);
      const complementaryHitCount = Array.from(hits).filter((unit) => !controlHits.has(unit))
        .length;
      return {
        index,
        value: entry,
        hitCount: hits.size,
        complementaryHitCount,
      };
    })
    .filter((entry) => entry.complementaryHitCount > 0)
    .sort((left, right) => {
      if (right.complementaryHitCount !== left.complementaryHitCount) {
        return right.complementaryHitCount - left.complementaryHitCount;
      }
      if (right.hitCount !== left.hitCount) return right.hitCount - left.hitCount;
      return left.index - right.index;
    })
    .slice(0, MAX_OBSERVED_AFFORDANCE_COMPLEMENT_ITEMS)
    .sort((left, right) => left.index - right.index)
    .map((entry) => {
      if (!entry.value || typeof entry.value !== 'object' || Array.isArray(entry.value)) {
        return null;
      }
      const compact = compactAffordanceEntry(entry.value as Record<string, unknown>);
      return Object.keys(compact).length > 0 ? compact : null;
    })
    .filter((entry): entry is Record<string, unknown> => entry !== null);

  return selected.length > 0 ? selected : undefined;
}
