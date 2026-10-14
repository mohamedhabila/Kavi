import type { Message } from '../../types/message';
import type { ToolDefinition } from '../../types/tool';
import { normalizeToolName } from '../tools/toolNameNormalization';
import { resolveTurnToolSurface } from '../tools/toolSurface';
import {
  DISCOVERY_ACTIVATION_TOOL_NAMES,
  extractActivatedToolNamesFromDiscoveryToolResult,
} from './discoveryToolActivation';

/**
 * Every tool the conversation in hand has called or activated (through a tool_catalog or
 * tool_describe result), in the order each first appeared. The surface keeps them all, so a
 * tool the model has used stays callable and the declaration block only grows at its end.
 */
export function collectConversationToolNames(messages: ReadonlyArray<Message>): string[] {
  const toolNames = new Set<string>();
  const toolNameByCallId = new Map<string, string>();

  for (const message of messages) {
    if (message.role === 'assistant') {
      for (const toolCall of message.toolCalls ?? []) {
        const toolName = normalizeToolName(toolCall.name);
        const toolCallId = toolCall.id?.trim();
        if (toolCallId) {
          toolNameByCallId.set(toolCallId, toolName);
        }
        if (toolName && !DISCOVERY_ACTIVATION_TOOL_NAMES.has(toolName)) {
          toolNames.add(toolName);
        }
      }
      continue;
    }

    if (message.role === 'tool') {
      const toolCallId = typeof message.toolCallId === 'string' ? message.toolCallId.trim() : '';
      const toolName = toolCallId ? toolNameByCallId.get(toolCallId) : undefined;
      if (toolName && DISCOVERY_ACTIVATION_TOOL_NAMES.has(toolName)) {
        for (const activated of extractActivatedToolNamesFromDiscoveryToolResult(
          toolName,
          message.content,
        )) {
          toolNames.add(activated);
        }
      }
    }
  }

  return Array.from(toolNames);
}

export function resolveDefaultGroundedRequestScopedTools(params: {
  allTools: ReadonlyArray<ToolDefinition>;
  pendingAsyncMonitorToolNames?: ReadonlySet<string>;
  workingMessages: ReadonlyArray<Message>;
  explicitToolSurfaceToolNames?: ReadonlyArray<string>;
  sessionActivatedToolNames?: ReadonlyArray<string>;
}): ToolDefinition[] {
  return resolveTurnToolSurface({
    allTools: params.allTools,
    conversationToolNames: [
      ...collectConversationToolNames(params.workingMessages),
      ...(params.sessionActivatedToolNames ?? []),
    ],
    pendingAsyncMonitorToolNames: params.pendingAsyncMonitorToolNames,
    explicitToolSurfaceToolNames: params.explicitToolSurfaceToolNames,
  });
}
