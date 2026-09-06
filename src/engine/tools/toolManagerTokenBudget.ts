import { ToolDefinition } from '../../types/tool';
import { estimateTokens } from '../../services/context/tokenCounter';
import { DEFAULT_CORE_TOOL_NAMES } from '../goals/toolSurface';
import { truncateGraphemesWithSuffix } from '../../utils/graphemeBoundary';

/**
 * Never-evicted tools. This deliberately mirrors the default turn-1 surface rather
 * than a fixed list of file tools: on a general mobile assistant, evicting the
 * calendar or contacts tool that the current request needs is the same failure as
 * evicting `read_file` during a file task. Task-relevant tools are additionally
 * protected via `pinnedToolNames`, which the caller derives from live goals.
 */
const CORE_TOOL_TOKEN_BUDGET_NAMES: ReadonlySet<string> = DEFAULT_CORE_TOOL_NAMES;
const MINIMAL_TOOL_DESCRIPTION_CHARACTER_LIMIT = 60;
const TOOL_DESCRIPTION_CHARACTER_LIMIT = 240;

export interface CompactToolDefinitionOptions {
  pinnedToolNames?: ReadonlySet<string>;
  precompacted?: boolean;
  /** Provider family for the online token-calibration EMA (see `tokenCounter.ts`). */
  family?: string;
}

export function estimateToolTokens(
  tool: ToolDefinition,
  options?: CompactToolDefinitionOptions,
): number {
  const compactedTool = options?.precompacted
    ? tool
    : compactToolDefinitionForPrompt(tool, options);
  const nameTokens = estimateTokens(compactedTool.name, options?.family);
  const descTokens = estimateTokens(compactedTool.description || '', options?.family);
  const schemaTokens = estimateTokens(
    JSON.stringify(compactedTool.input_schema || {}),
    options?.family,
  );
  return nameTokens + descTokens + schemaTokens + 10;
}

export function estimateAllToolTokens(
  tools: ToolDefinition[],
  options?: CompactToolDefinitionOptions,
): number {
  let total = 0;
  for (const tool of tools) {
    total += estimateToolTokens(tool, options);
  }
  return total;
}

export interface EnforceToolTokenBudgetOptions {
  pinnedToolNames?: Iterable<string>;
  /** Provider family for the online token-calibration EMA (see `tokenCounter.ts`). */
  family?: string;
}

function resolveCompactionOptions(
  pinnedToolNames: ReadonlySet<string>,
  family?: string,
): CompactToolDefinitionOptions {
  return { pinnedToolNames, family };
}

export function enforceToolTokenBudget(
  tools: ToolDefinition[],
  budgetTokens: number,
  options?: EnforceToolTokenBudgetOptions,
): ToolDefinition[] {
  const pinnedToolNames = new Set(Array.from(options?.pinnedToolNames ?? []).filter(Boolean));
  const compactionOptions = resolveCompactionOptions(pinnedToolNames, options?.family);
  let total = estimateAllToolTokens(tools, compactionOptions);
  if (total <= budgetTokens) {
    return compressToolDefinitions(tools, compactionOptions);
  }

  const scored = tools.map((tool) => ({
    tool,
    priority: CORE_TOOL_TOKEN_BUDGET_NAMES.has(tool.name)
      ? 0
      : pinnedToolNames.has(tool.name)
        ? 1
        : tool.name.startsWith('mcp__') || tool.name.startsWith('skill__')
          ? 2
          : 3,
    tokens: estimateToolTokens(tool, compactionOptions),
  }));

  scored.sort((a, b) => {
    const priorityDiff = a.priority - b.priority;
    if (priorityDiff !== 0) return priorityDiff;
    return a.tokens - b.tokens;
  });

  while (total > budgetTokens && scored.length > 0) {
    const last = scored[scored.length - 1];
    if (last.priority <= 1) break;
    scored.pop();
    total -= last.tokens;
  }

  return compressToolDefinitions(
    scored.map((entry) => entry.tool),
    compactionOptions,
  );
}

export function compressToolDescription(description: string): string {
  if (!description) return '';

  const sentences = description
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);

  const condensed = sentences.length <= 2 ? description.trim() : sentences.slice(0, 2).join(' ');

  return truncateGraphemesWithSuffix(condensed, TOOL_DESCRIPTION_CHARACTER_LIMIT, '...');
}

export function compressToolDescriptionMinimal(description: string): string {
  if (!description) return '';

  const firstSentence =
    description
      .split(/(?<=[.!?])\s+/)
      .map((sentence) => sentence.trim())
      .find(Boolean) ?? description.trim();

  return truncateGraphemesWithSuffix(
    firstSentence,
    MINIMAL_TOOL_DESCRIPTION_CHARACTER_LIMIT,
    '\u2026',
  );
}

function isPlainRecord(value: unknown): value is Record<string, any> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function compactSchemaMapForPrompt(value: unknown): unknown {
  if (!isPlainRecord(value)) {
    return value;
  }

  const compacted: Record<string, unknown> = {};
  for (const [key, entryValue] of Object.entries(value)) {
    compacted[key] = compactSchemaForPrompt(entryValue);
  }
  return compacted;
}

function compactSchemaForPrompt(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => compactSchemaForPrompt(entry));
  }

  if (!isPlainRecord(value)) {
    return value;
  }

  const compacted: Record<string, unknown> = {};
  for (const [key, entryValue] of Object.entries(value)) {
    if (key === 'properties' || key === '$defs' || key === 'definitions') {
      compacted[key] = compactSchemaMapForPrompt(entryValue);
      continue;
    }

    if (
      key === 'description' ||
      key === 'title' ||
      key === 'default' ||
      key === 'example' ||
      key === 'examples'
    ) {
      continue;
    }

    compacted[key] = compactSchemaForPrompt(entryValue);
  }

  return compacted;
}

function shouldUseMinimalToolDescription(
  tool: ToolDefinition,
  options?: CompactToolDefinitionOptions,
): boolean {
  if (CORE_TOOL_TOKEN_BUDGET_NAMES.has(tool.name)) {
    return false;
  }
  return !options?.pinnedToolNames?.has(tool.name);
}

export function compactToolDefinitionForPrompt(
  tool: ToolDefinition,
  options?: CompactToolDefinitionOptions,
): ToolDefinition {
  const compactedDescription = shouldUseMinimalToolDescription(tool, options)
    ? compressToolDescriptionMinimal(tool.description || '')
    : compressToolDescription(tool.description || '');
  const compactedSchema = compactSchemaForPrompt(tool.input_schema || {});
  const { contract: _contract, ...promptFacingTool } = tool;

  return {
    ...promptFacingTool,
    description: compactedDescription,
    input_schema: compactedSchema as ToolDefinition['input_schema'],
  };
}

export function compressToolDefinitions(
  tools: ToolDefinition[],
  options?: CompactToolDefinitionOptions,
): ToolDefinition[] {
  return tools.map((tool) => compactToolDefinitionForPrompt(tool, options));
}
