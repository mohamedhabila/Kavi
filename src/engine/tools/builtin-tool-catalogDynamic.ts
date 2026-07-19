import { mcpManager } from '../../services/mcp/manager';
import {
  getSkillToolDefinitions,
  isSkillCompatible,
  useSkillsStore,
} from '../../services/skills/manager';
import type { SkillEntry } from '../../services/skills/types';
import { buildToolSchemaDigest } from './builtin-tool-schemaDigest';
import type {
  ToolCatalogDescribedTool,
  ToolCatalogMcpCatalog,
  ToolCatalogSkillCatalog,
} from './builtin-tool-catalogTypes';

function slugifyCatalogValue(value: string | undefined): string {
  const normalized = (value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized || 'skill';
}

function getSkillCatalogLocation(entry: SkillEntry): string {
  const managedDir =
    entry.source.managedDir ||
    `${slugifyCatalogValue(entry.metadata.name)}-${slugifyCatalogValue(entry.source.id || entry.id)}`;
  return `skills/${managedDir}/SKILL.md`;
}

function hasDynamicMcpToolDefinitionSource(): boolean {
  return (
    typeof (
      mcpManager as {
        getAllToolDefinitions?: () => ToolCatalogDescribedTool[];
      }
    ).getAllToolDefinitions === 'function'
  );
}

export function getDynamicMcpToolDefinitions(): ReadonlyMap<string, ToolCatalogDescribedTool> {
  const getAllToolDefinitions = (
    mcpManager as {
      getAllToolDefinitions?: () => ToolCatalogDescribedTool[];
    }
  ).getAllToolDefinitions;
  return new Map(
    typeof getAllToolDefinitions === 'function'
      ? getAllToolDefinitions.call(mcpManager).map((tool) => [tool.name, tool])
      : [],
  );
}

export function getDynamicMcpCatalog(): ToolCatalogMcpCatalog {
  const statuses = mcpManager.getAllStatuses();
  const definitionByName = getDynamicMcpToolDefinitions();
  const definitionNames = hasDynamicMcpToolDefinitionSource()
    ? new Set(definitionByName.keys())
    : null;
  const isToolVisible = (toolName: string): boolean => {
    if (definitionNames && !definitionNames.has(toolName)) {
      return false;
    }
    return true;
  };
  const servers = statuses
    .filter((status) => status.state === 'connected')
    .map((status) => {
      const tools = status.tools
        .map((tool) => ({
          name: `mcp__${status.id}__${tool.name}`,
          displayName: tool.name,
          description: tool.description ?? tool.name,
          schemaDigest: buildToolSchemaDigest(
            definitionByName.get(`mcp__${status.id}__${tool.name}`)?.input_schema ??
              (tool as { inputSchema?: unknown }).inputSchema,
          ),
        }))
        .filter((tool) => isToolVisible(tool.name));

      return {
        id: status.id,
        name: status.name,
        toolCount: tools.length,
        tools,
      };
    });
  const pendingServers = statuses
    .filter((status) => status.state !== 'connected')
    .map((status) => ({
      id: status.id,
      name: status.name,
      state: status.state,
      authRequired: status.authRequired === true,
    }));
  const tools = servers.flatMap((server) =>
    server.tools.map((tool) => ({
      ...tool,
      serverId: server.id,
      serverName: server.name,
    })),
  );

  return { servers, pendingServers, tools };
}

export function getDynamicSkillCatalog(): ToolCatalogSkillCatalog {
  const tools = getSkillToolDefinitions().map((tool) => ({
    name: tool.name,
    description: tool.description ?? tool.name,
    schemaDigest: buildToolSchemaDigest(tool.input_schema),
  }));
  const skills = useSkillsStore
    .getState()
    .getEnabled()
    .filter((entry) => entry.metadata && isSkillCompatible(entry.metadata).compatible)
    .map((entry) => ({
      id: entry.id,
      name: entry.metadata.name,
      description: entry.metadata.description || 'No description provided.',
      invocationPolicy: entry.metadata.invocationPolicy || 'auto',
      location: getSkillCatalogLocation(entry),
    }));

  return { skills, tools };
}
