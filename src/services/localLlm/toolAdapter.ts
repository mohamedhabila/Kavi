import type { ToolDefinition } from '../../types/tool';
import { normalizeToolInputSchema } from '../../utils/toolSchema';
import type { LocalStructuredToolDefinition } from './types';

export function buildStructuredLocalToolDefinitions(
  tools?: ToolDefinition[],
): LocalStructuredToolDefinition[] | undefined {
  if (!tools?.length) {
    return undefined;
  }

  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    parameters: normalizeToolInputSchema(tool.input_schema),
  }));
}

export function stringifyLocalToolArguments(argumentsValue: Record<string, any>): string {
  try {
    return JSON.stringify(argumentsValue || {});
  } catch {
    return '{}';
  }
}

export function buildLocalChatCompletionToolCalls(
  toolCalls: Array<{ id: string; name: string; arguments: Record<string, any> }> | undefined,
): Array<Record<string, any>> | undefined {
  if (!toolCalls?.length) {
    return undefined;
  }

  return toolCalls.map((toolCall) => ({
    id: toolCall.id,
    type: 'function',
    function: {
      name: toolCall.name,
      arguments: stringifyLocalToolArguments(toolCall.arguments),
    },
  }));
}
