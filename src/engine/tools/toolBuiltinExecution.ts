import { executeBuiltinAgentTool, BUILTIN_AGENT_TOOL_NAMES } from './toolBuiltinAgentExecution';
import { executeBuiltinCanvasTool, BUILTIN_CANVAS_TOOL_NAMES } from './toolBuiltinCanvasExecution';
import { executeBuiltinMemoryTool, BUILTIN_MEMORY_TOOL_NAMES } from './toolBuiltinMemoryExecution';
import { executeBuiltinRemoteTool, BUILTIN_REMOTE_TOOL_NAMES } from './toolBuiltinRemoteExecution';
import { executeBuiltinSessionTool, BUILTIN_SESSION_TOOL_NAMES } from './toolBuiltinSessionExecution';
import type { BuiltinToolExecutionParams } from './toolBuiltinExecutionTypes';

const BUILTIN_PROVIDER_AWARE_TOOL_NAMES = new Set([
  'sessions_spawn',
  'sessions_send',
]);

export const BUILTIN_TOOL_NAMES = new Set([
  ...BUILTIN_PROVIDER_AWARE_TOOL_NAMES,
  ...BUILTIN_CANVAS_TOOL_NAMES,
  ...BUILTIN_SESSION_TOOL_NAMES,
  ...BUILTIN_MEMORY_TOOL_NAMES,
  ...BUILTIN_REMOTE_TOOL_NAMES,
  ...BUILTIN_AGENT_TOOL_NAMES,
]);

export async function executeBuiltinTool(params: BuiltinToolExecutionParams): Promise<string> {
  const handlers = [
    executeBuiltinCanvasTool,
    executeBuiltinSessionTool,
    executeBuiltinMemoryTool,
    executeBuiltinRemoteTool,
    executeBuiltinAgentTool,
  ];

  for (const handler of handlers) {
    const result = await handler(params);
    if (result !== null) {
      return result;
    }
  }

  return `Error: unhandled builtin tool "${params.name}"`;
}
