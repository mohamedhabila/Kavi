import { TOOL_CATALOG_CATEGORIES } from './builtin-tool-catalogConfig';
import {
  buildToolCatalogGithubCategoryResponse,
  buildToolCatalogInvalidCategoryResponse,
  buildToolCatalogMcpCategoryResponse,
  buildToolCatalogOverviewResponse,
  buildToolCatalogSkillsCategoryResponse,
  buildToolCatalogStaticCategoryResponse,
} from './builtin-tool-catalogBrowseExecution';
import { inferToolCapabilityDescriptor } from './capabilityRegistry';
import { buildCapabilitySummary } from './builtin-tool-catalogCapabilitySummary';
import { getDynamicMcpCatalog, getDynamicSkillCatalog } from './builtin-tool-catalogDynamic';
import {
  buildToolCatalogActivation,
  buildToolCatalogSearchResponse,
  resolveToolCatalogCategoryName,
  TOOL_CATALOG_ENTRY_SCHEMA_VERSION,
} from './builtin-tool-catalogSearch';
import type {
  ExecuteToolCatalogArgs,
  ExecuteToolCatalogOptions,
  ToolCatalogMcpCatalog,
  ToolCatalogSkillCatalog,
} from './builtin-tool-catalogTypes';
import { TOOL_DEFINITIONS } from './definitions';
import { ALL_NATIVE_TOOL_DEFINITIONS } from './native/definitions';
import {
  completedToolOutcome,
  failedToolOutcome,
  type ToolRuntimeOutcome,
} from '../../types/toolRuntimeOutcome';
import { resolveMemoryPolicyVisibleToolNames } from './memoryPolicyCatalogVisibility';

function hasCatalogSearchArgs(args: ExecuteToolCatalogArgs): boolean {
  const query = typeof args.query === 'string' ? args.query.trim() : '';
  const capabilities = Array.isArray(args.capabilities)
    ? args.capabilities.filter(
        (capability) => typeof capability === 'string' && capability.trim().length > 0,
      )
    : [];
  return query.length > 0 || capabilities.length > 0;
}

function filterMcpCatalog(
  catalog: ToolCatalogMcpCatalog,
  visibleToolNames: ReadonlySet<string> | undefined,
): ToolCatalogMcpCatalog {
  if (!visibleToolNames) return catalog;
  const servers = catalog.servers.map((server) => {
    const tools = server.tools.filter((tool) => visibleToolNames.has(tool.name));
    return { ...server, toolCount: tools.length, tools };
  });
  return {
    ...catalog,
    servers,
    tools: catalog.tools.filter((tool) => visibleToolNames.has(tool.name)),
  };
}

function filterSkillCatalog(
  catalog: ToolCatalogSkillCatalog,
  visibleToolNames: ReadonlySet<string> | undefined,
): ToolCatalogSkillCatalog {
  if (!visibleToolNames) return catalog;
  return {
    ...catalog,
    tools: catalog.tools.filter((tool) => visibleToolNames.has(tool.name)),
  };
}

function getGithubCapabilityTools(options: {
  mcpCatalog: ReturnType<typeof getDynamicMcpCatalog>;
  skillCatalog: ReturnType<typeof getDynamicSkillCatalog>;
  availableToolNames?: ReadonlySet<string>;
  visibleToolNames?: ReadonlySet<string>;
}) {
  const githubMcpTools = options.mcpCatalog.tools
    .filter((tool) => options.visibleToolNames?.has(tool.name) ?? true)
    .filter((tool) => inferToolCapabilityDescriptor(tool).category === 'github')
    .map((tool) => ({
      name: tool.name,
      description: tool.description,
      category: 'github' as const,
      source: 'mcp' as const,
      schemaVersion: TOOL_CATALOG_ENTRY_SCHEMA_VERSION,
      purpose: TOOL_CATALOG_CATEGORIES.github.purpose,
      serverName: tool.serverName,
      capabilitySummary: buildCapabilitySummary(tool),
      activation: buildToolCatalogActivation(tool.name, {
        availableToolNames: options.availableToolNames,
      }),
    }));

  const githubSkillTools = options.skillCatalog.tools
    .filter((tool) => options.visibleToolNames?.has(tool.name) ?? true)
    .filter((tool) => inferToolCapabilityDescriptor(tool).category === 'github')
    .map((tool) => ({
      name: tool.name,
      description: tool.description,
      category: 'github' as const,
      source: 'skill' as const,
      schemaVersion: TOOL_CATALOG_ENTRY_SCHEMA_VERSION,
      purpose: TOOL_CATALOG_CATEGORIES.github.purpose,
      skillName: tool.name.replace(/^skill__/, '').split('__')[0] || undefined,
      capabilitySummary: buildCapabilitySummary(tool),
      activation: buildToolCatalogActivation(tool.name, {
        availableToolNames: options.availableToolNames,
      }),
    }));

  return [...githubMcpTools, ...githubSkillTools];
}
export async function executeToolCatalog(
  args: ExecuteToolCatalogArgs,
  options?: ExecuteToolCatalogOptions,
): Promise<ToolRuntimeOutcome> {
  const availableToolNames = resolveMemoryPolicyVisibleToolNames(options?.availableToolNames);
  const visibleToolNames = resolveMemoryPolicyVisibleToolNames(options?.visibleToolNames);
  const staticVisibleTools = [...TOOL_DEFINITIONS, ...ALL_NATIVE_TOOL_DEFINITIONS].filter(
    (tool) => visibleToolNames?.has(tool.name) ?? true,
  );
  const mcpCatalog = filterMcpCatalog(getDynamicMcpCatalog(), visibleToolNames);
  const skillCatalog = filterSkillCatalog(getDynamicSkillCatalog(), visibleToolNames);
  const rawRequestedCategory =
    typeof args.category === 'string' ? args.category.trim().toLowerCase() : undefined;
  const requestedCategory =
    resolveToolCatalogCategoryName(rawRequestedCategory) ?? rawRequestedCategory;
  const staticToolMap = new Map(staticVisibleTools.map((tool) => [tool.name, tool]));
  const githubCapabilityTools = getGithubCapabilityTools({
    mcpCatalog,
    skillCatalog,
    availableToolNames,
    visibleToolNames,
  });

  if (hasCatalogSearchArgs(args)) {
    return completedToolOutcome(
      buildToolCatalogSearchResponse({
        query: args.query,
        capabilities: args.capabilities,
        category: requestedCategory,
        options: { availableToolNames, visibleToolNames },
      }),
    );
  }

  if (
    requestedCategory &&
    !TOOL_CATALOG_CATEGORIES[requestedCategory] &&
    requestedCategory !== 'mcp' &&
    requestedCategory !== 'skills'
  ) {
    return failedToolOutcome(buildToolCatalogInvalidCategoryResponse(args.category));
  }

  if (requestedCategory === 'mcp') {
    return completedToolOutcome(
      buildToolCatalogMcpCategoryResponse({ mcpCatalog, availableToolNames }),
    );
  }

  if (requestedCategory === 'skills') {
    return completedToolOutcome(
      buildToolCatalogSkillsCategoryResponse({ skillCatalog, availableToolNames }),
    );
  }

  if (requestedCategory === 'github') {
    return completedToolOutcome(buildToolCatalogGithubCategoryResponse({ githubCapabilityTools }));
  }

  if (requestedCategory) {
    return completedToolOutcome(
      buildToolCatalogStaticCategoryResponse({
        requestedCategory,
        staticToolMap,
        availableToolNames,
      }),
    );
  }

  return completedToolOutcome(
    buildToolCatalogOverviewResponse({
      staticToolMap,
      availableToolNames,
      staticVisibleToolCount: staticVisibleTools.length,
      mcpCatalog,
      skillCatalog,
      githubCapabilityTools,
    }),
  );
}
