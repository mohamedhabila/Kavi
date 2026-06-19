import {
  TOOL_CATALOG_AVAILABLE_CATEGORIES,
  TOOL_CATALOG_CATEGORIES,
} from './builtin-tool-catalogConfig';
import { buildCapabilitySummary } from './builtin-tool-catalogCapabilitySummary';
import {
  buildToolCatalogActivation,
  TOOL_CATALOG_ENTRY_SCHEMA_VERSION,
} from './builtin-tool-catalogSearch';
import { buildToolSchemaDigest } from './builtin-tool-schemaDigest';
import type {
  ToolCatalogDescribedTool,
  ToolCatalogMcpCatalog,
  ToolCatalogSearchToolEntry,
  ToolCatalogSkillCatalog,
} from './builtin-tool-catalogTypes';

type ToolCatalogStaticCategoryParams = {
  requestedCategory: string;
  staticToolMap: ReadonlyMap<string, ToolCatalogDescribedTool>;
  availableToolNames?: ReadonlySet<string>;
};

type ToolCatalogOverviewParams = {
  staticToolMap: ReadonlyMap<string, ToolCatalogDescribedTool>;
  availableToolNames?: ReadonlySet<string>;
  staticVisibleToolCount: number;
  mcpCatalog: ToolCatalogMcpCatalog;
  skillCatalog: ToolCatalogSkillCatalog;
  githubCapabilityTools: ToolCatalogSearchToolEntry[];
};

function sampleTools(toolNames: string[], max = 3) {
  return toolNames.slice(0, max);
}

export function buildToolCatalogInvalidCategoryResponse(category: string | undefined): string {
  return JSON.stringify({
    error: `Unknown tool_catalog category: ${category}`,
    availableCategories: TOOL_CATALOG_AVAILABLE_CATEGORIES,
  });
}

export function buildToolCatalogMcpCategoryResponse(params: {
  mcpCatalog: ToolCatalogMcpCatalog;
  availableToolNames?: ReadonlySet<string>;
}): string {
  return JSON.stringify({
    mode: 'category',
    category: 'mcp',
    servers: params.mcpCatalog.servers,
    pendingServers: params.mcpCatalog.pendingServers,
    tools: params.mcpCatalog.tools.map((tool) => ({
      ...tool,
      schemaVersion: TOOL_CATALOG_ENTRY_SCHEMA_VERSION,
      ...(tool.schemaDigest ? { schemaDigest: tool.schemaDigest } : {}),
      activation: buildToolCatalogActivation(tool.name, {
        availableToolNames: params.availableToolNames,
      }),
    })),
  });
}

export function buildToolCatalogSkillsCategoryResponse(params: {
  skillCatalog: ToolCatalogSkillCatalog;
  availableToolNames?: ReadonlySet<string>;
}): string {
  return JSON.stringify({
    mode: 'category',
    category: 'skills',
    skills: params.skillCatalog.skills,
    tools: params.skillCatalog.tools.map((tool) => ({
      ...tool,
      schemaVersion: TOOL_CATALOG_ENTRY_SCHEMA_VERSION,
      ...(tool.schemaDigest ? { schemaDigest: tool.schemaDigest } : {}),
      activation: buildToolCatalogActivation(tool.name, {
        availableToolNames: params.availableToolNames,
      }),
    })),
  });
}

export function buildToolCatalogGithubCategoryResponse(params: {
  githubCapabilityTools: ToolCatalogSearchToolEntry[];
}): string {
  return JSON.stringify({
    mode: 'category',
    category: 'github',
    purpose: TOOL_CATALOG_CATEGORIES.github.purpose,
    tools: params.githubCapabilityTools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      source: tool.source,
      schemaVersion: tool.schemaVersion,
      ...(tool.schemaDigest ? { schemaDigest: tool.schemaDigest } : {}),
      ...(tool.serverName ? { serverName: tool.serverName } : {}),
      ...(tool.skillName ? { skillName: tool.skillName } : {}),
      capabilitySummary: tool.capabilitySummary,
      activation: tool.activation,
    })),
  });
}

export function buildToolCatalogStaticCategoryResponse(
  params: ToolCatalogStaticCategoryParams,
): string {
  const selectedCategory = TOOL_CATALOG_CATEGORIES[params.requestedCategory];
  const names = selectedCategory.tools;
  const tools = names
    .map((name) => params.staticToolMap.get(name))
    .filter((tool): tool is ToolCatalogDescribedTool => Boolean(tool));
  return JSON.stringify({
    mode: 'category',
    category: params.requestedCategory,
    purpose: selectedCategory.purpose,
    tools: tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      schemaVersion: TOOL_CATALOG_ENTRY_SCHEMA_VERSION,
      schemaDigest: buildToolSchemaDigest(tool.input_schema),
      capabilitySummary: buildCapabilitySummary(tool),
      activation: buildToolCatalogActivation(tool.name, {
        availableToolNames: params.availableToolNames,
      }),
    })),
  });
}

export function buildToolCatalogOverviewResponse(params: ToolCatalogOverviewParams): string {
  const catalog: Array<{
    category: string;
    count: number;
    sampleTools: string[];
    skills?: string[];
  }> = Object.entries(TOOL_CATALOG_CATEGORIES)
    .map(([category, config]) => ({
      category,
      count: category === 'github' ? params.githubCapabilityTools.length : config.tools.length,
      sampleTools:
        category === 'github'
          ? sampleTools(params.githubCapabilityTools.map((tool) => tool.name))
          : sampleTools(config.tools),
    }))
    .filter((entry) => entry.count > 0);
  if (params.mcpCatalog.servers.length > 0 || params.mcpCatalog.pendingServers.length > 0) {
    catalog.push({
      category: 'mcp',
      count: params.mcpCatalog.tools.length,
      sampleTools: sampleTools(params.mcpCatalog.tools.map((tool) => tool.name)),
    });
  }
  if (params.skillCatalog.skills.length > 0 || params.skillCatalog.tools.length > 0) {
    catalog.push({
      category: 'skills',
      count: params.skillCatalog.skills.length,
      sampleTools: sampleTools(params.skillCatalog.tools.map((tool) => tool.name)),
      skills: params.skillCatalog.skills.map((skill) => skill.name),
    });
  }

  return JSON.stringify({
    mode: 'overview',
    categories: catalog,
    totalTools:
      params.staticVisibleToolCount +
      params.mcpCatalog.tools.length +
      params.skillCatalog.tools.length,
    totalMcpTools: params.mcpCatalog.tools.length,
    totalSkills: params.skillCatalog.skills.length,
    totalSkillTools: params.skillCatalog.tools.length,
    discoverability: {
      registry: 'full',
      currentCallableToolCount: params.availableToolNames?.size ?? null,
    },
  });
}
