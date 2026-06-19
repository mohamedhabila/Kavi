import type { ToolDefinition } from '../../types/tool';

export type ToolCatalogDescribedTool = Pick<
  ToolDefinition,
  'name' | 'description' | 'contract' | 'input_schema'
>;

export type ToolCatalogCategoryConfig = {
  tools: string[];
  purpose: string;
};

export type ToolCatalogCapabilitySummary = {
  capabilities: string[];
  resourceKinds: string[];
  sideEffects: string[];
  providesEvidence: string[];
  workflowStages: string[];
  produces: Array<{ kind: string; field?: string }>;
  consumes: Array<{ kind: string; field?: string; required?: boolean }>;
  precedes: string[];
  requiresPermissionEvidence: string[];
};

export type ToolCatalogActivation = {
  name: string;
  eligible: boolean;
  callableNow: boolean;
  reason: 'discoverable' | 'callable_now';
};

export type ToolCatalogSearchToolEntry = {
  name: string;
  description: string;
  category: string;
  source: 'built-in' | 'mcp' | 'skill';
  schemaVersion: string;
  schemaDigest?: string;
  purpose?: string;
  serverName?: string;
  skillName?: string;
  capabilitySummary?: ToolCatalogCapabilitySummary;
  activation: ToolCatalogActivation;
};

export type ToolCatalogSearchSkillEntry = {
  id: string;
  name: string;
  description: string;
  invocationPolicy: string;
  location: string;
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
  category?: string;
  query?: string;
  capabilities?: string[];
};

export type ExecuteToolCatalogOptions = {
  availableToolNames?: ReadonlySet<string>;
};
