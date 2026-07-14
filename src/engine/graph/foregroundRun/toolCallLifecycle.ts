import { buildSurfacedSubAgentOutputToolResultSummary } from '../../../services/agents/surfacedSubAgentOutput';
import { formatCompactElapsed } from '../../../services/agents/lifecycle/presentPhase';
import type { ConversationLogEntry } from '../../../types/conversation';
import type { Message, ToolCall } from '../../../types/message';
import type { ToolEffectReceipt } from '../../../types/toolEffectReceipt';
import type { ToolMessageOutcome } from '../../toolExecution/toolMessageOutcome';
import {
  extractMessageEffect,
  summarizeToolArguments,
  summarizeToolResult,
} from '../../toolExecution/toolCallSummaries';
import {
  buildToolExecutionCompletionEffect,
  buildToolExecutionStartEffect,
  type ToolExecutionCompletionEffect,
  type ToolExecutionStartEffect,
} from '../../toolExecution/toolExecutionPresentation';
import {
  buildForegroundSurfacedWorkerToolMessageEffect,
  syncForegroundSurfacedWorkerOutputCompletion,
  type PendingSurfacedWorkerOutput,
} from './surfacedWorkerOutput';

type ForegroundToolLifecycleCounterDelta = {
  completedTools?: number;
  failedTools?: number;
  spawnedSubAgents?: number;
  startedTools?: number;
};

type ForegroundToolMessage = Pick<
  Message,
  'content' | 'id' | 'isError' | 'role' | 'toolCallId' | 'toolCalls'
>;

type ForegroundToolLifecycleLogEntry = Pick<ConversationLogEntry, 'detail' | 'kind' | 'title'> &
  Partial<Pick<ConversationLogEntry, 'level' | 'timestamp'>>;

type ForegroundToolLifecycleActions = {
  addToolCall: (assistantMessageId: string, toolCall: ToolCall) => void;
  addToolMessage: (message: ForegroundToolMessage) => void;
  appendConversationLog: (entry: ForegroundToolLifecycleLogEntry) => void;
  applyMessageEffect: (assistantMessageId: string, effectId: Message['effectId']) => void;
  applyToolCompletionEffect: (effect: ToolExecutionCompletionEffect) => void;
  applyToolStartEffect: (effect: ToolExecutionStartEffect) => void;
  clearSurfacedWorkerOutputLock: () => void;
  flushSurfacedWorkerOutput: (toolCallId: string) => void;
  recordToolUsage: (toolCall: ToolCall) => void;
  requestPersistenceCheckpoint: () => void;
  trackCounters: (delta: ForegroundToolLifecycleCounterDelta) => void;
  updateToolCallStatus: (
    assistantMessageId: string,
    toolCallId: string,
    status: ToolCall['status'],
    patch: {
      completedAt?: number;
      error?: string;
      result?: string;
      effectReceipt?: ToolEffectReceipt;
    },
  ) => void;
  upsertLiveToolCall: (assistantMessageId: string, toolCall: ToolCall) => void;
};

type ForegroundToolLifecycleAccessors = {
  getCurrentAssistantMessageId: () => string;
  getLiveToolCalls: (assistantMessageId: string) => ToolCall[] | undefined;
  getPersistedAssistantToolCalls: (assistantMessageId: string) => ToolCall[] | undefined;
  now?: () => number;
};

function hasValidToolIdentity(toolCall: ToolCall): boolean {
  return Boolean(toolCall.id?.trim() && toolCall.name?.trim());
}

function resolveForegroundToolResultCall(params: {
  liveToolCalls?: ToolCall[];
  now: number;
  persistedToolCalls?: ToolCall[];
  result: string;
  status: ToolMessageOutcome['status'];
  toolCallId: string;
}): ToolCall | undefined {
  const sourceToolCall = [...(params.liveToolCalls ?? []), ...(params.persistedToolCalls ?? [])]
    .reverse()
    .find((toolCall) => toolCall.id === params.toolCallId);

  if (!sourceToolCall || !hasValidToolIdentity(sourceToolCall)) {
    return undefined;
  }

  const resultToolCall: ToolCall = {
    ...sourceToolCall,
    status: params.status,
    result: params.result,
    error: params.status === 'failed' ? sourceToolCall.error : undefined,
    completedAt: sourceToolCall.completedAt ?? params.now,
  };
  delete resultToolCall.effectReceipts;
  return resultToolCall;
}

export function createForegroundToolCallLifecycleController(params: {
  accessors: ForegroundToolLifecycleAccessors;
  actions: ForegroundToolLifecycleActions;
  pendingSurfacedWorkerOutputs: Map<string, PendingSurfacedWorkerOutput>;
}) {
  const getNow = () => params.accessors.now?.() ?? Date.now();
  const toolCallAssistantMessageIds = new Map<string, string>();

  const rememberToolCallAssistantMessageId = (toolCallId: string, assistantMessageId: string) => {
    if (!toolCallId.trim() || !assistantMessageId.trim()) {
      return;
    }
    toolCallAssistantMessageIds.set(toolCallId, assistantMessageId);
  };

  const resolveToolCallAssistantMessageId = (toolCallId: string) =>
    toolCallAssistantMessageIds.get(toolCallId) ?? params.accessors.getCurrentAssistantMessageId();

  const releaseToolCallAssistantMessageId = (toolCallId: string) => {
    toolCallAssistantMessageIds.delete(toolCallId);
  };

  return {
    completeToolCall(toolCall: ToolCall) {
      if (!hasValidToolIdentity(toolCall)) {
        return;
      }

      params.actions.recordToolUsage(toolCall);
      const surfacedOutput = syncForegroundSurfacedWorkerOutputCompletion({
        pendingOutputs: params.pendingSurfacedWorkerOutputs,
        toolCall,
      });
      const assistantMessageId = resolveToolCallAssistantMessageId(toolCall.id);
      const latestEffectReceipt = toolCall.effectReceipts?.[toolCall.effectReceipts.length - 1];
      params.actions.upsertLiveToolCall(assistantMessageId, toolCall);
      params.actions.updateToolCallStatus(assistantMessageId, toolCall.id, toolCall.status, {
        result: surfacedOutput
          ? buildSurfacedSubAgentOutputToolResultSummary(surfacedOutput)
          : toolCall.result,
        error: toolCall.error,
        completedAt: toolCall.completedAt,
        effectReceipt: latestEffectReceipt,
      });

      if (toolCall.name === 'message_effect') {
        const effectId = extractMessageEffect(toolCall.result);
        if (effectId) {
          params.actions.applyMessageEffect(assistantMessageId, effectId);
        }
      }

      const elapsed =
        toolCall.completedAt && toolCall.startedAt
          ? formatCompactElapsed(Math.max(0, toolCall.completedAt - toolCall.startedAt))
          : undefined;
      const completionEffect = buildToolExecutionCompletionEffect({
        toolName: toolCall.name,
        status: toolCall.status,
        result: toolCall.result,
        resultSummary: summarizeToolResult(toolCall),
        startedAt: toolCall.startedAt,
        completedAt: toolCall.completedAt,
        updatedAt: toolCall.updatedAt,
        elapsedLabel: elapsed,
      });

      params.actions.trackCounters(
        toolCall.status === 'failed'
          ? { failedTools: 1 }
          : {
              completedTools: 1,
              spawnedSubAgents: completionEffect.startedDelegatedSession ? 1 : 0,
            },
      );
      params.actions.applyToolCompletionEffect(completionEffect);
      params.actions.appendConversationLog(completionEffect.logEntry);
    },
    publishToolMessage(outcome: ToolMessageOutcome) {
      const toolMessageEffect = buildForegroundSurfacedWorkerToolMessageEffect({
        pendingOutputs: params.pendingSurfacedWorkerOutputs,
        toolCallId: outcome.toolCallId,
        rawResult: outcome.content,
      });
      const assistantMessageId = resolveToolCallAssistantMessageId(outcome.toolCallId);
      const toolResultCall = resolveForegroundToolResultCall({
        liveToolCalls: params.accessors.getLiveToolCalls(assistantMessageId),
        persistedToolCalls: params.accessors.getPersistedAssistantToolCalls(assistantMessageId),
        toolCallId: outcome.toolCallId,
        result: toolMessageEffect.content,
        status: outcome.status,
        now: getNow(),
      });

      params.actions.addToolMessage({
        id: `${assistantMessageId}_tool_${outcome.toolCallId}`,
        role: 'tool',
        content: toolMessageEffect.content,
        toolCallId: outcome.toolCallId,
        ...(toolResultCall ? { toolCalls: [toolResultCall] } : {}),
        isError: outcome.status === 'failed',
      });
      params.actions.flushSurfacedWorkerOutput(outcome.toolCallId);
      params.actions.requestPersistenceCheckpoint();
      releaseToolCallAssistantMessageId(outcome.toolCallId);
    },
    queueToolCall(toolCall: ToolCall) {
      const queuedToolCall: ToolCall = {
        ...toolCall,
        status: toolCall.status ?? 'pending',
      };

      if (!hasValidToolIdentity(queuedToolCall)) {
        return;
      }

      rememberToolCallAssistantMessageId(
        queuedToolCall.id,
        params.accessors.getCurrentAssistantMessageId(),
      );
      params.actions.upsertLiveToolCall(
        params.accessors.getCurrentAssistantMessageId(),
        queuedToolCall,
      );
    },
    startToolCall(toolCall: ToolCall) {
      if (!hasValidToolIdentity(toolCall)) {
        return;
      }

      params.actions.clearSurfacedWorkerOutputLock();
      params.actions.trackCounters({ startedTools: 1 });

      const startEffect = buildToolExecutionStartEffect({
        toolName: toolCall.name,
        argumentSummary: summarizeToolArguments(toolCall.arguments),
        timestamp: toolCall.startedAt,
      });
      const assistantMessageId = params.accessors.getCurrentAssistantMessageId();
      rememberToolCallAssistantMessageId(toolCall.id, assistantMessageId);

      params.actions.applyToolStartEffect(startEffect);
      params.actions.upsertLiveToolCall(assistantMessageId, toolCall);
      params.actions.addToolCall(assistantMessageId, toolCall);
      params.actions.appendConversationLog(startEffect.logEntry);
    },
  };
}
