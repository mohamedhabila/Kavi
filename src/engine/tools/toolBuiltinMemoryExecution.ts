import { useSettingsStore } from '../../store/useSettingsStore';
import { useChatStore } from '../../store/useChatStore';
import { resolveCodeOwnedMemoryPersonaId } from '../../services/memory/memoryScopeIdentity';
import { resolveGraphTaskId } from '../goals/graphTaskScope';
import {
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
import { resolveLocalMemoryAccessScope } from '../../services/memory/memoryScopeStore';
import { createExplicitMemoryRecallGrant } from '../../services/memory/explicitMemoryRecallGrant';
import type { BuiltinToolExecutionParams } from './toolBuiltinExecutionTypes';
import type { ToolExecutionContext } from './toolExecutionContext';
import type { AuthorizedToolEffectExecutionClaim } from '../../services/executionJournal/authorizedToolEffectExecutionClaim';
import { isExactMemoryProvenanceId } from '../../services/memory/memoryProvenanceIdentity';
import { failedToolOutcome, type ToolRuntimeOutcome } from '../../types/toolRuntimeOutcome';
import { buildMemoryDisabledToolResult } from './memoryPolicyToolAuthority';

export const BUILTIN_MEMORY_TOOL_NAMES = new Set([
  'memory_search',
  'memory_recall',
  'memory_remember',
  'memory_pin',
  'memory_unpin',
  'memory_forget',
  'memory_manage',
]);

const MEMORY_MANAGE_KEYS = new Set(['action', 'factId']);
const MEMORY_MANAGE_ACTIONS = new Set(['pin', 'unpin', 'invalidate']);

function buildMemoryDisabledRejection(): ToolRuntimeOutcome {
  return failedToolOutcome(buildMemoryDisabledToolResult());
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

function buildInvalidMemoryManageArgs(message: string): ToolRuntimeOutcome {
  return failedToolOutcome(JSON.stringify({ ok: false, code: 'invalid_args', error: message }));
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

function withRecallExecutionContext(
  args: unknown,
  conversationId: string,
  memoryConversationId: string,
  context?: ToolExecutionContext,
): MemoryRecallExecutionContext {
  const execution = resolveExecutionMemoryContext(conversationId, memoryConversationId, context);
  const currentUserMessage = context?.currentUserMessage;
  const executionRunId = context?.executionRunId;
  const toolCallId = context?.toolCallId;
  if (!currentUserMessage || !executionRunId || !toolCallId) return execution;
  const explicitRequestEvidence =
    args && typeof args === 'object' && !Array.isArray(args)
      ? (args as { explicitRequestEvidence?: unknown }).explicitRequestEvidence
      : undefined;

  const requestIdentity = {
    currentUserMessageId: currentUserMessage.id,
    currentUserMessageText: currentUserMessage.text,
    executionRunId,
    toolCallId,
    agentRunId: context?.agentRunId ?? null,
  };
  try {
    const explicitUserRequestGrant = createExplicitMemoryRecallGrant({
      ...requestIdentity,
      explicitRequestEvidence,
      scope: resolveLocalMemoryAccessScope({
        memoryConversationId: execution.memoryConversationId,
        sourceThreadId: execution.sourceThreadId,
        personaId: execution.personaId,
        taskId: execution.taskId,
      }),
    });
    return {
      ...execution,
      requestIdentity,
      ...(explicitUserRequestGrant ? { explicitUserRequestGrant } : {}),
    };
  } catch {
    return execution;
  }
}

function withExecutionMemoryContext(
  args: unknown,
  conversationId: string,
  memoryConversationId: string,
  context?: ToolExecutionContext,
  executionClaim?: AuthorizedToolEffectExecutionClaim,
): { args: MemoryRememberArgs; context: MemoryRememberExecutionContext } | null {
  const source =
    args && typeof args === 'object' && !Array.isArray(args)
      ? (args as Partial<MemoryRememberArgs>)
      : {};
  const sourceRunId =
    context?.agentRunId === undefined
      ? null
      : isExactMemoryProvenanceId(context.agentRunId)
        ? context.agentRunId
        : undefined;
  const executionMemoryContext = resolveExecutionMemoryContext(
    conversationId,
    memoryConversationId,
    context,
  );
  const taskId = executionMemoryContext.taskId;
  const currentUserMessage = context?.currentUserMessage;
  if (!currentUserMessage || !executionClaim || sourceRunId === undefined) return null;
  const rememberContext: MemoryRememberExecutionContext = {
    personaId: executionMemoryContext.personaId,
    sourceRunId,
    executionClaim,
    requestEvidence: {
      memoryConversationId,
      sourceThreadId: conversationId,
      taskId,
      userMessageId: currentUserMessage.id,
      userMessageText: currentUserMessage.text,
    },
  };
  return { args: source as MemoryRememberArgs, context: rememberContext };
}

export async function executeBuiltinMemoryTool(
  params: BuiltinToolExecutionParams,
): Promise<ToolRuntimeOutcome | null> {
  const { name, args, conversationId, context, authorizedEffectExecutionClaim } = params;
  const memoryConversationId = context?.memoryConversationId ?? conversationId;

  if (!BUILTIN_MEMORY_TOOL_NAMES.has(name)) {
    return null;
  }

  if (name === 'memory_forget') {
    return executeMemoryForget(
      args,
      resolveExecutionMemoryContext(conversationId, memoryConversationId, context),
    );
  }

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
    return buildMemoryDisabledRejection();
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
      withRecallExecutionContext(args, conversationId, memoryConversationId, context),
    );
  }
  if (name === 'memory_remember') {
    const request = withExecutionMemoryContext(
      args,
      conversationId,
      memoryConversationId,
      context,
      authorizedEffectExecutionClaim,
    );
    if (!request) {
      return failedToolOutcome(
        JSON.stringify({
          status: 'rejected',
          ok: false,
          code: 'internal',
          error: 'memory_remember execution authority invariant failed.',
        }),
      );
    }
    return executeMemoryRemember(request.args, request.context);
  }
  const executionMemoryContext = resolveExecutionMemoryContext(
    conversationId,
    memoryConversationId,
    context,
  );
  if (name === 'memory_pin') return executeMemoryPin(args, executionMemoryContext);
  if (name === 'memory_unpin') return executeMemoryUnpin(args, executionMemoryContext);

  if (name === 'memory_manage') {
    const action = manageAction;
    if (action === 'pin') {
      return executeMemoryPin({ factId: args?.factId as string }, executionMemoryContext);
    }
    if (action === 'unpin') {
      return executeMemoryUnpin({ factId: args?.factId as string }, executionMemoryContext);
    }
    if (action === 'invalidate') {
      return executeMemoryInvalidate({ factId: args.factId as string }, executionMemoryContext);
    }
  }

  return failedToolOutcome(`Error: unknown memory_* tool "${name}"`);
}
