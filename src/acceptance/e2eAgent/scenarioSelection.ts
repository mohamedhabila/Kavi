// ---------------------------------------------------------------------------
// Kavi — E2E scenario selection helpers
// ---------------------------------------------------------------------------

import type { E2EScenario } from './types';

export type E2EScenarioSuiteEntry = {
  suite: string;
  scenario: E2EScenario;
};

export function parseE2EScenarioIdFilter(rawValue?: string): ReadonlySet<string> | null {
  const raw = rawValue?.trim();
  if (!raw) {
    return null;
  }

  const ids = raw
    .split(/[,\s]+/u)
    .map((value) => value.trim())
    .filter(Boolean);

  return ids.length > 0 ? new Set(ids) : null;
}

export function filterE2EScenarioSuiteEntries(
  entries: ReadonlyArray<E2EScenarioSuiteEntry>,
  rawFilter?: string,
): E2EScenarioSuiteEntry[] {
  const selectedIds = parseE2EScenarioIdFilter(rawFilter);
  if (!selectedIds) {
    return [...entries];
  }

  const selectedEntries = entries.filter((entry) => selectedIds.has(entry.scenario.id));
  const knownIds = new Set(entries.map((entry) => entry.scenario.id));
  const missingIds = [...selectedIds].filter((id) => !knownIds.has(id)).sort();
  if (missingIds.length > 0) {
    throw new Error(`Unknown E2E scenario ids: ${missingIds.join(', ')}`);
  }

  return selectedEntries;
}
