import { useSettingsStore } from '../../store/useSettingsStore';
import { executeProviderAwareTool } from './providerAwareToolExecution';
import {
  executeMemoryBlockEdit,
  executeMemoryBlockRead,
  executeMemoryForget,
  executeMemoryPin,
  executeMemoryRecall,
  executeMemoryRemember,
  executeMemoryUnpin,
} from './builtin-memory';
import type { MemoryRememberArgs } from '../../services/memory/memoryTools';
import type { BuiltinToolExecutionParams } from './toolBuiltinExecutionTypes';

export const BUILTIN_MEMORY_TOOL_NAMES = new Set([
  'memory_search',
  'memory_recall',
  'memory_remember',
  'memory_pin',
  'memory_unpin',
  'memory_forget',
  'memory_block_read',
  'memory_block_edit',
  'memory_manage',
  'memory_block',
]);

function buildMemoryPermissionDenied(): string {
  return JSON.stringify({
    ok: false,
    code: 'permission_denied',
    error: 'Long-term memory is disabled in settings.',
  });
}

function withExecutionMemoryContext(
  args: unknown,
  conversationId: string,
): MemoryRememberArgs {
  const base =
    args && typeof args === 'object' && !Array.isArray(args)
      ? { ...(args as Partial<MemoryRememberArgs>) }
      : {};
  if (base.originConversationId === undefined) {
    base.originConversationId = conversationId;
  }
  if (base.scope === undefined) {
    base.scope = 'conversation';
  }
  return base as MemoryRememberArgs;
}

export async function executeBuiltinMemoryTool(
  params: BuiltinToolExecutionParams,
): Promise<string | null> {
  const { name, args, conversationId, workspaceConversationId, context } = params;

  if (!BUILTIN_MEMORY_TOOL_NAMES.has(name)) {
    return null;
  }

  if (useSettingsStore.getState().disableLongTermMemory) {
    return buildMemoryPermissionDenied();
  }

  if (name === 'memory_search') {
    const memorySearchResult = await executeProviderAwareTool({
      name,
      args,
      conversationId,
      workspaceConversationId,
      context,
    });
    return memorySearchResult ?? `Error: unhandled memory_* tool "${name}"`;
  }

  if (name === 'memory_recall') return executeMemoryRecall(args);
  if (name === 'memory_remember') {
    return executeMemoryRemember(withExecutionMemoryContext(args, conversationId));
  }
  if (name === 'memory_pin') return executeMemoryPin(args);
  if (name === 'memory_unpin') return executeMemoryUnpin(args);
  if (name === 'memory_forget') return executeMemoryForget(args);
  if (name === 'memory_block_read') return executeMemoryBlockRead(args);
  if (name === 'memory_block_edit') return executeMemoryBlockEdit(args);

  if (name === 'memory_manage') {
    const action = args && typeof args.action === 'string' ? String(args.action).toLowerCase() : '';
    if (action === 'pin') return executeMemoryPin({ factId: args?.factId as string });
    if (action === 'unpin') return executeMemoryUnpin({ factId: args?.factId as string });
    if (action === 'forget') {
      return executeMemoryForget({
        factId: args?.factId as string,
        mode: args?.mode as 'invalidate' | 'delete' | undefined,
      });
    }
    return JSON.stringify({
      ok: false,
      error: 'memory_manage: action must be one of pin, unpin, forget.',
    });
  }

  if (name === 'memory_block') {
    const action = args && typeof args.action === 'string' ? String(args.action).toLowerCase() : '';
    if (action === 'read') {
      return executeMemoryBlockRead({ label: args?.label });
    }
    if (action === 'edit') {
      return executeMemoryBlockEdit({
        label: args?.label as string,
        content: args?.content as string,
        replace: args?.replace,
      });
    }
    return JSON.stringify({
      ok: false,
      error: 'memory_block: action must be one of read, edit.',
    });
  }

  return `Error: unknown memory_* tool "${name}"`;
}
