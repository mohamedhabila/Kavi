import { useChatStore } from '../../store/useChatStore';
import { generateId } from '../../utils/id';
import { buildAssistantMessageMetadata } from '../../utils/assistantMessageMetadata';
import { extractScheduledJobMessageEffect } from './executionPresentation';
import {
  buildSurfacedSubAgentOutputToolResultSummary,
  parseSurfacedSubAgentOutputResult,
} from '../agents/surfacedSubAgentOutput';
import {
  applyOrchestratorCompactionEffect,
  buildOrchestratorCompactionEffect,
} from '../../engine/orchestratorCompactionEffect';
import { editWorkingBlock } from '../memory/workingBlocks';
import type { OrchestratorCallbacks } from '../../engine/orchestrator';
import type { AssistantMessageMetadata, MessageProviderReplay } from '../../types/message';
import {
  appendAssistantResponseAfterTool,
  appendOrUpdateAssistantToolTurn,
  buildTerminalFailureMetadata,
  ScheduledToolTurnLedger,
  type PendingAssistantResponse,
} from './jobExecutorConversationTurns';
import type { createAgentControlGraphTerminalOutcomeTracker } from '../../engine/graph/terminalOutcome';
import type { createScheduledJobRetryPolicy } from './jobExecutorRetryPolicy';

/**
 * Bundle returned by {@link createScheduledJobOrchestratorCallbacks}: the `OrchestratorCallbacks`
 * to hand to `runOrchestrator`, plus the finalization helpers `jobExecutor.ts` must still call
 * after the run settles (on success, on a thrown error, and on a resolved terminal-graph
 * failure), and read-only accessors for the state `jobExecutor.ts` needs once the run is done
 * (the active assistant message id, the last streamed content, and whether a graph failure
 * response was applied) — all of it otherwise private to this closure.
 */
export interface ScheduledJobOrchestratorCallbacksHandle {
  callbacks: OrchestratorCallbacks;
  flushReadySurfacedSubAgentOutputs: () => void;
  commitPostSurfaceSuccessResponse: () => boolean;
  commitTerminalFailureResponse: (fallback?: PendingAssistantResponse) => boolean;
  finalizeSurfacedOutputSuccess: () => void;
  getActiveAssistantMessageId: () => string;
  getAccumulatedContent: () => string;
  getGraphFailureResponseApplied: () => boolean;
}

/**
 * Builds the `OrchestratorCallbacks` that stream one scheduled job's orchestrator run into the
 * chat store: assistant tokens/reasoning, tool call lifecycle, surfaced sub-agent output,
 * compaction, and (via `onUserMessageAttachmentsUpdated`) a structured document-input refusal
 * discovered on the job's own message re-send. Every write is gated by `transcriptMutationAllowed`
 * so a job whose conversation was deleted or whose transcript was frozen mid-run stops mutating it.
 */
export function createScheduledJobOrchestratorCallbacks(params: {
  chatState: ReturnType<typeof useChatStore.getState>;
  conversationId: string;
  assistantMessageId: string;
  transcriptMutationAllowed: () => boolean;
  retryPolicy: ReturnType<typeof createScheduledJobRetryPolicy>;
  terminalOutcome: ReturnType<typeof createAgentControlGraphTerminalOutcomeTracker>;
}): ScheduledJobOrchestratorCallbacksHandle {
  const { chatState, conversationId, assistantMessageId, transcriptMutationAllowed, retryPolicy, terminalOutcome } =
    params;

  let accumulatedContent = '';
  let accumulatedReasoning = '';
  let graphFailureResponseApplied = false;
  const pendingSurfacedSubAgentOutputs = new Map<
    string,
    NonNullable<ReturnType<typeof parseSurfacedSubAgentOutputResult>>
  >();
  let surfacedSubAgentOutputActive = false;
  let surfacedAssistantMessageAppended = false;
  let lastSurfacedAssistantMessageId: string | undefined;
  let lastPostSurfaceSuccessMessageId: string | undefined;
  let lastSurfacedOutput = '';
  let pendingPostSurfaceSuccessResponse: PendingAssistantResponse | undefined;
  let pendingTerminalFailureResponse: PendingAssistantResponse | undefined;
  let terminalFailureResponseCommitted = false;
  let activeAssistantMessageId = assistantMessageId;
  let activeToolCallIds = new Set<string>();
  let toolMessageAppendedSinceAssistantTurn = false;
  let hasAppendedToolMessage = false;
  const toolTurns = new ScheduledToolTurnLedger(chatState, conversationId);

  const clearSurfacedSubAgentOutputLock = () => {
    surfacedSubAgentOutputActive = false;
  };

  const flushSurfacedSubAgentOutput = (toolCallId: string) => {
    const surfacedOutput = pendingSurfacedSubAgentOutputs.get(toolCallId);
    if (!surfacedOutput) {
      return false;
    }

    pendingSurfacedSubAgentOutputs.delete(toolCallId);
    surfacedSubAgentOutputActive = true;
    surfacedAssistantMessageAppended = true;
    lastSurfacedOutput = surfacedOutput.output;
    accumulatedContent = surfacedOutput.output;

    const surfacedAssistantMessageId = generateId();
    lastSurfacedAssistantMessageId = surfacedAssistantMessageId;
    activeAssistantMessageId = surfacedAssistantMessageId;
    toolMessageAppendedSinceAssistantTurn = false;
    accumulatedReasoning = '';
    chatState.addMessage(conversationId, {
      id: surfacedAssistantMessageId,
      role: 'assistant',
      content: surfacedOutput.output,
      assistantMetadata: buildAssistantMessageMetadata('final', {
        completionStatus: 'incomplete',
        finishReason: 'surfaced_worker_output_pending',
      }),
    });
    return true;
  };

  const flushReadySurfacedSubAgentOutputs = () => {
    for (const toolCallId of Array.from(pendingSurfacedSubAgentOutputs.keys())) {
      if (toolTurns.isBatchSettled(toolCallId)) flushSurfacedSubAgentOutput(toolCallId);
    }
  };

  const startAssistantToolTurn = (
    content: string,
    toolCallIds: string[],
    providerReplay?: MessageProviderReplay,
    assistantMetadata?: AssistantMessageMetadata,
  ) => {
    accumulatedContent = content;
    accumulatedReasoning = '';
    const nextTurn = appendOrUpdateAssistantToolTurn({
      chatState,
      conversationId,
      activeAssistantMessageId,
      activeToolCallIds,
      content,
      toolCallIds,
      providerReplay,
      assistantMetadata,
    });
    activeAssistantMessageId = nextTurn.assistantMessageId;
    activeToolCallIds = nextTurn.toolCallIds;
    toolMessageAppendedSinceAssistantTurn = false;
  };

  const ensureAssistantResponseAfterTool = () => {
    if (!toolMessageAppendedSinceAssistantTurn || surfacedAssistantMessageAppended) return;
    accumulatedContent = '';
    accumulatedReasoning = '';
    activeAssistantMessageId = appendAssistantResponseAfterTool({
      chatState: useChatStore.getState(),
      conversationId,
      content: '',
    });
    activeToolCallIds = new Set();
    toolMessageAppendedSinceAssistantTurn = false;
  };

  const commitPostSurfaceSuccessResponse = (): boolean => {
    const response = pendingPostSurfaceSuccessResponse;
    const surfacedMessageId = lastSurfacedAssistantMessageId;
    if (!response?.content.trim() || !surfacedMessageId) return false;

    const assistantMetadata: AssistantMessageMetadata = {
      ...response.assistantMetadata,
      kind: 'final',
      completionStatus: 'incomplete',
      finishReason: 'post_surface_response_pending',
    };
    pendingPostSurfaceSuccessResponse = undefined;
    accumulatedContent = response.content;
    clearSurfacedSubAgentOutputLock();

    if (response.content.trim() === lastSurfacedOutput.trim()) {
      lastPostSurfaceSuccessMessageId = surfacedMessageId;
      if (response.providerReplay) {
        chatState.updateMessageProviderReplay(conversationId, surfacedMessageId, response.providerReplay);
      }
      chatState.updateMessageAssistantMetadata(conversationId, surfacedMessageId, assistantMetadata);
      return true;
    }

    const postSurfaceMessageId = generateId();
    lastPostSurfaceSuccessMessageId = postSurfaceMessageId;
    chatState.addMessage(conversationId, {
      id: postSurfaceMessageId,
      role: 'assistant',
      content: response.content,
      providerReplay: response.providerReplay,
      assistantMetadata,
    });
    return true;
  };

  const finalizeSurfacedOutputSuccess = () => {
    const finalMessageId = lastPostSurfaceSuccessMessageId ?? lastSurfacedAssistantMessageId;
    if (!finalMessageId || terminalFailureResponseCommitted) return;
    chatState.updateMessageAssistantMetadata(
      conversationId,
      finalMessageId,
      buildAssistantMessageMetadata('final', {
        completionStatus: 'complete',
        finishReason: 'graph_finalized',
      }),
    );
  };

  const commitTerminalFailureResponse = (fallback?: PendingAssistantResponse): boolean => {
    if (terminalFailureResponseCommitted) return true;
    const response = pendingTerminalFailureResponse ?? fallback;
    if (!response?.content.trim()) return false;

    const assistantMetadata = buildTerminalFailureMetadata(response.assistantMetadata);
    accumulatedContent = response.content;
    accumulatedReasoning = '';
    graphFailureResponseApplied = true;
    terminalFailureResponseCommitted = true;
    pendingTerminalFailureResponse = undefined;
    clearSurfacedSubAgentOutputLock();

    if (surfacedAssistantMessageAppended || hasAppendedToolMessage) {
      activeAssistantMessageId = appendAssistantResponseAfterTool({
        chatState: useChatStore.getState(),
        conversationId,
        content: response.content,
        providerReplay: response.providerReplay,
        assistantMetadata,
        isError: true,
      });
      return true;
    }

    chatState.updateMessage(conversationId, assistantMessageId, response.content);
    if (response.providerReplay) {
      chatState.updateMessageProviderReplay(conversationId, assistantMessageId, response.providerReplay);
    }
    chatState.updateMessageAssistantMetadata(conversationId, assistantMessageId, assistantMetadata);
    return true;
  };

  const callbacks: OrchestratorCallbacks = {
    onAgentControlGraphStateChange: (state) => {
      retryPolicy.recordControlGraphStatus(state.status);
      terminalOutcome.recordControlGraphState(state);
    },
    onStateChange: () => {},
    onToken: (token) => {
      if (!transcriptMutationAllowed()) return;
      if (surfacedAssistantMessageAppended) {
        return;
      }
      ensureAssistantResponseAfterTool();
      accumulatedContent += token;
      useChatStore.getState().updateMessage(conversationId, activeAssistantMessageId, accumulatedContent);
    },
    onReasoning: (token) => {
      if (!transcriptMutationAllowed()) return;
      if (surfacedAssistantMessageAppended) {
        return;
      }
      ensureAssistantResponseAfterTool();
      accumulatedReasoning += token;
      useChatStore
        .getState()
        .updateMessageReasoning(conversationId, activeAssistantMessageId, accumulatedReasoning);
    },
    onAssistantStreamReset: () => {
      if (!transcriptMutationAllowed()) return;
      accumulatedContent = '';
      accumulatedReasoning = '';
      if (surfacedAssistantMessageAppended) return;
      ensureAssistantResponseAfterTool();
      useChatStore.getState().updateMessage(conversationId, activeAssistantMessageId, '');
      useChatStore.getState().updateMessageReasoning(conversationId, activeAssistantMessageId, '');
    },
    onUserMessageEnriched: (messageId, enrichedContent) => {
      if (!transcriptMutationAllowed()) return;
      useChatStore.getState().updateMessageEnrichedContent(conversationId, messageId, enrichedContent);
    },
    onUserMessageAttachmentsUpdated: (messageId, attachments) => {
      if (!transcriptMutationAllowed()) {
        console.warn(
          '[scheduler] Dropped a document-input refusal update because the transcript is no longer writable:',
          { conversationId, messageId },
        );
        return;
      }
      useChatStore.getState().updateMessageAttachments(conversationId, messageId, attachments);
    },
    onToolCallStart: (toolCall) => {
      if (!transcriptMutationAllowed()) return;
      retryPolicy.recordToolActivity(toolCall.name);
      clearSurfacedSubAgentOutputLock();
      if (
        (surfacedAssistantMessageAppended || toolMessageAppendedSinceAssistantTurn) &&
        !activeToolCallIds.has(toolCall.id)
      ) {
        startAssistantToolTurn('', [toolCall.id]);
      }
      toolTurns.persist(toolCall, activeAssistantMessageId, activeToolCallIds);
    },
    onToolCallComplete: (toolCall) => {
      if (!transcriptMutationAllowed()) return;
      retryPolicy.recordToolActivity(toolCall.name);
      const toolTurnMessageId = toolTurns.persist(toolCall, activeAssistantMessageId, activeToolCallIds);
      toolTurns.markCompleted(toolCall.id);
      const surfacedOutput =
        toolCall.name === 'sessions_surface_output' && toolCall.status === 'completed'
          ? parseSurfacedSubAgentOutputResult(toolCall.result)
          : undefined;

      useChatStore
        .getState()
        .updateToolCallStatus(conversationId, toolTurnMessageId, toolCall.id, toolCall.status, {
          result: surfacedOutput
            ? buildSurfacedSubAgentOutputToolResultSummary(surfacedOutput)
            : toolCall.result,
          error: toolCall.error,
        });
      if (toolCall.name === 'message_effect') {
        const effectId = extractScheduledJobMessageEffect(toolCall.result);
        if (effectId) {
          useChatStore.getState().updateMessageEffect(conversationId, toolTurnMessageId, effectId);
        }
      } else if (toolCall.name === 'sessions_surface_output') {
        if (toolCall.status === 'completed') {
          if (surfacedOutput) {
            pendingSurfacedSubAgentOutputs.set(toolCall.id, surfacedOutput);
          } else {
            pendingSurfacedSubAgentOutputs.delete(toolCall.id);
          }
        } else {
          pendingSurfacedSubAgentOutputs.delete(toolCall.id);
        }
      }
    },
    onAssistantMessage: (content, toolCalls, providerReplay, assistantMetadata) => {
      if (!transcriptMutationAllowed()) return;
      const incomingToolCalls =
        toolCalls?.filter((toolCall) => toolCall.id?.trim() && toolCall.name?.trim()) ?? [];
      const replacesSurfacedOutputWithTerminalFailure =
        content.trim().length > 0 && terminalOutcome.hasUnsuccessfulTerminalState();
      if (replacesSurfacedOutputWithTerminalFailure) {
        pendingPostSurfaceSuccessResponse = undefined;
        pendingTerminalFailureResponse = {
          content,
          providerReplay,
          assistantMetadata,
        };
        graphFailureResponseApplied = true;
        if (!surfacedAssistantMessageAppended && pendingSurfacedSubAgentOutputs.size === 0) {
          commitTerminalFailureResponse();
        }
        return;
      }
      if (
        toolMessageAppendedSinceAssistantTurn &&
        !surfacedAssistantMessageAppended &&
        incomingToolCalls.length > 0
      ) {
        activeToolCallIds = new Set();
        startAssistantToolTurn(
          content,
          incomingToolCalls.map((toolCall) => toolCall.id),
          providerReplay,
          assistantMetadata,
        );
        toolTurns.persistAll(incomingToolCalls, activeAssistantMessageId, activeToolCallIds);
        return;
      }
      if (
        toolMessageAppendedSinceAssistantTurn &&
        !surfacedAssistantMessageAppended &&
        incomingToolCalls.length === 0 &&
        content.trim().length > 0
      ) {
        accumulatedContent = content;
        accumulatedReasoning = '';
        activeAssistantMessageId = appendAssistantResponseAfterTool({
          chatState: useChatStore.getState(),
          conversationId,
          content,
          providerReplay,
          assistantMetadata,
        });
        activeToolCallIds = new Set();
        toolMessageAppendedSinceAssistantTurn = false;
        return;
      }
      if (surfacedAssistantMessageAppended && incomingToolCalls.length > 0) {
        clearSurfacedSubAgentOutputLock();
        startAssistantToolTurn(
          content,
          incomingToolCalls.map((toolCall) => toolCall.id),
          providerReplay,
          assistantMetadata,
        );
        toolTurns.persistAll(incomingToolCalls, activeAssistantMessageId, activeToolCallIds);
        return;
      }
      if (
        (surfacedAssistantMessageAppended || pendingSurfacedSubAgentOutputs.size > 0) &&
        incomingToolCalls.length === 0 &&
        content.trim().length > 0
      ) {
        pendingPostSurfaceSuccessResponse = {
          content,
          providerReplay,
          assistantMetadata,
        };
        if (surfacedAssistantMessageAppended) commitPostSurfaceSuccessResponse();
        return;
      }
      if (
        surfacedSubAgentOutputActive &&
        incomingToolCalls.length === 0 &&
        !replacesSurfacedOutputWithTerminalFailure
      ) {
        if (providerReplay) {
          useChatStore
            .getState()
            .updateMessageProviderReplay(conversationId, activeAssistantMessageId, providerReplay);
        }
        if (assistantMetadata) {
          useChatStore
            .getState()
            .updateMessageAssistantMetadata(conversationId, activeAssistantMessageId, assistantMetadata);
        }
        return;
      }
      if (
        surfacedSubAgentOutputActive &&
        (incomingToolCalls.length > 0 || replacesSurfacedOutputWithTerminalFailure)
      ) {
        clearSurfacedSubAgentOutputLock();
      }
      toolTurns.persistAll(incomingToolCalls, activeAssistantMessageId, activeToolCallIds);
      if (providerReplay) {
        useChatStore
          .getState()
          .updateMessageProviderReplay(conversationId, activeAssistantMessageId, providerReplay);
      }
      if (assistantMetadata) {
        useChatStore
          .getState()
          .updateMessageAssistantMetadata(conversationId, activeAssistantMessageId, assistantMetadata);
      }
      if (!content) return;
      accumulatedContent = content;
      useChatStore.getState().updateMessage(conversationId, activeAssistantMessageId, content);
    },
    onToolMessage: (outcome) => {
      if (!transcriptMutationAllowed()) return;
      const surfacedOutput = pendingSurfacedSubAgentOutputs.get(outcome.toolCallId);
      const appended = toolTurns.appendTerminalResult(
        outcome,
        surfacedOutput ? buildSurfacedSubAgentOutputToolResultSummary(surfacedOutput) : outcome.content,
      );
      if (!appended) return;
      toolMessageAppendedSinceAssistantTurn = true;
      hasAppendedToolMessage = true;
      flushReadySurfacedSubAgentOutputs();
    },
    onError: terminalOutcome.recordError,
    onCompaction: (event) => {
      if (!transcriptMutationAllowed()) return;
      applyOrchestratorCompactionEffect({
        effect: buildOrchestratorCompactionEffect({
          event,
          includeLogEntry: false,
        }),
        actions: {
          applyConversationCompaction: (messages) => {
            useChatStore.getState().applyConversationCompaction(conversationId, messages);
          },
          writeCompactionSummary: (summary) => {
            try {
              editWorkingBlock('compaction_summary', summary, {
                conversationId,
              });
            } catch {
              // Memory write is best-effort; never break compaction
            }
          },
        },
      });
    },
    onUsage: () => {},
    onDone: () => {
      if (!transcriptMutationAllowed()) return;
      flushReadySurfacedSubAgentOutputs();
      commitPostSurfaceSuccessResponse();
      commitTerminalFailureResponse();
    },
  };

  return {
    callbacks,
    flushReadySurfacedSubAgentOutputs,
    commitPostSurfaceSuccessResponse,
    commitTerminalFailureResponse,
    finalizeSurfacedOutputSuccess,
    getActiveAssistantMessageId: () => activeAssistantMessageId,
    getAccumulatedContent: () => accumulatedContent,
    getGraphFailureResponseApplied: () => graphFailureResponseApplied,
  };
}
