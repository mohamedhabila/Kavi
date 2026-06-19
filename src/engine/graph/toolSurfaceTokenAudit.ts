import type { ToolDefinition } from '../../types/tool';
import {
  estimateAllToolTokens,
  type CompactToolDefinitionOptions,
} from '../tools/toolManagerTokenBudget';

export interface ToolSurfaceTokenAudit {
  selectedCount: number;
  estimatedTokens: number;
  evictedToolNames: string[];
  sessionPinnedCount: number;
  turnPinnedCount: number;
}

export function buildToolSurfaceTokenAudit(params: {
  candidateTools: ReadonlyArray<ToolDefinition>;
  retainedTools: ReadonlyArray<ToolDefinition>;
  compactionOptions?: CompactToolDefinitionOptions;
  sessionPinnedCount?: number;
  turnPinnedCount?: number;
}): ToolSurfaceTokenAudit {
  const retainedNames = new Set(params.retainedTools.map((tool) => tool.name));
  const evictedToolNames = params.candidateTools
    .map((tool) => tool.name)
    .filter((name) => !retainedNames.has(name));

  return {
    selectedCount: params.retainedTools.length,
    estimatedTokens: estimateAllToolTokens([...params.retainedTools], params.compactionOptions),
    evictedToolNames,
    sessionPinnedCount: Math.max(0, params.sessionPinnedCount ?? 0),
    turnPinnedCount: Math.max(0, params.turnPinnedCount ?? 0),
  };
}
