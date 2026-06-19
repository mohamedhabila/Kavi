import { TOOL_CATALOG_CATEGORIES } from './builtin-tool-catalogConfig';
import type {
  ExecuteToolCatalogOptions,
  ToolCatalogSearchToolEntry,
} from './builtin-tool-catalogTypes';
import {
  buildToolCatalogSearchIndex,
  type CatalogSearchableEntry,
} from './builtin-tool-catalogSearchIndex';
import {
  entryMatchesAnyCapability,
  entryMatchesCapabilities,
  entryMatchesCategory,
  entryMatchesQuery,
  mergeCatalogMatches,
  normalizeCapabilityFilters,
  scoreEntryQueryMatch,
} from './builtin-tool-catalogSearchMatching';
import { tokenizeStructuralIdentifiers } from './builtin-tool-catalogSearchTokens';

export {
  buildToolCatalogActivation,
  buildToolCatalogSearchIndex,
  TOOL_CATALOG_ENTRY_SCHEMA_VERSION,
} from './builtin-tool-catalogSearchIndex';
export { resolveToolCatalogCategoryName } from './builtin-tool-catalogSearchMatching';
export {
  scoreStructuralIdentifierToken,
  tokenizeStructuralIdentifiers,
} from './builtin-tool-catalogSearchTokens';

export function searchToolCatalogEntries(params: {
  query?: string;
  capabilities?: ReadonlyArray<string>;
  category?: string;
  options?: ExecuteToolCatalogOptions;
  limit?: number;
}): ToolCatalogSearchToolEntry[] {
  const queryTokens = tokenizeStructuralIdentifiers(params.query?.trim() ?? '');
  const requiredCapabilities = normalizeCapabilityFilters(params.capabilities);
  const category = params.category?.trim().toLowerCase();
  const limit = Math.max(1, params.limit ?? 25);
  const searchIndex = buildToolCatalogSearchIndex(params.options);
  let matches = searchInitialCatalogEntries(searchIndex, {
    queryTokens,
    requiredCapabilities,
    category,
  });

  if (matches.length === 0 && requiredCapabilities.length > 0) {
    matches = searchCapabilityFallbackEntries(searchIndex, {
      queryTokens,
      requiredCapabilities,
      category,
    });
  }
  if (matches.length === 0 && category) {
    matches = searchCategoryFallbackEntries(searchIndex, {
      requiredCapabilities,
      category,
      matchAnyCapability: false,
    });
  }
  if (matches.length === 0 && category && requiredCapabilities.length > 0) {
    matches = searchCategoryFallbackEntries(searchIndex, {
      requiredCapabilities,
      category,
      matchAnyCapability: true,
    });
  }
  if (matches.length === 0 && !category && requiredCapabilities.length > 0) {
    matches = searchIndex
      .filter((entry) => entryMatchesAnyCapability(entry, requiredCapabilities))
      .sort((left, right) => left.name.localeCompare(right.name));
  }
  if (category && category !== 'native' && requiredCapabilities.length > 0) {
    matches = mergeCatalogMatches(
      matches,
      searchCategoryFallbackEntries(searchIndex, {
        requiredCapabilities,
        category,
        matchAnyCapability: true,
      }),
    );
  }
  if (category && category !== 'native') {
    matches = mergeCatalogMatches(
      matches,
      searchCategoryNeighborhoodEntries(searchIndex, { category }),
    );
  }

  return matches.slice(0, limit).map(projectSearchEntry);
}

export function buildToolCatalogSearchResponse(params: {
  query?: string;
  capabilities?: ReadonlyArray<string>;
  category?: string;
  options?: ExecuteToolCatalogOptions;
}): string {
  const query = params.query?.trim();
  const capabilities = normalizeCapabilityFilters(params.capabilities);
  const rawCategory = params.category?.trim().toLowerCase();
  const category = rawCategory && TOOL_CATALOG_CATEGORIES[rawCategory] ? rawCategory : undefined;
  let tools = searchToolCatalogEntries({
    query,
    capabilities,
    category,
    options: params.options,
  });
  if (tools.length === 0 && capabilities.length > 0 && (query || category)) {
    tools = searchToolCatalogEntries({
      capabilities,
      options: params.options,
    });
  }

  return JSON.stringify({
    mode: 'search',
    ...(query ? { query } : {}),
    ...(capabilities.length > 0 ? { capabilities } : {}),
    ...(category ? { category } : {}),
    tools: tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      category: tool.category,
      source: tool.source,
      schemaVersion: tool.schemaVersion,
      ...(tool.schemaDigest ? { schemaDigest: tool.schemaDigest } : {}),
      ...(tool.serverName ? { serverName: tool.serverName } : {}),
      ...(tool.skillName ? { skillName: tool.skillName } : {}),
      capabilitySummary: tool.capabilitySummary,
      activation: tool.activation,
    })),
    totalMatches: tools.length,
  });
}

function searchInitialCatalogEntries(
  searchIndex: ReadonlyArray<CatalogSearchableEntry>,
  params: {
    queryTokens: ReadonlyArray<string>;
    requiredCapabilities: ReadonlyArray<string>;
    category: string | undefined;
  },
): CatalogSearchableEntry[] {
  const exactIdentifierTokens = new Set(
    params.queryTokens.filter((token) =>
      searchIndex.some((entry) => entry.name.toLowerCase() === token),
    ),
  );
  if (exactIdentifierTokens.size > 1) {
    return searchIndex.filter(
      (entry) =>
        exactIdentifierTokens.has(entry.name.toLowerCase()) &&
        entryMatchesCategory(entry, params.category) &&
        entryMatchesAnyCapability(entry, params.requiredCapabilities),
    );
  }
  return searchIndex
    .filter(
      (entry) =>
        entryMatchesCategory(entry, params.category) &&
        entryMatchesQuery(entry, params.queryTokens) &&
        entryMatchesCapabilities(entry, params.requiredCapabilities),
    )
    .sort((left, right) => sortByQueryScore(left, right, params.queryTokens));
}

function searchCapabilityFallbackEntries(
  searchIndex: ReadonlyArray<CatalogSearchableEntry>,
  params: {
    queryTokens: ReadonlyArray<string>;
    requiredCapabilities: ReadonlyArray<string>;
    category: string | undefined;
  },
): CatalogSearchableEntry[] {
  return searchIndex
    .filter(
      (entry) =>
        entryMatchesCategory(entry, params.category) &&
        entryMatchesQuery(entry, params.queryTokens) &&
        entryMatchesAnyCapability(entry, params.requiredCapabilities),
    )
    .sort((left, right) => {
      const leftStrict = entryMatchesCapabilities(left, params.requiredCapabilities) ? 1 : 0;
      const rightStrict = entryMatchesCapabilities(right, params.requiredCapabilities) ? 1 : 0;
      if (leftStrict !== rightStrict) {
        return rightStrict - leftStrict;
      }
      return sortByQueryScore(left, right, params.queryTokens);
    });
}

function searchCategoryFallbackEntries(
  searchIndex: ReadonlyArray<CatalogSearchableEntry>,
  params: {
    requiredCapabilities: ReadonlyArray<string>;
    category: string;
    matchAnyCapability: boolean;
  },
): CatalogSearchableEntry[] {
  const matchesCapabilities = params.matchAnyCapability
    ? entryMatchesAnyCapability
    : entryMatchesCapabilities;
  return searchIndex
    .filter(
      (entry) =>
        entryMatchesCategory(entry, params.category) &&
        matchesCapabilities(entry, params.requiredCapabilities),
    )
    .sort((left, right) => left.name.localeCompare(right.name));
}

function searchCategoryNeighborhoodEntries(
  searchIndex: ReadonlyArray<CatalogSearchableEntry>,
  params: { category: string },
): CatalogSearchableEntry[] {
  return searchIndex
    .filter((entry) => entryMatchesCategory(entry, params.category))
    .sort((left, right) => left.name.localeCompare(right.name));
}

function sortByQueryScore(
  left: CatalogSearchableEntry,
  right: CatalogSearchableEntry,
  queryTokens: ReadonlyArray<string>,
): number {
  const scoreDelta = scoreEntryQueryMatch(right, queryTokens) - scoreEntryQueryMatch(left, queryTokens);
  if (scoreDelta !== 0) {
    return scoreDelta;
  }
  return left.name.localeCompare(right.name);
}

function projectSearchEntry(entry: CatalogSearchableEntry): ToolCatalogSearchToolEntry {
  return {
    name: entry.name,
    description: entry.description,
    category: entry.category,
    source: entry.source,
    schemaVersion: entry.schemaVersion,
    ...(entry.schemaDigest ? { schemaDigest: entry.schemaDigest } : {}),
    ...(entry.purpose ? { purpose: entry.purpose } : {}),
    ...(entry.serverName ? { serverName: entry.serverName } : {}),
    ...(entry.skillName ? { skillName: entry.skillName } : {}),
    ...(entry.capabilitySummary ? { capabilitySummary: entry.capabilitySummary } : {}),
    activation: entry.activation,
  };
}
