import { useSettingsStore } from '../../store/useSettingsStore';
import { useChatStore } from '../../store/useChatStore';
import { resolveCodeOwnedMemoryPersonaId } from '../../services/memory/memoryScopeIdentity';
import { resolveGraphTaskId } from '../goals/graphTaskScope';
import {
  executeMemoryBlockEdit,
  executeMemoryBlockRead,
  executeMemoryForget,
  executeMemoryInvalidate,
  executeMemoryPin,
  executeMemoryRecall,
  executeMemoryRemember,
  executeMemorySearch,
  executeMemoryUnpin,
} from './builtin-memory';
import type {
  MemoryRememberArgs,
  MemoryRememberExecutionContext,
  MemoryRecallExecutionContext,
} from '../../services/memory/memoryTools';
import type { BuiltinToolExecutionParams } from './toolBuiltinExecutionTypes';
import type { ToolExecutionContext } from './toolExecutionContext';

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

const MEMORY_MANAGE_KEYS = new Set(['action', 'factId']);
const MEMORY_MANAGE_ACTIONS = new Set(['pin', 'unpin', 'invalidate']);

function buildMemoryPermissionDenied(): string {
  return JSON.stringify({
    ok: false,
    code: 'permission_denied',
    error: 'Long-term memory is disabled in settings.',
  });
}

function memoryManageAction(args: unknown): string {
  if (!args || typeof args !== 'object' || Array.isArray(args)) return '';
  const action = (args as { action?: unknown }).action;
  return typeof action === 'string' ? action : '';
}

function hasOnlyKeys(args: unknown, allowed: ReadonlySet<string>): args is Record<string, unknown> {
  if (!args || typeof args !== 'object' || Array.isArray(args)) return false;
  return Object.keys(args).every((key) => allowed.has(key));
}

function buildInvalidMemoryManageArgs(message: string): string {
  return JSON.stringify({ ok: false, code: 'invalid_args', error: message });
}

function resolveExecutionMemoryContext(
  conversationId: string,
  memoryConversationId: string,
  context?: ToolExecutionContext,
): MemoryRecallExecutionContext {
  const conversation = useChatStore
    .getState()
    .conversations.find((candidate) => candidate.id === conversationId);
  return {
    memoryConversationId,
    sourceThreadId: conversationId,
    personaId: resolveCodeOwnedMemoryPersonaId(conversation?.personaId),
    taskId: resolveGraphTaskId({ goals: context?.controlGraphGoals }) ?? null,
  };
}

function withExecutionMemoryContext(
  args: unknown,
  conversationId: string,
  memoryConversationId: string,
  context?: ToolExecutionContext,
): { args: MemoryRememberArgs; context: MemoryRememberExecutionContext } {
  const source =
    args && typeof args === 'object' && !Array.isArray(args)
      ? (args as Partial<MemoryRememberArgs>)
      : {};
  const sourceRunId = context?.agentRunId?.trim() ? context.agentRunId.trim() : null;
  const executionMemoryContext = resolveExecutionMemoryContext(
    conversationId,
    memoryConversationId,
    context,
  );
  const taskId = executionMemoryContext.taskId;
  const currentUserMessage = context?.currentUserMessage;
  const rememberContext: MemoryRememberExecutionContext = {
    ...(currentUserMessage
      ? {
          requestEvidence: {
            memoryConversationId,
            sourceThreadId: conversationId,
            taskId,
            userMessageId: currentUserMessage.id,
            userMessageText: currentUserMessage.text,
          },
        }
      : {}),
  };
  const scope = source.scope as MemoryRememberArgs['scope'];
  const common = {
    subject: source.subject as string,
    subjectType: source.subjectType,
    predicate: source.predicate as string,
    value: source.value as string,
    confidence: source.confidence,
    pinned: source.pinned,
    scope,
    sourceSummary: source.sourceSummary,
    importance: source.importance,
    sourceRunId,
  };
  if (scope === 'global') return { args: common, context: rememberContext };
  if (scope === 'persona') {
    return {
      args: common,
      context: {
        ...rememberContext,
        personaId: executionMemoryContext.personaId,
      },
    };
  }
  if (scope === 'conversation' || scope === 'project') {
    return {
      args: {
        ...common,
        originConversationId: memoryConversationId,
        originThreadId: conversationId,
      },
      context: rememberContext,
    };
  }
  if (scope === 'session') {
    return {
      args: {
        ...common,
        originConversationId: memoryConversationId,
        originThreadId: conversationId,
        originTaskId: taskId ?? null,
      },
      context: rememberContext,
    };
  }
  return { args: common, context: rememberContext };
}

export async function executeBuiltinMemoryTool(
  params: BuiltinToolExecutionParams,
): Promise<string | null> {
  const { name, args, conversationId, context } = params;
  const memoryConversationId = context?.memoryConversationId ?? conversationId;

  if (!BUILTIN_MEMORY_TOOL_NAMES.has(name)) {
    return null;
  }

  if (name === 'memory_forget') return executeMemoryForget(args);

  const manageAction = name === 'memory_manage' ? memoryManageAction(args) : '';
  if (name === 'memory_manage') {
    if (!hasOnlyKeys(args, MEMORY_MANAGE_KEYS)) {
      return buildInvalidMemoryManageArgs('memory_manage accepts only action and factId.');
    }
    if (!MEMORY_MANAGE_ACTIONS.has(manageAction)) {
      return buildInvalidMemoryManageArgs(
        'memory_manage: action must be one of pin, unpin, invalidate.',
      );
    }
  }

  if (useSettingsStore.getState().disableLongTermMemory) {
    return buildMemoryPermissionDenied();
  }

  if (name === 'memory_search') {
    return executeMemorySearch(
      args,
      resolveExecutionMemoryContext(conversationId, memoryConversationId, context),
    );
  }

  if (name === 'memory_recall') {
    return executeMemoryRecall(
      args,
      resolveExecutionMemoryContext(conversationId, memoryConversationId, context),
    );
  }
  if (name === 'memory_remember') {
    const request = withExecutionMemoryContext(
      args,
      conversationId,
      memoryConversationId,
      context,
    );
    return executeMemoryRemember(request.args, request.context);
  }
  if (name === 'memory_pin') return executeMemoryPin(args);
  if (name === 'memory_unpin') return executeMemoryUnpin(args);
  if (name === 'memory_block_read') return executeMemoryBlockRead(args);
  if (name === 'memory_block_edit') return executeMemoryBlockEdit(args);

  if (name === 'memory_manage') {
    const action = manageAction;
    if (action === 'pin') return executeMemoryPin({ factId: args?.factId as string });
    if (action === 'unpin') return executeMemoryUnpin({ factId: args?.factId as string });
    if (action === 'invalidate') {
      return executeMemoryInvalidate({ factId: args.factId as string });
    }
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
