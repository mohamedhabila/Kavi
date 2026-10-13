// ---------------------------------------------------------------------------
// Kavi — Tool catalog search
// ---------------------------------------------------------------------------
// Ranks the catalog's tools for what the model says it needs, with BM25 over each tool's
// name and description (Robertson & Zaragoza, "The Probabilistic Relevance Framework: BM25
// and Beyond", 2009 — the ranking Anthropic's tool search tool uses). Terms are Unicode
// letter and number runs, so a query in any script is read the same way, and a tool name
// counts as its parts ("sms_compose" reads "sms compose").
//
// There are no category or capability filters: the model guessed them, and a wrong guess
// hid the tool it needed. Replaying a live run's 39 catalog calls, 59% found a tool the turn
// went on to need with the filters and 88% with this ranking alone; also adding the
// producers of the results' required inputs found no more.
//
// The index is every tool the run may use, read from the registry, the MCP servers and the
// skills; there is no hand-kept list of catalog tools, which once left a registered tool
// (share_file) impossible to find.
// ---------------------------------------------------------------------------

import { truncateGraphemesWithSuffix } from '../../utils/graphemeBoundary';
import { getDynamicMcpCatalog, getDynamicSkillCatalog } from './builtin-tool-catalogDynamic';
import type { ExecuteToolCatalogOptions, ToolCatalogEntry } from './builtin-tool-catalogTypes';
import { TOOL_DEFINITIONS } from './definitions';
import { parseMcpToolName } from '../../services/mcp/bridge';
import { parseSkillToolName } from '../../services/skills/manager';

/** Results per search. */
const TOOL_CATALOG_SEARCH_LIMIT = 8;
/** Description shown per result; the full contract comes with the tool once it is callable. */
const TOOL_CATALOG_DESCRIPTION_MAX_CHARS = 240;
const BM25_K1 = 1.2;
const BM25_B = 0.75;

const TERM_PATTERN = /[\p{L}\p{M}\p{N}]+/gu;
/** The discovery tools are always callable; a search never returns them. */
const DISCOVERY_TOOL_NAMES: ReadonlySet<string> = new Set(['tool_catalog', 'tool_describe']);

interface IndexedTool {
  entry: ToolCatalogEntry;
  terms: string[];
  termCounts: Map<string, number>;
}

function toolCatalogTerms(text: string): string[] {
  return (text.normalize('NFKC').toLocaleLowerCase().match(TERM_PATTERN) ?? []).filter(
    (term) => Array.from(term).length >= 2,
  );
}

export function isToolCatalogVisible(
  toolName: string,
  options?: ExecuteToolCatalogOptions,
): boolean {
  return options?.visibleToolNames ? options.visibleToolNames.has(toolName) : true;
}

export function buildToolCatalogActivation(
  toolName: string,
  options?: ExecuteToolCatalogOptions,
): ToolCatalogEntry['activation'] {
  return {
    name: toolName,
    eligible: true,
    callableNow: options?.availableToolNames ? options.availableToolNames.has(toolName) : true,
  };
}

function indexTool(entry: ToolCatalogEntry): IndexedTool {
  const terms = toolCatalogTerms(`${entry.name.replace(/_+/g, ' ')} ${entry.description}`);
  const termCounts = new Map<string, number>();
  for (const term of terms) termCounts.set(term, (termCounts.get(term) ?? 0) + 1);
  return {
    entry: {
      ...entry,
      description: truncateGraphemesWithSuffix(
        entry.description,
        TOOL_CATALOG_DESCRIPTION_MAX_CHARS,
        '…',
      ),
    },
    terms,
    termCounts,
  };
}

function buildToolCatalogIndex(options?: ExecuteToolCatalogOptions): IndexedTool[] {
  const indexed = new Map<string, IndexedTool>();
  const add = (entry: Omit<ToolCatalogEntry, 'activation'>) => {
    if (indexed.has(entry.name) || !isToolCatalogVisible(entry.name, options)) return;
    indexed.set(
      entry.name,
      indexTool({ ...entry, activation: buildToolCatalogActivation(entry.name, options) }),
    );
  };
  // MCP and skill tools first: their entries carry the schema digest activation checks.
  for (const tool of getDynamicMcpCatalog().tools) {
    add({
      name: tool.name,
      description: `${tool.description} (${tool.serverName})`,
      source: 'mcp',
      ...(tool.schemaDigest ? { schemaDigest: tool.schemaDigest } : {}),
    });
  }
  for (const tool of getDynamicSkillCatalog().tools) {
    add({
      name: tool.name,
      description: tool.description,
      source: 'skill',
      ...(tool.schemaDigest ? { schemaDigest: tool.schemaDigest } : {}),
    });
  }
  for (const tool of TOOL_DEFINITIONS) {
    if (
      DISCOVERY_TOOL_NAMES.has(tool.name) ||
      parseSkillToolName(tool.name) ||
      parseMcpToolName(tool.name)
    ) {
      continue;
    }
    add({ name: tool.name, description: tool.description, source: 'built-in' });
  }
  return Array.from(indexed.values());
}

function rankByBm25(index: ReadonlyArray<IndexedTool>, query: string): IndexedTool[] {
  const queryTerms = new Set(toolCatalogTerms(query));
  if (queryTerms.size === 0 || index.length === 0) return [];
  const averageLength = index.reduce((sum, tool) => sum + tool.terms.length, 0) / index.length;
  const documentFrequency = new Map<string, number>();
  for (const tool of index) {
    for (const term of tool.termCounts.keys()) {
      if (queryTerms.has(term)) documentFrequency.set(term, (documentFrequency.get(term) ?? 0) + 1);
    }
  }
  return index
    .map((tool) => {
      let score = 0;
      for (const term of queryTerms) {
        const frequency = tool.termCounts.get(term);
        if (!frequency) continue;
        const containing = documentFrequency.get(term) ?? 0;
        const idf = Math.log(1 + (index.length - containing + 0.5) / (containing + 0.5));
        score +=
          (idf * frequency * (BM25_K1 + 1)) /
          (frequency +
            BM25_K1 * (1 - BM25_B + (BM25_B * tool.terms.length) / Math.max(averageLength, 1)));
      }
      return { tool, score };
    })
    .filter(({ score }) => score > 0)
    .sort(
      (left, right) =>
        right.score - left.score || left.tool.entry.name.localeCompare(right.tool.entry.name),
    )
    .map(({ tool }) => tool);
}

/** The catalog tools that best match `query`, best first. */
export function searchToolCatalog(
  query: string,
  options?: ExecuteToolCatalogOptions,
): ToolCatalogEntry[] {
  return rankByBm25(buildToolCatalogIndex(options), query)
    .slice(0, TOOL_CATALOG_SEARCH_LIMIT)
    .map((tool) => tool.entry);
}
