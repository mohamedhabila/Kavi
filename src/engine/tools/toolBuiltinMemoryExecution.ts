import { useSettingsStore } from '../../store/useSettingsStore';
import {
  executeMemoryForget,
  executeMemoryRemember,
  executeMemorySearch,
  type MemoryToolContext,
} from '../../services/memory/core/memoryItemsTools';
import { failedToolOutcome, type ToolRuntimeOutcome } from '../../types/toolRuntimeOutcome';
import type { BuiltinToolExecutionParams } from './toolBuiltinExecutionTypes';
import { buildMemoryDisabledToolResult } from './memoryPolicyToolAuthority';

export const BUILTIN_MEMORY_TOOL_NAMES = new Set([
  'memory_remember',
  'memory_search',
  'memory_forget',
]);

export async function executeBuiltinMemoryTool(
  params: BuiltinToolExecutionParams,
): Promise<ToolRuntimeOutcome | null> {
  const { name, args, conversationId, context } = params;
  if (!BUILTIN_MEMORY_TOOL_NAMES.has(name)) return null;

  const memoryContext: MemoryToolContext = {
    conversationId: context?.memoryConversationId ?? conversationId,
    sourceMessageId: context?.currentUserMessage?.id ?? null,
    now: Date.now(),
  };
  // Turning memory off never stops the user from deleting what was already stored.
  if (name === 'memory_forget') return executeMemoryForget(args, memoryContext);
  if (useSettingsStore.getState().disableLongTermMemory) {
    return failedToolOutcome(buildMemoryDisabledToolResult());
  }
  return name === 'memory_remember'
    ? executeMemoryRemember(args, memoryContext)
    : executeMemorySearch(args, memoryContext);
}
