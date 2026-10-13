import type { ToolDefinition } from '../../types/tool';

export type ToolCatalogDescribedTool = Pick<
  ToolDefinition,
  'name' | 'description' | 'contract' | 'input_schema'
>;

/** One search result: enough to choose the tool; its full contract arrives once callable. */
export type ToolCatalogEntry = {
  name: string;
  description: string;
  source: 'built-in' | 'mcp' | 'skill';
  /** For MCP and skill tools: lets activation confirm the definition has not changed since. */
  schemaDigest?: string;
  activation: {
    name: string;
    eligible: true;
    callableNow: boolean;
  };
};

export type ToolCatalogMcpServerTool = {
  name: string;
  displayName: string;
  description: string;
  schemaDigest?: string;
};

export type ToolCatalogMcpServer = {
  id: string;
  name: string;
  toolCount: number;
  tools: ToolCatalogMcpServerTool[];
};

export type ToolCatalogPendingMcpServer = {
  id: string;
  name: string;
  state: string;
  authRequired: boolean;
};

export type ToolCatalogMcpCatalogTool = ToolCatalogMcpServerTool & {
  serverId: string;
  serverName: string;
  schemaDigest?: string;
};

export type ToolCatalogMcpCatalog = {
  servers: ToolCatalogMcpServer[];
  pendingServers: ToolCatalogPendingMcpServer[];
  tools: ToolCatalogMcpCatalogTool[];
};

export type ToolCatalogSkill = {
  id: string;
  name: string;
  description: string;
  invocationPolicy: string;
  location: string;
};

export type ToolCatalogSkillTool = {
  name: string;
  description: string;
  schemaDigest?: string;
};

export type ToolCatalogSkillCatalog = {
  skills: ToolCatalogSkill[];
  tools: ToolCatalogSkillTool[];
};

export type ExecuteToolCatalogArgs = {
  query?: string;
};

export type ExecuteToolCatalogOptions = {
  availableToolNames?: ReadonlySet<string>;
  visibleToolNames?: ReadonlySet<string>;
};
