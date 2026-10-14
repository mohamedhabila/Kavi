import type { ToolDefinition } from '../../../types/tool';

function stableStringify(value: unknown): string {
  if (value === undefined) {
    return '"__undefined__"';
  }
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }

  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(',')}}`;
}

function fnv1a32(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

export function buildToolDeclarationDigest(tools: ReadonlyArray<ToolDefinition>): string {
  const material = tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema: tool.input_schema ?? null,
  }));
  return `tools-fnv1a32:${fnv1a32(stableStringify(material))}`;
}

/**
 * Stable-prefix tools first, then the rest, each in the order given: the turn surface lists
 * tools in the order the conversation first brought them in, so a newly added tool lands at
 * the end of its group instead of shifting every declaration after it.
 */
export function buildPromptCachingToolOrder(tools: ToolDefinition[]): {
  orderedTools: ToolDefinition[];
  lastStablePrefixIndex: number;
} {
  const hasExplicitPlacement = tools.some((tool) => tool.promptCache?.placement !== undefined);
  const stableTools = hasExplicitPlacement
    ? tools.filter((tool) => tool.promptCache?.placement === 'stable_prefix')
    : tools;
  const dynamicTools = hasExplicitPlacement
    ? tools.filter((tool) => tool.promptCache?.placement !== 'stable_prefix')
    : [];
  const orderedTools = [...stableTools, ...dynamicTools];

  return {
    orderedTools,
    lastStablePrefixIndex: stableTools.length - 1,
  };
}

export function reorderToolsForPromptCaching(tools: ToolDefinition[]): ToolDefinition[] {
  return buildPromptCachingToolOrder(tools).orderedTools;
}
