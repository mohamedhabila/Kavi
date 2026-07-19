import type { ToolDefinition } from '../../types/tool';
import { mcpManager } from '../../services/mcp/manager';
import { executeMcpTool, parseMcpToolName } from '../../services/mcp/bridge';
import { captureSkillRuntimeToolBinding, parseSkillToolName } from '../../services/skills/manager';
import { resolveRegisteredToolName } from '../tools/toolNameNormalization';
import type { RuntimeExternalToolEvidence } from './toolContractIdentity';
import {
  resolveToolWorkspaceContext,
  type ToolExecutionContext,
} from '../tools/toolExecutionContext';
import { createConversationFileContext } from '../tools/toolWorkspaceFiles';
import type { ToolRuntimeOutcome } from '../../types/toolRuntimeOutcome';

export type RuntimeExternalToolBinding = Readonly<{
  evidence: RuntimeExternalToolEvidence;
  isCurrent(): boolean;
  execute(
    argsString: string,
    conversationId: string,
    context?: ToolExecutionContext,
  ): Promise<ToolRuntimeOutcome>;
}>;

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value as Record<string, unknown>)
        .filter((key) => (value as Record<string, unknown>)[key] !== undefined)
        .sort()
        .map((key) => [key, canonicalize((value as Record<string, unknown>)[key])]),
    );
  }
  return value;
}

function declarationsMatch(left: ToolDefinition, right: ToolDefinition): boolean {
  try {
    const executionDeclaration = (declaration: ToolDefinition) => ({
      name: declaration.name,
      description: declaration.description,
      inputSchema: declaration.input_schema,
      strict: declaration.strict,
      contract: declaration.contract,
    });
    return (
      JSON.stringify(canonicalize(executionDeclaration(left))) ===
      JSON.stringify(canonicalize(executionDeclaration(right)))
    );
  } catch {
    return false;
  }
}

/**
 * Resolve provenance only from the live registry that owns execution. Provider
 * arguments and dynamic tool declarations cannot supply this value directly.
 */
export function resolveRuntimeExternalToolBinding(
  rawToolName: string,
  declaration: ToolDefinition | undefined,
): RuntimeExternalToolBinding | undefined {
  const toolName = resolveRegisteredToolName(rawToolName);
  if (!declaration || resolveRegisteredToolName(declaration.name) !== toolName) return undefined;

  const mcp = parseMcpToolName(toolName);
  if (mcp) {
    const captured = mcpManager.captureRuntimeToolBinding(mcp.serverId, mcp.toolName);
    if (!captured || !declarationsMatch(declaration, captured.declaration)) return undefined;
    const clients = new Map([[mcp.serverId, captured.client]]);
    return {
      evidence: { declaration, provenance: captured.provenance },
      isCurrent: captured.isCurrent,
      execute: async (argsString, _conversationId, context) => {
        if (!captured.isCurrent()) {
          throw new Error('Runtime-external MCP tool binding is stale.');
        }
        return executeMcpTool(clients, toolName, argsString, {
          isToolAllowed: () => true,
          signal: context?.executionSignal,
        });
      },
    };
  }

  const parsedSkill = parseSkillToolName(toolName);
  if (!parsedSkill) return undefined;
  const captured = captureSkillRuntimeToolBinding(toolName);
  if (!captured || !declarationsMatch(declaration, captured.declaration)) return undefined;
  return {
    evidence: { declaration, provenance: captured.provenance },
    isCurrent: captured.isCurrent,
    execute: async (argsString, conversationId, context) => {
      if (!captured.isCurrent()) {
        throw new Error('Runtime-external skill tool binding is stale.');
      }
      const { workspaceConversationId, workspaceReadFallbackConversationId } =
        resolveToolWorkspaceContext(conversationId, context);
      return captured.execute(argsString, {
        ...createConversationFileContext(
          workspaceConversationId,
          workspaceReadFallbackConversationId,
        ),
        executionSignal: context?.executionSignal,
      });
    },
  };
}
