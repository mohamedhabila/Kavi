import { buildCapabilitySummary } from './builtin-tool-catalogCapabilitySummary';
import type { ExecuteToolCatalogOptions } from './builtin-tool-catalogTypes';
import {
  buildToolCatalogActivation,
  isToolCatalogVisible,
  searchToolCatalogEntries,
  TOOL_CATALOG_ENTRY_SCHEMA_VERSION,
} from './builtin-tool-catalogSearch';
import { buildToolSchemaDigest } from './builtin-tool-schemaDigest';
import { normalizeToolName } from './toolNameNormalization';
import { TOOL_DEFINITIONS } from './definitions';
import {
  completedToolOutcome,
  failedToolOutcome,
  type ToolRuntimeOutcome,
} from '../../types/toolRuntimeOutcome';

export type ExecuteToolDescribeArgs = {
  name?: string;
};

export async function executeToolDescribe(
  args: ExecuteToolDescribeArgs,
  options?: ExecuteToolCatalogOptions,
): Promise<ToolRuntimeOutcome> {
  const requestedName = typeof args.name === 'string' ? normalizeToolName(args.name) : '';
  if (!requestedName) {
    return failedToolOutcome(
      JSON.stringify({
        error: 'tool_describe requires a non-empty name',
      }),
    );
  }

  if (!isToolCatalogVisible(requestedName, options)) {
    return failedToolOutcome(
      JSON.stringify({
        error: `Unknown tool: ${requestedName}`,
      }),
    );
  }

  const registryTool = TOOL_DEFINITIONS.find(
    (tool) => normalizeToolName(tool.name) === requestedName,
  );
  if (registryTool) {
    return completedToolOutcome(
      JSON.stringify({
        mode: 'describe',
        tool: {
          name: registryTool.name,
          description: registryTool.description,
          source: 'built-in',
          schemaVersion: TOOL_CATALOG_ENTRY_SCHEMA_VERSION,
          schemaDigest: buildToolSchemaDigest(registryTool.input_schema),
          input_schema: registryTool.input_schema,
          contract: registryTool.contract,
          capabilitySummary: buildCapabilitySummary(registryTool),
          activation: buildToolCatalogActivation(registryTool.name, options),
        },
      }),
    );
  }

  const dynamicMatches = searchToolCatalogEntries({
    query: requestedName,
    options,
    limit: 5,
  }).filter((tool) => normalizeToolName(tool.name) === requestedName);

  const dynamicTool = dynamicMatches[0];
  if (!dynamicTool) {
    return failedToolOutcome(
      JSON.stringify({
        error: `Unknown tool: ${requestedName}`,
      }),
    );
  }

  return completedToolOutcome(
    JSON.stringify({
      mode: 'describe',
      tool: {
        name: dynamicTool.name,
        description: dynamicTool.description,
        category: dynamicTool.category,
        source: dynamicTool.source,
        schemaVersion: dynamicTool.schemaVersion,
        ...(dynamicTool.schemaDigest ? { schemaDigest: dynamicTool.schemaDigest } : {}),
        ...(dynamicTool.serverName ? { serverName: dynamicTool.serverName } : {}),
        ...(dynamicTool.skillName ? { skillName: dynamicTool.skillName } : {}),
        capabilitySummary: dynamicTool.capabilitySummary,
        activation: dynamicTool.activation,
      },
    }),
  );
}
