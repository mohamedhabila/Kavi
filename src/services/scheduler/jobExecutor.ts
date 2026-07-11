import { NonRetryableSchedulerExecutionError } from './executionError';
import {
  extractScheduledJobMessageEffect,
  shouldDeliverScheduledJobNotification,
  summarizeScheduledJobNotification,
} from './executionPresentation';
import { flushChatStorePersistenceNow } from '../../store/chatStorePersistence';
import { useSettingsStore } from '../../store/useSettingsStore';
import { useChatStore } from '../../store/useChatStore';
import { runOrchestrator, type OrchestratorCallbacks } from '../../engine/orchestrator';
import type { CronJob } from '../cron/types';
import { generateId } from '../../utils/id';
import { sendLocalNotification } from '../notifications/service';
import { isToolResultErrorLike } from '../../utils/toolResultErrors';
import { buildAssistantMessageMetadata } from '../../utils/assistantMessageMetadata';
import { editWorkingBlock } from '../memory/workingBlocks';
import {
  buildSurfacedSubAgentOutputToolResultSummary,
  parseSurfacedSubAgentOutputResult,
} from '../agents/surfacedSubAgentOutput';
import {
  applyOrchestratorCompactionEffect,
  buildOrchestratorCompactionEffect,
} from '../../engine/orchestratorCompactionEffect';
import {
  providerRequiresApiKey,
  resolveConversationModel,
  resolveEnabledProvider,
  resolveProviderApiKey,
} from '../llm/support/providerSupport';
import { SUPER_AGENT_PERSONA_ID } from '../agents/personas';
import { resolveConversationPersonaForMode } from '../../engine/graph/conversation/modeTransitions';
import { createAgentControlGraphTerminalOutcomeTracker } from '../../engine/graph/terminalOutcome';
import type { AssistantMessageMetadata, MessageProviderReplay } from '../../types/message';

interface PendingTerminalFailureResponse {
  content: string;
  providerReplay?: MessageProviderReplay;
  assistantMetadata?: AssistantMessageMetadata;
}

function buildTerminalFailureMetadata(
  assistantMetadata?: AssistantMessageMetadata,
): AssistantMessageMetadata {
  return {
    ...assistantMetadata,
    kind: 'final',
    completionStatus: 'incomplete',
    finishReason: 'response_failed',
  };
}

export async function executeScheduledJob(job: CronJob): Promise<string> {
  let notificationConversationId: string | undefined;

  try {
    const prompt = job.payload?.prompt?.trim();
    if (!prompt) {
      throw new Error(`Scheduled task "${job.name}" is missing a prompt`);
    }

    const settings = useSettingsStore.getState();
    const provider = resolveEnabledProvider(
      settings.providers,
      job.payload?.providerId || settings.activeProviderId,
    );

    if (!provider) {
      throw new Error('No enabled provider configured for scheduled task execution');
    }

    const model =
      job.payload?.model ||
      resolveConversationModel(provider, {
        activeProviderId: settings.activeProviderId,
        activeModel: settings.activeModel,
      }) ||
      provider.model;
    if (!model) {
      throw new Error(`Scheduled task "${job.name}" has no model configured`);
    }

    const apiKey = await resolveProviderApiKey(provider);
    if (providerRequiresApiKey(provider) && !apiKey) {
      throw new Error(`Missing API key for provider "${provider.name}"`);
    }

    const chatState = useChatStore.getState();
    const existingConversationId =
      (job.delivery?.conversationId &&
      chatState.conversations.some(
        (conversation) => conversation.id === job.delivery?.conversationId,
      )
        ? job.delivery.conversationId
        : undefined) ||
      (job.sessionTarget === 'main' && job.wakeMode === 'continue'
        ? chatState.activeConversationId || undefined
        : undefined);

    const conversationId = existingConversationId
      ? existingConversationId
      : job.sessionTarget === 'main'
        ? chatState.getOrCreateCanonicalThread(
            provider.id,
            settings.systemPrompt ||
              'You are a helpful personal AI assistant with access to tools.',
            model,
            {
              activate: false,
              personaId:
                settings.defaultConversationMode === 'agentic' ? SUPER_AGENT_PERSONA_ID : undefined,
              mode: settings.defaultConversationMode,
            },
          )
        : chatState.createConversation(
            provider.id,
            settings.systemPrompt ||
              'You are a helpful personal AI assistant with access to tools.',
            model,
            {
              activate: false,
              personaId:
                settings.defaultConversationMode === 'agentic' ? SUPER_AGENT_PERSONA_ID : undefined,
              mode: settings.defaultConversationMode,
            },
          );
    notificationConversationId = conversationId;

    chatState.updateModelInConversation(conversationId, provider.id, model);

    chatState.addMessage(conversationId, {
      id: generateId(),
      role: 'user',
      content: prompt,
    });

    const assistantMessageId = generateId();
    chatState.addMessage(conversationId, {
      id: assistantMessageId,
      role: 'assistant',
      content: '',
    });

    let accumulatedContent = '';
    let accumulatedReasoning = '';
    let observedToolActivity = false;
    let graphFailureResponseApplied = false;
    const terminalOutcome = createAgentControlGraphTerminalOutcomeTracker();
    const pendingSurfacedSubAgentOutputs = new Map<
      string,
      NonNullable<ReturnType<typeof parseSurfacedSubAgentOutputResult>>
    >();
    let surfacedSubAgentOutputActive = false;
    let surfacedAssistantMessageAppended = false;
    let pendingTerminalFailureResponse: PendingTerminalFailureResponse | undefined;
    let terminalFailureResponseCommitted = false;

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
      accumulatedContent = surfacedOutput.output;

      chatState.addMessage(conversationId, {
        id: generateId(),
        role: 'assistant',
        content: surfacedOutput.output,
        assistantMetadata: buildAssistantMessageMetadata('final', {
          completionStatus: 'incomplete',
          finishReason: 'surfaced_worker_output_pending',
        }),
      });
      return true;
    };

    const flushPendingSurfacedSubAgentOutputs = () => {
      for (const toolCallId of Array.from(pendingSurfacedSubAgentOutputs.keys())) {
        flushSurfacedSubAgentOutput(toolCallId);
      }
    };

    const commitTerminalFailureResponse = (fallback?: PendingTerminalFailureResponse): boolean => {
      if (terminalFailureResponseCommitted) return true;
      const response = pendingTerminalFailureResponse ?? fallback;
      if (!response?.content.trim()) return false;

      const assistantMetadata = buildTerminalFailureMetadata(response.assistantMetadata);
      accumulatedContent = response.content;
      graphFailureResponseApplied = true;
      terminalFailureResponseCommitted = true;
      pendingTerminalFailureResponse = undefined;
      clearSurfacedSubAgentOutputLock();

      if (surfacedAssistantMessageAppended) {
        chatState.addMessage(conversationId, {
          id: generateId(),
          role: 'assistant',
          content: response.content,
          providerReplay: response.providerReplay,
          assistantMetadata,
          isError: true,
        });
        return true;
      }

      chatState.updateMessage(conversationId, assistantMessageId, response.content);
      if (response.providerReplay) {
        chatState.updateMessageProviderReplay(
          conversationId,
          assistantMessageId,
          response.providerReplay,
        );
      }
      chatState.updateMessageAssistantMetadata(
        conversationId,
        assistantMessageId,
        assistantMetadata,
      );
      return true;
    };

    const callbacks: OrchestratorCallbacks = {
      onAgentControlGraphStateChange: terminalOutcome.recordControlGraphState,
      onStateChange: () => {},
      onToken: (token) => {
        if (surfacedSubAgentOutputActive) {
          return;
        }
        accumulatedContent += token;
        useChatStore
          .getState()
          .updateMessage(conversationId, assistantMessageId, accumulatedContent);
      },
      onReasoning: (token) => {
        if (surfacedSubAgentOutputActive) {
          return;
        }
        accumulatedReasoning += token;
        useChatStore
          .getState()
          .updateMessageReasoning(conversationId, assistantMessageId, accumulatedReasoning);
      },
      onAssistantStreamReset: () => {
        accumulatedContent = '';
        accumulatedReasoning = '';
        useChatStore.getState().updateMessage(conversationId, assistantMessageId, '');
        useChatStore.getState().updateMessageReasoning(conversationId, assistantMessageId, '');
      },
      onUserMessageEnriched: (messageId, enrichedContent) => {
        useChatStore
          .getState()
          .updateMessageEnrichedContent(conversationId, messageId, enrichedContent);
      },
      onToolCallStart: (toolCall) => {
        observedToolActivity = true;
        clearSurfacedSubAgentOutputLock();
        useChatStore.getState().addToolCall(conversationId, assistantMessageId, toolCall);
      },
      onToolCallComplete: (toolCall) => {
        observedToolActivity = true;
        const surfacedOutput =
          toolCall.name === 'sessions_surface_output' && toolCall.status === 'completed'
            ? parseSurfacedSubAgentOutputResult(toolCall.result)
            : undefined;

        useChatStore
          .getState()
          .updateToolCallStatus(conversationId, assistantMessageId, toolCall.id, toolCall.status, {
            result: surfacedOutput
              ? buildSurfacedSubAgentOutputToolResultSummary(surfacedOutput)
              : toolCall.result,
            error: toolCall.error,
          });
        if (toolCall.name === 'message_effect') {
          const effectId = extractScheduledJobMessageEffect(toolCall.result);
          if (effectId) {
            useChatStore
              .getState()
              .updateMessageEffect(conversationId, assistantMessageId, effectId);
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
        const incomingToolCalls =
          toolCalls?.filter((toolCall) => toolCall.id?.trim() && toolCall.name?.trim()) ?? [];
        const replacesSurfacedOutputWithTerminalFailure =
          content.trim().length > 0 && terminalOutcome.hasUnsuccessfulTerminalState();
        if (replacesSurfacedOutputWithTerminalFailure) {
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
          surfacedSubAgentOutputActive &&
          incomingToolCalls.length === 0 &&
          !replacesSurfacedOutputWithTerminalFailure
        ) {
          if (providerReplay) {
            useChatStore
              .getState()
              .updateMessageProviderReplay(conversationId, assistantMessageId, providerReplay);
          }
          if (assistantMetadata) {
            useChatStore
              .getState()
              .updateMessageAssistantMetadata(
                conversationId,
                assistantMessageId,
                assistantMetadata,
              );
          }
          return;
        }
        if (
          surfacedSubAgentOutputActive &&
          (incomingToolCalls.length > 0 || replacesSurfacedOutputWithTerminalFailure)
        ) {
          clearSurfacedSubAgentOutputLock();
        }
        if (providerReplay) {
          useChatStore
            .getState()
            .updateMessageProviderReplay(conversationId, assistantMessageId, providerReplay);
        }
        if (assistantMetadata) {
          useChatStore
            .getState()
            .updateMessageAssistantMetadata(conversationId, assistantMessageId, assistantMetadata);
        }
        if (!content) return;
        accumulatedContent = content;
        useChatStore.getState().updateMessage(conversationId, assistantMessageId, content);
      },
      onToolMessage: (toolCallId, result) => {
        observedToolActivity = true;
        const surfacedOutput = pendingSurfacedSubAgentOutputs.get(toolCallId);
        useChatStore.getState().addMessage(conversationId, {
          id: `${assistantMessageId}_tool_${toolCallId}`,
          role: 'tool',
          content: surfacedOutput
            ? buildSurfacedSubAgentOutputToolResultSummary(surfacedOutput)
            : result,
          toolCallId,
          isError: isToolResultErrorLike(result),
        });
        flushSurfacedSubAgentOutput(toolCallId);
      },
      onError: terminalOutcome.recordError,
      onCompaction: (event) => {
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
        flushPendingSurfacedSubAgentOutputs();
        commitTerminalFailureResponse();
      },
    };

    const messages =
      useChatStore
        .getState()
        .conversations.find((conversation) => conversation.id === conversationId)
        ?.messages.filter((message) => message.id !== assistantMessageId) || [];

    try {
      await runOrchestrator(
        {
          provider: { ...provider, apiKey },
          model,
          conversationId,
          personaId: resolveConversationPersonaForMode({
            conversationPersonaId: useChatStore
              .getState()
              .conversations.find((conversation) => conversation.id === conversationId)?.personaId,
            nextMode:
              useChatStore
                .getState()
                .conversations.find((conversation) => conversation.id === conversationId)?.mode ??
              settings.defaultConversationMode,
          }),
          taskId: null,
          systemPrompt:
            settings.systemPrompt ||
            'You are a helpful personal AI assistant with access to tools.',
          messages,
          signal: new AbortController(),
          thinkingLevel: settings.thinkingLevel,
          allProviders: settings.providers.map((candidate) => ({ ...candidate })),
          enableCompaction: true,
          enableFailover: true,
          linkUnderstandingEnabled: settings.linkUnderstandingEnabled,
          mediaUnderstandingEnabled: settings.mediaUnderstandingEnabled,
          maxLinks: settings.maxLinks,
        },
        callbacks,
      );
      flushPendingSurfacedSubAgentOutputs();
      commitTerminalFailureResponse();
    } catch (error: unknown) {
      const sourceError = error instanceof Error ? error : new Error(String(error));
      flushPendingSurfacedSubAgentOutputs();
      commitTerminalFailureResponse({
        content: `Error: ${sourceError.message}`,
      });
      if (observedToolActivity) {
        throw new NonRetryableSchedulerExecutionError(sourceError);
      }
      throw error;
    }

    const terminalFailure = terminalOutcome.resolveFailure();
    if (terminalFailure) {
      flushPendingSurfacedSubAgentOutputs();
      const failureContent =
        graphFailureResponseApplied && accumulatedContent.trim()
          ? accumulatedContent
          : `Error: ${terminalFailure.message}`;
      commitTerminalFailureResponse({ content: failureContent });
      throw terminalOutcome.hasControlGraphFailure() || observedToolActivity
        ? new NonRetryableSchedulerExecutionError(terminalFailure)
        : terminalFailure;
    }

    const result = accumulatedContent || `Scheduled task "${job.name}" completed.`;

    if (shouldDeliverScheduledJobNotification(job)) {
      await sendLocalNotification({
        title: job.name || 'Scheduled Task',
        body: summarizeScheduledJobNotification(result),
        data: {
          screen: 'Chat',
          conversationId,
          source: 'scheduled_task',
        },
      });
    }

    await flushChatStorePersistenceNow();

    return result;
  } catch (error: unknown) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    if (shouldDeliverScheduledJobNotification(job)) {
      await sendLocalNotification({
        title: job.name || 'Scheduled Task Failed',
        body: summarizeScheduledJobNotification(`Error: ${errorMsg}`),
        data: notificationConversationId
          ? {
              screen: 'Chat',
              conversationId: notificationConversationId,
              source: 'scheduled_task',
            }
          : undefined,
      }).catch((e) => console.warn('[startup] Failed to send task failure notification:', e));
    }

    await flushChatStorePersistenceNow();
    throw error;
  }
}
