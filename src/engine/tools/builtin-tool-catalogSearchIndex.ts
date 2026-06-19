import { TOOL_CATALOG_CATEGORIES } from './builtin-tool-catalogConfig';
import { buildCapabilitySummary } from './builtin-tool-catalogCapabilitySummary';
import { getDynamicMcpCatalog, getDynamicSkillCatalog } from './builtin-tool-catalogDynamic';
import type {
  ExecuteToolCatalogOptions,
  ToolCatalogActivation,
  ToolCatalogDescribedTool,
  ToolCatalogSearchToolEntry,
} from './builtin-tool-catalogTypes';
import { buildToolSchemaDigest } from './builtin-tool-schemaDigest';
import { inferToolCapabilityDescriptor } from './capabilityRegistry';
import { TOOL_DEFINITIONS } from './definitions';
import { ALL_NATIVE_TOOL_DEFINITIONS } from './native/definitions';
import { buildSearchTokens } from './builtin-tool-catalogSearchTokens';

export type CatalogSearchableEntry = ToolCatalogSearchToolEntry & {
  searchTokens: ReadonlySet<string>;
  capabilityTokens: ReadonlySet<string>;
  resourceKindTokens: ReadonlySet<string>;
};

export const TOOL_CATALOG_ENTRY_SCHEMA_VERSION = 'tool-catalog-entry-v1';

export function buildToolCatalogActivation(
  toolName: string,
  options?: ExecuteToolCatalogOptions,
): ToolCatalogActivation {
  const callableNow = options?.availableToolNames ? options.availableToolNames.has(toolName) : true;
  return {
    name: toolName,
    eligible: true,
    callableNow,
    reason: callableNow ? 'callable_now' : 'discoverable',
  };
}

function buildStaticCatalogSearchEntries(
  staticToolMap: ReadonlyMap<string, ToolCatalogDescribedTool>,
  options?: ExecuteToolCatalogOptions,
): CatalogSearchableEntry[] {
  const entries: CatalogSearchableEntry[] = [];

  for (const [category, config] of Object.entries(TOOL_CATALOG_CATEGORIES)) {
    if (category === 'github') {
      continue;
    }

    for (const toolName of config.tools) {
      const tool = staticToolMap.get(toolName);
      if (!tool) {
        continue;
      }
      const descriptor = inferToolCapabilityDescriptor(tool);
      const capabilities = descriptor.capabilities;
      entries.push({
        name: tool.name,
        description: tool.description,
        category,
        source: 'built-in',
        schemaVersion: TOOL_CATALOG_ENTRY_SCHEMA_VERSION,
        schemaDigest: buildToolSchemaDigest(tool.input_schema),
        purpose: config.purpose,
        capabilitySummary: buildCapabilitySummary(tool),
        activation: buildToolCatalogActivation(tool.name, options),
        searchTokens: buildSearchTokens({
          name: tool.name,
          category,
          description: tool.description,
          capabilities,
          resourceKinds: descriptor.resourceKinds,
          sideEffects: descriptor.sideEffects,
          riskHints: descriptor.riskHints,
          providesEvidence: descriptor.providesEvidence,
          workflowStages: descriptor.workflowStages,
          produces: descriptor.produces,
          consumes: descriptor.consumes,
          precedes: descriptor.precedes,
          inputSchema: tool.input_schema,
        }),
        capabilityTokens: new Set(capabilities.map((capability) => capability.toLowerCase())),
        resourceKindTokens: new Set(
          descriptor.resourceKinds.map((resourceKind) => resourceKind.toLowerCase()),
        ),
      });
    }
  }

  return entries;
}

function buildDynamicCatalogSearchEntries(
  options?: ExecuteToolCatalogOptions,
): CatalogSearchableEntry[] {
  return [
    ...getDynamicMcpCatalog().tools.map((tool) => {
      const descriptor = inferToolCapabilityDescriptor(tool);
      const capabilities = descriptor.capabilities;
      return {
        name: tool.name,
        description: tool.description,
        category: descriptor.category,
        source: 'mcp' as const,
        schemaVersion: TOOL_CATALOG_ENTRY_SCHEMA_VERSION,
        ...(tool.schemaDigest ? { schemaDigest: tool.schemaDigest } : {}),
        serverName: tool.serverName,
        capabilitySummary: buildCapabilitySummary(tool),
        activation: buildToolCatalogActivation(tool.name, options),
        searchTokens: buildSearchTokens({
          name: tool.name,
          category: descriptor.category,
          serverName: tool.serverName,
          description: tool.description,
          capabilities,
          resourceKinds: descriptor.resourceKinds,
          sideEffects: descriptor.sideEffects,
          riskHints: descriptor.riskHints,
          providesEvidence: descriptor.providesEvidence,
          workflowStages: descriptor.workflowStages,
          produces: descriptor.produces,
          consumes: descriptor.consumes,
          precedes: descriptor.precedes,
        }),
        capabilityTokens: new Set(capabilities.map((capability) => capability.toLowerCase())),
        resourceKindTokens: new Set(
          descriptor.resourceKinds.map((resourceKind) => resourceKind.toLowerCase()),
        ),
      };
    }),
    ...getDynamicSkillCatalog().tools.map((tool) => {
      const descriptor = inferToolCapabilityDescriptor(tool);
      const capabilities = descriptor.capabilities;
      const skillName = tool.name.replace(/^skill__/, '').split('__')[0] || undefined;
      return {
        name: tool.name,
        description: tool.description,
        category: descriptor.category,
        source: 'skill' as const,
        schemaVersion: TOOL_CATALOG_ENTRY_SCHEMA_VERSION,
        ...(tool.schemaDigest ? { schemaDigest: tool.schemaDigest } : {}),
        skillName,
        capabilitySummary: buildCapabilitySummary(tool),
        activation: buildToolCatalogActivation(tool.name, options),
        searchTokens: buildSearchTokens({
          name: tool.name,
          category: descriptor.category,
          description: tool.description,
          capabilities,
          resourceKinds: descriptor.resourceKinds,
          sideEffects: descriptor.sideEffects,
          riskHints: descriptor.riskHints,
          providesEvidence: descriptor.providesEvidence,
          workflowStages: descriptor.workflowStages,
          produces: descriptor.produces,
          consumes: descriptor.consumes,
          precedes: descriptor.precedes,
        }),
        capabilityTokens: new Set(capabilities.map((capability) => capability.toLowerCase())),
        resourceKindTokens: new Set(
          descriptor.resourceKinds.map((resourceKind) => resourceKind.toLowerCase()),
        ),
      };
    }),
  ];
}

export function buildToolCatalogSearchIndex(
  options?: ExecuteToolCatalogOptions,
): CatalogSearchableEntry[] {
  const staticToolMap = new Map(
    [...TOOL_DEFINITIONS, ...ALL_NATIVE_TOOL_DEFINITIONS].map((tool) => [tool.name, tool]),
  );
  const dynamicEntries = buildDynamicCatalogSearchEntries(options);
  const githubEntries = dynamicEntries.filter((entry) => entry.category === 'github');
  const nonGithubEntries = dynamicEntries.filter((entry) => entry.category !== 'github');

  return [
    ...buildStaticCatalogSearchEntries(staticToolMap, options),
    ...githubEntries,
    ...nonGithubEntries,
  ];
}
