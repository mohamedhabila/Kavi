import { buildCapabilitySummary } from './builtin-tool-catalogCapabilitySummary';
import type { ExecuteToolCatalogOptions } from './builtin-tool-catalogTypes';
import {
  buildToolCatalogActivation,
  searchToolCatalogEntries,
  TOOL_CATALOG_ENTRY_SCHEMA_VERSION,
} from './builtin-tool-catalogSearch';
import { buildToolSchemaDigest } from './builtin-tool-schemaDigest';
import { normalizeToolName } from './toolNameNormalization';
import { TOOL_DEFINITIONS } from './definitions';

export type ExecuteToolDescribeArgs = {
  name?: string;
};

export async function executeToolDescribe(
  args: ExecuteToolDescribeArgs,
  options?: ExecuteToolCatalogOptions,
): Promise<string> {
  const requestedName = typeof args.name === 'string' ? normalizeToolName(args.name) : '';
  if (!requestedName) {
    return JSON.stringify({
      error: 'tool_describe requires a non-empty name',
    });
  }

  const registryTool = TOOL_DEFINITIONS.find(
    (tool) => normalizeToolName(tool.name) === requestedName,
  );
  if (registryTool) {
    return JSON.stringify({
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
    });
  }

  const dynamicMatches = searchToolCatalogEntries({
    query: requestedName,
    options,
    limit: 5,
  }).filter((tool) => normalizeToolName(tool.name) === requestedName);

  const dynamicTool = dynamicMatches[0];
  if (!dynamicTool) {
    return JSON.stringify({
      error: `Unknown tool: ${requestedName}`,
    });
  }

  return JSON.stringify({
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
  });
}
