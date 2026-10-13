import { getSkillToolDefinitions } from '../../services/skills/manager';
import { getDynamicMcpToolDefinitions } from './builtin-tool-catalogDynamic';
import { buildToolCatalogActivation, isToolCatalogVisible } from './builtin-tool-catalogSearch';
import type {
  ExecuteToolCatalogOptions,
  ToolCatalogDescribedTool,
  ToolCatalogEntry,
} from './builtin-tool-catalogTypes';
import { buildToolSchemaDigest } from './builtin-tool-schemaDigest';
import { normalizeToolName } from './toolNameNormalization';
import { TOOL_DEFINITIONS } from './definitions';
import {
  completedToolOutcome,
  failedToolOutcome,
  type ToolRuntimeOutcome,
} from '../../types/toolRuntimeOutcome';
import { resolveMemoryPolicyVisibleToolNames } from './memoryPolicyCatalogVisibility';

export type ExecuteToolDescribeArgs = {
  name?: string;
};

function findDescribedTool(
  name: string,
): { tool: ToolCatalogDescribedTool; source: ToolCatalogEntry['source'] } | undefined {
  const sources: Array<[ToolCatalogEntry['source'], ReadonlyArray<ToolCatalogDescribedTool>]> = [
    ['built-in', TOOL_DEFINITIONS],
    ['mcp', Array.from(getDynamicMcpToolDefinitions().values())],
    ['skill', getSkillToolDefinitions()],
  ];
  for (const [source, tools] of sources) {
    const tool = tools.find((candidate) => normalizeToolName(candidate.name) === name);
    if (tool) return { tool, source };
  }
  return undefined;
}

/** A tool's description and input schema, for calling it with the right arguments. */
export async function executeToolDescribe(
  args: ExecuteToolDescribeArgs,
  options?: ExecuteToolCatalogOptions,
): Promise<ToolRuntimeOutcome> {
  const policyOptions: ExecuteToolCatalogOptions = {
    availableToolNames: resolveMemoryPolicyVisibleToolNames(options?.availableToolNames),
    visibleToolNames: resolveMemoryPolicyVisibleToolNames(options?.visibleToolNames),
  };
  const requestedName = typeof args.name === 'string' ? normalizeToolName(args.name) : '';
  if (!requestedName) {
    return failedToolOutcome(JSON.stringify({ error: 'tool_describe requires a non-empty name' }));
  }
  const found = isToolCatalogVisible(requestedName, policyOptions)
    ? findDescribedTool(requestedName)
    : undefined;
  if (!found) {
    return failedToolOutcome(JSON.stringify({ error: `Unknown tool: ${requestedName}` }));
  }
  const { tool, source } = found;
  return completedToolOutcome(
    JSON.stringify({
      mode: 'describe',
      tool: {
        name: tool.name,
        description: tool.description,
        source,
        ...(source === 'built-in'
          ? {}
          : { schemaDigest: buildToolSchemaDigest(tool.input_schema) }),
        input_schema: tool.input_schema,
        activation: buildToolCatalogActivation(tool.name, policyOptions),
      },
    }),
  );
}
