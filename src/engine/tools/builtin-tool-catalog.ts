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
} from './builtin-tool-catalogTypes';
import { TOOL_DEFINITIONS } from './definitions';
import { ALL_NATIVE_TOOL_DEFINITIONS } from './native/definitions';

function hasCatalogSearchArgs(args: ExecuteToolCatalogArgs): boolean {
  const query = typeof args.query === 'string' ? args.query.trim() : '';
  const capabilities = Array.isArray(args.capabilities)
    ? args.capabilities.filter(
        (capability) => typeof capability === 'string' && capability.trim().length > 0,
      )
    : [];
  return query.length > 0 || capabilities.length > 0;
}

function getGithubCapabilityTools(options: {
  mcpCatalog: ReturnType<typeof getDynamicMcpCatalog>;
  skillCatalog: ReturnType<typeof getDynamicSkillCatalog>;
  availableToolNames?: ReadonlySet<string>;
}) {
  const githubMcpTools = options.mcpCatalog.tools
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
): Promise<string> {
  const availableToolNames = options?.availableToolNames;
  const staticVisibleTools = [...TOOL_DEFINITIONS, ...ALL_NATIVE_TOOL_DEFINITIONS];
  const mcpCatalog = getDynamicMcpCatalog();
  const skillCatalog = getDynamicSkillCatalog();
  const rawRequestedCategory =
    typeof args.category === 'string' ? args.category.trim().toLowerCase() : undefined;
  const requestedCategory = resolveToolCatalogCategoryName(rawRequestedCategory) ?? rawRequestedCategory;
  const staticToolMap = new Map(staticVisibleTools.map((tool) => [tool.name, tool]));
  const githubCapabilityTools = getGithubCapabilityTools({
    mcpCatalog,
    skillCatalog,
    availableToolNames,
  });

  if (hasCatalogSearchArgs(args)) {
    return buildToolCatalogSearchResponse({
      query: args.query,
      capabilities: args.capabilities,
      category: requestedCategory,
      options: { availableToolNames },
    });
  }

  if (
    requestedCategory &&
    !TOOL_CATALOG_CATEGORIES[requestedCategory] &&
    requestedCategory !== 'mcp' &&
    requestedCategory !== 'skills'
  ) {
    return buildToolCatalogInvalidCategoryResponse(args.category);
  }

  if (requestedCategory === 'mcp') {
    return buildToolCatalogMcpCategoryResponse({ mcpCatalog, availableToolNames });
  }

  if (requestedCategory === 'skills') {
    return buildToolCatalogSkillsCategoryResponse({ skillCatalog, availableToolNames });
  }

  if (requestedCategory === 'github') {
    return buildToolCatalogGithubCategoryResponse({ githubCapabilityTools });
  }

  if (requestedCategory) {
    return buildToolCatalogStaticCategoryResponse({
      requestedCategory,
      staticToolMap,
      availableToolNames,
    });
  }

  return buildToolCatalogOverviewResponse({
    staticToolMap,
    availableToolNames,
    staticVisibleToolCount: staticVisibleTools.length,
    mcpCatalog,
    skillCatalog,
    githubCapabilityTools,
  });
}
