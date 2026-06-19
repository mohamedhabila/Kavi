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

function compareToolNames(left: ToolDefinition, right: ToolDefinition): number {
  return left.name.localeCompare(right.name);
}

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
  const orderedTools = [
    ...[...stableTools].sort(compareToolNames),
    ...[...dynamicTools].sort(compareToolNames),
  ];

  return {
    orderedTools,
    lastStablePrefixIndex: stableTools.length - 1,
  };
}

export function reorderToolsForPromptCaching(tools: ToolDefinition[]): ToolDefinition[] {
  return buildPromptCachingToolOrder(tools).orderedTools;
}
