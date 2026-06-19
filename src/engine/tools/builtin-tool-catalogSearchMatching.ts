import { TOOL_CATALOG_CATEGORIES } from './builtin-tool-catalogConfig';
import type { CatalogSearchableEntry } from './builtin-tool-catalogSearchIndex';
import { scoreStructuralIdentifierToken } from './builtin-tool-catalogSearchTokens';

const TOOL_CATALOG_CAPABILITY_FILTERS = new Set([
  'discover',
  'read',
  'write',
  'commit',
  'push',
  'deploy',
  'monitor',
  'wait',
  'verify',
  'coordinate',
  'compute',
]);

export function normalizeCapabilityFilters(
  capabilities: ReadonlyArray<string> | undefined,
): string[] {
  if (!capabilities?.length) {
    return [];
  }
  return Array.from(
    new Set(
      capabilities
        .map((capability) =>
          typeof capability === 'string' ? capability.trim().toLowerCase() : '',
        )
        .filter((capability) => TOOL_CATALOG_CAPABILITY_FILTERS.has(capability)),
    ),
  );
}

export function entryMatchesQuery(
  entry: CatalogSearchableEntry,
  queryTokens: ReadonlyArray<string>,
): boolean {
  return scoreEntryQueryMatch(entry, queryTokens) > 0;
}

export function scoreEntryQueryMatch(
  entry: CatalogSearchableEntry,
  queryTokens: ReadonlyArray<string>,
): number {
  if (queryTokens.length === 0) {
    return 1;
  }

  let score = 0;
  for (const queryToken of queryTokens) {
    let tokenScore = 0;
    for (const candidateToken of entry.searchTokens) {
      tokenScore = Math.max(
        tokenScore,
        scoreStructuralIdentifierToken(queryToken, candidateToken),
      );
    }
    score += tokenScore;
  }
  return score;
}

export function entryMatchesCapabilities(
  entry: CatalogSearchableEntry,
  requiredCapabilities: ReadonlyArray<string>,
): boolean {
  if (requiredCapabilities.length === 0) {
    return true;
  }
  return requiredCapabilities.every((capability) => entry.capabilityTokens.has(capability));
}

export function entryMatchesAnyCapability(
  entry: CatalogSearchableEntry,
  requiredCapabilities: ReadonlyArray<string>,
): boolean {
  if (requiredCapabilities.length === 0) {
    return true;
  }
  return requiredCapabilities.some((capability) => entry.capabilityTokens.has(capability));
}

export function entryMatchesCategory(
  entry: CatalogSearchableEntry,
  category: string | undefined,
): boolean {
  if (!category) {
    return true;
  }
  if (category === 'native' && entry.resourceKindTokens.has('device')) {
    return true;
  }
  return scoreStructuralIdentifierToken(category, entry.category) > 0;
}

export function mergeCatalogMatches(
  primary: ReadonlyArray<CatalogSearchableEntry>,
  secondary: ReadonlyArray<CatalogSearchableEntry>,
): CatalogSearchableEntry[] {
  const merged: CatalogSearchableEntry[] = [];
  const seen = new Set<string>();
  for (const entry of [...primary, ...secondary]) {
    if (seen.has(entry.name)) {
      continue;
    }
    seen.add(entry.name);
    merged.push(entry);
  }
  return merged;
}

export function resolveToolCatalogCategoryName(category: string | undefined): string | undefined {
  const normalizedCategory = category?.trim().toLowerCase();
  if (!normalizedCategory) {
    return undefined;
  }
  if (TOOL_CATALOG_CATEGORIES[normalizedCategory]) {
    return normalizedCategory;
  }

  const matches = Object.keys(TOOL_CATALOG_CATEGORIES)
    .map((candidate) => ({
      candidate,
      score: scoreStructuralIdentifierToken(normalizedCategory, candidate),
    }))
    .filter((match) => match.score > 0)
    .sort(
      (left, right) => right.score - left.score || left.candidate.localeCompare(right.candidate),
    );
  if (matches.length === 0) {
    return undefined;
  }
  if (matches.length > 1 && matches[0]!.score === matches[1]!.score) {
    return undefined;
  }
  return matches[0]!.candidate;
}
