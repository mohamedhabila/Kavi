// ---------------------------------------------------------------------------
// Kavi — MCP Tool Bridge
// ---------------------------------------------------------------------------
// Converts MCP tool schemas to Kavi tool definitions and routes calls

import { McpClient, McpToolInfo, McpToolCallResult } from './client';
import type { ToolDefinition } from '../../types/tool';
import { normalizeToolInputSchema } from '../../utils/toolSchema';
import { truncateGraphemesTo } from '../../utils/graphemes';
import {
  addRemoteArtifact,
  closeRemoteSession,
  openRemoteSession,
  startRemoteJob,
  updateRemoteJob,
} from '../remote/store';
import {
  completedToolOutcome,
  failedToolOutcome,
  type ToolRuntimeOutcome,
} from '../../types/toolRuntimeOutcome';

export interface McpToolEntry {
  serverId: string;
  serverName: string;
  tool: McpToolInfo;
  trustToolAnnotations?: boolean;
}

function isPlainRecord(value: unknown): value is Record<string, any> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeMcpInputSchema(schema: unknown): ToolDefinition['input_schema'] {
  return normalizeToolInputSchema(schema);
}

function buildTrustedMcpContract(
  annotations: NonNullable<McpToolInfo['annotations']>,
): NonNullable<ToolDefinition['contract']> {
  const readOnly = annotations.readOnlyHint === true;
  const destructive = !readOnly && annotations.destructiveHint !== false;
  const riskHints = [
    'trusted_metadata',
    ...(readOnly ? ['read_only'] : []),
    ...(destructive ? ['destructive'] : []),
    ...(!readOnly && annotations.idempotentHint === true ? ['idempotent'] : []),
    ...(annotations.openWorldHint === true ? ['open_world'] : []),
  ];

  return {
    category: 'mcp',
    capabilities: [readOnly ? 'read' : 'write'],
    resourceKinds: ['unknown'],
    sideEffects: readOnly ? ['none'] : [destructive ? 'destructive' : 'remote_mutation'],
    riskHints,
    workflowStages: [readOnly ? 'inspect_resource' : 'mutate_remote_state'],
  };
}

export interface McpToolExecutionOptions {
  isToolAllowed?: (serverId: string, toolName: string) => boolean;
  signal?: AbortSignal;
}

/**
 * Convert an MCP tool schema to a Kavi ToolDefinition
 */
export function mcpToolToDefinition(entry: McpToolEntry): ToolDefinition {
  const schema = normalizeMcpInputSchema(entry.tool.inputSchema);
  const annotations = entry.trustToolAnnotations ? entry.tool.annotations : undefined;
  const contract = annotations ? buildTrustedMcpContract(annotations) : undefined;
  return {
    name: `mcp__${entry.serverId}__${entry.tool.name}`,
    description: `[${entry.serverName}] ${entry.tool.description ?? entry.tool.name}`,
    input_schema: schema,
    ...(contract ? { contract } : {}),
  };
}

const MAX_INTEGRATION_NAME_GRAPHEMES = 40;
const INTEGRATION_NAME_PREFIX = /^\[([^\]\n]+)\] /u;

/** The integration's name, which mcpToolToDefinition puts at the head of every description. */
export function readMcpIntegrationName(description: string): string | undefined {
  const name = INTEGRATION_NAME_PREFIX.exec(description)?.[1]?.replace(/\s+/gu, ' ').trim();
  return name ? truncateGraphemesTo(name, MAX_INTEGRATION_NAME_GRAPHEMES) : undefined;
}

/**
 * Parse an MCP tool name back to server ID and tool name
 */
export function parseMcpToolName(fullName: string): { serverId: string; toolName: string } | null {
  const match = fullName.match(/^mcp__([^_]+(?:_[^_]+)*)__(.+)$/);
  if (!match) return null;
  return { serverId: match[1], toolName: match[2] };
}

/**
 * Format MCP tool call result as a string for the LLM
 */
export function formatMcpResult(result: McpToolCallResult): string {
  const parts: string[] = [];

  for (const content of result.content) {
    switch (content.type) {
      case 'text':
        if (content.text) parts.push(content.text);
        break;
      case 'image':
        parts.push(`[Image: ${content.mimeType ?? 'image/png'}]`);
        break;
      case 'resource':
        if (content.resource?.text) {
          parts.push(content.resource.text);
        } else {
          parts.push(`[Resource: ${content.resource?.uri ?? 'unknown'}]`);
        }
        break;
    }
  }

  const text = parts.join('\n\n');
  if (result.isError) {
    return `Error: ${text}`;
  }
  return text;
}

/**
 * Route an MCP tool call to the correct server. A refusal before the call is sent, and an
 * error the server reports (`isError`), carry a failure kind: their outcome is known, so the
 * model reads the error and recovers, as the MCP spec intends. A call that threw after it
 * may have been sent (a timeout, a dropped connection) carries none: its effect is unknown.
 */
export async function executeMcpTool(
  clients: Map<string, McpClient>,
  fullToolName: string,
  argsString: string,
  options?: McpToolExecutionOptions,
): Promise<ToolRuntimeOutcome> {
  const parsed = parseMcpToolName(fullToolName);
  if (!parsed) {
    return failedToolOutcome(`Error: invalid MCP tool name: ${fullToolName}`, 'unknown_tool');
  }

  if (options?.isToolAllowed && !options.isToolAllowed(parsed.serverId, parsed.toolName)) {
    return failedToolOutcome(
      `Error: MCP tool "${parsed.toolName}" is not allowed for server "${parsed.serverId}"`,
      'tool_filter',
    );
  }

  const client = clients.get(parsed.serverId);
  if (!client) {
    return failedToolOutcome(`Error: MCP server "${parsed.serverId}" not connected`, 'unavailable');
  }

  if (!client.isConnected()) {
    return failedToolOutcome(
      `Error: MCP server "${parsed.serverId}" is disconnected`,
      'unavailable',
    );
  }

  let args: Record<string, unknown>;
  try {
    const parsedArgs = JSON.parse(argsString);
    if (!isPlainRecord(parsedArgs)) {
      return failedToolOutcome(
        'Error: MCP tool arguments must be a JSON object',
        'invalid_arguments',
      );
    }
    args = parsedArgs;
  } catch {
    return failedToolOutcome('Error: invalid tool arguments JSON', 'invalid_arguments');
  }

  const jobId = startRemoteJob({
    jobType: 'mcp-job',
    targetId: parsed.serverId,
    providerId: parsed.serverId,
    status: 'running',
    requestedBy: 'agent',
    executionSurface: 'mcp',
    summary: `${parsed.serverId} · ${parsed.toolName}`,
    progressText: 'Calling MCP tool',
  });
  const sessionId = openRemoteSession({
    targetId: parsed.serverId,
    providerId: parsed.serverId,
    kind: 'mcp-operation-stream',
    status: 'connected',
    summary: `${parsed.toolName} in progress`,
    reconnectable: false,
  });

  try {
    const result = await client.callTool(parsed.toolName, args, options?.signal);
    const formatted = formatMcpResult(result);
    updateRemoteJob(jobId, {
      status: result.isError ? 'failed' : 'completed',
      progressText: result.isError ? 'Tool returned an error' : 'Tool completed',
      error: result.isError ? formatted : undefined,
    });
    addRemoteArtifact(jobId, {
      kind: 'log-snippet',
      title: 'MCP result',
      value: truncateGraphemesTo(formatted, 2000),
    });
    closeRemoteSession(
      sessionId,
      result.isError ? 'error' : 'closed',
      result.isError ? formatted : undefined,
    );
    return result.isError
      ? failedToolOutcome(formatted, 'tool_error')
      : completedToolOutcome(formatted);
  } catch (err: unknown) {
    const message = `Error calling MCP tool: ${err instanceof Error ? err.message : String(err)}`;
    updateRemoteJob(jobId, {
      status: 'failed',
      progressText: 'Tool failed',
      error: message,
    });
    addRemoteArtifact(jobId, {
      kind: 'log-snippet',
      title: 'MCP error',
      value: message,
    });
    closeRemoteSession(sessionId, 'error', message);
    return failedToolOutcome(message);
  }
}
