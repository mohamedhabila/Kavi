// ---------------------------------------------------------------------------
// Kavi — MCP Tool Bridge
// ---------------------------------------------------------------------------
// Converts MCP tool schemas to Kavi tool definitions and routes calls

import { McpClient, McpToolInfo, McpToolCallResult } from './client';
import type { ToolDefinition } from '../../types/tool';
import { normalizeToolInputSchema } from '../../utils/toolSchema';
import {
  addRemoteArtifact,
  closeRemoteSession,
  openRemoteSession,
  startRemoteJob,
  updateRemoteJob,
} from '../remote/store';

export interface McpToolEntry {
  serverId: string;
  serverName: string;
  tool: McpToolInfo;
}

function isPlainRecord(value: unknown): value is Record<string, any> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeMcpInputSchema(schema: unknown): ToolDefinition['input_schema'] {
  return normalizeToolInputSchema(schema);
}

export interface McpToolExecutionOptions {
  isToolAllowed?: (serverId: string, toolName: string) => boolean;
}

/**
 * Convert an MCP tool schema to a Kavi ToolDefinition
 */
export function mcpToolToDefinition(entry: McpToolEntry): ToolDefinition {
  const schema = normalizeMcpInputSchema(entry.tool.inputSchema);
  return {
    name: `mcp__${entry.serverId}__${entry.tool.name}`,
    description: `[${entry.serverName}] ${entry.tool.description ?? entry.tool.name}`,
    input_schema: schema,
  };
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
 * Route an MCP tool call to the correct server
 */
export async function executeMcpTool(
  clients: Map<string, McpClient>,
  fullToolName: string,
  argsString: string,
  options?: McpToolExecutionOptions,
): Promise<string> {
  const parsed = parseMcpToolName(fullToolName);
  if (!parsed) {
    return `Error: invalid MCP tool name: ${fullToolName}`;
  }

  if (options?.isToolAllowed && !options.isToolAllowed(parsed.serverId, parsed.toolName)) {
    return `Error: MCP tool "${parsed.toolName}" is not allowed for server "${parsed.serverId}"`;
  }

  const client = clients.get(parsed.serverId);
  if (!client) {
    return `Error: MCP server "${parsed.serverId}" not connected`;
  }

  if (!client.isConnected()) {
    return `Error: MCP server "${parsed.serverId}" is disconnected`;
  }

  let args: Record<string, unknown>;
  try {
    const parsedArgs = JSON.parse(argsString);
    if (!isPlainRecord(parsedArgs)) {
      return 'Error: MCP tool arguments must be a JSON object';
    }
    args = parsedArgs;
  } catch {
    return 'Error: invalid tool arguments JSON';
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
    const result = await client.callTool(parsed.toolName, args);
    const formatted = formatMcpResult(result);
    updateRemoteJob(jobId, {
      status: result.isError ? 'failed' : 'completed',
      progressText: result.isError ? 'Tool returned an error' : 'Tool completed',
      error: result.isError ? formatted : undefined,
    });
    addRemoteArtifact(jobId, {
      kind: 'log-snippet',
      title: 'MCP result',
      value: formatted.slice(0, 2000),
    });
    closeRemoteSession(
      sessionId,
      result.isError ? 'error' : 'closed',
      result.isError ? formatted : undefined,
    );
    return formatted;
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
    return message;
  }
}
