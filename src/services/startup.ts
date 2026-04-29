// ---------------------------------------------------------------------------
// Kavi — App Startup Initialization
// ---------------------------------------------------------------------------
// Called once on app launch to wire up background services.

import { InteractionManager } from 'react-native';
import { startScheduler, setSchedulerExecutor } from './scheduler/engine';
import { registerBuiltInServiceSkills } from './integrations/services';
import { activateEnabledSkills } from './skills/manager';
import { registerBackgroundFetch } from './scheduler/background';
import { runBootOnce, hasBootMd } from './agents/bootRunner';
import { loadHooksFromDirectory } from './hooks/loader';
import { flushChatStorePersistenceNow } from '../store/chatStorePersistence';
import { useSettingsStore } from '../store/useSettingsStore';
import { useChatStore } from '../store/useChatStore';
import { type PersistHydratableStore, waitForStoreHydration } from '../store/persistHydration';
import { runOrchestrator, type OrchestratorCallbacks } from '../engine/orchestrator';
import type { CronJob } from './cron/types';
import { generateId } from '../utils/id';
import { initializeNotifications, sendLocalNotification } from './notifications/service';
import { hydrateCanvasSurfaces } from './canvas/renderer';
import { mcpManager } from './mcp/manager';
import { useApprovalStore } from './remote/approvalStore';
import { emitAppEvent } from './events/bus';
import { isToolResultErrorLike } from '../utils/toolResultErrors';
import { buildAssistantMessageMetadata } from '../utils/assistantMessageMetadata';
import { unrefTimerIfSupported } from '../utils/timers';
import { initSubAgentRegistry, listActiveSubAgents } from './agents/subAgent';
import { repairTerminalAgentRunsMissingFinalResponses } from './agents/agentRunRepair';
import {
  runMemoryMigrationTick,
  runMemoryBackgroundFlush,
} from './memory/lifecycle';
import {
  buildSurfacedSubAgentOutputToolResultSummary,
  parseSurfacedSubAgentOutputResult,
} from './agents/surfacedSubAgentOutput';
import {
  providerRequiresApiKey,
  resolveConversationModel,
  resolveEnabledProvider,
  resolveProviderApiKey,
} from './llm/providerSupport';
import { SUPER_AGENT_PERSONA_ID } from './agents/personas';

function shouldDeliverNotification(job: CronJob): boolean {
  const mode = job.delivery?.mode || 'both';
  return mode === 'notification' || mode === 'both';
}

function summarizeNotificationBody(text: string): string {
  const compact = text.replace(/\s+/g, ' ').trim();
  if (!compact) return 'Task completed.';
  return compact.length > 180 ? `${compact.slice(0, 177)}...` : compact;
}

function extractMessageEffect(result?: string): 'confetti' | 'balloons' | 'spotlight' | undefined {
  if (!result) return undefined;
  try {
    const parsed = JSON.parse(result);
    if (
      parsed?.effectId === 'confetti' ||
      parsed?.effectId === 'balloons' ||
      parsed?.effectId === 'spotlight'
    ) {
      return parsed.effectId;
    }
  } catch {
    // Ignore malformed tool result payloads.
  }
  return undefined;
}

let initialized = false;

async function waitForSettingsHydration(timeoutMs = 3000): Promise<void> {
  await waitForStoreHydration(
    useSettingsStore as typeof useSettingsStore & PersistHydratableStore,
    timeoutMs,
  );
}

async function waitForChatHydration(timeoutMs = 3000): Promise<void> {
  await waitForStoreHydration(
    useChatStore as typeof useChatStore & PersistHydratableStore,
    timeoutMs,
  );
}

async function recoverPersistedAgentState(): Promise<void> {
  await waitForChatHydration();

  const chatState = useChatStore.getState();
  await initSubAgentRegistry(chatState.conversations);
  const activeSubAgents = listActiveSubAgents();
  chatState.recoverInterruptedAgentRuns(activeSubAgents, {
    timestamp: Date.now(),
  });
  await repairTerminalAgentRunsMissingFinalResponses({
    activeSubAgents,
  });
}

async function reconnectPersistedMcpServers(): Promise<void> {
  await waitForSettingsHydration();
  const { mcpServers } = useSettingsStore.getState();
  if (!mcpServers?.length) {
    return;
  }

  await mcpManager.connectAll(mcpServers);
}

function scheduleNonCriticalStartupWork(task: () => void): void {
  const requestIdleCallback = (
    globalThis as {
      requestIdleCallback?: (callback: () => void) => unknown;
    }
  ).requestIdleCallback;

  if (typeof requestIdleCallback === 'function') {
    requestIdleCallback(() => {
      task();
    });
    return;
  }

  if (typeof InteractionManager?.runAfterInteractions === 'function') {
    InteractionManager.runAfterInteractions(() => {
      task();
    });
    return;
  }

  setTimeout(task, 0);
}

async function runStartupHooksAndEmitLaunchEvent(): Promise<void> {
  try {
    await loadHooksFromDirectory(async (prompt, _context) => {
      const settings = useSettingsStore.getState();
      const provider = resolveEnabledProvider(settings.providers, settings.activeProviderId);
      if (!provider) return;
      const model = resolveConversationModel(provider, {
        activeProviderId: settings.activeProviderId,
        activeModel: settings.activeModel,
      });
      if (!model) return;
      const apiKey = await resolveProviderApiKey(provider);
      if (providerRequiresApiKey(provider) && !apiKey) return;
      await runOrchestrator(
        {
          provider: { ...provider, apiKey },
          model,
          conversationId: `hook-${Date.now()}`,
          systemPrompt:
            settings.systemPrompt ||
            'You are a helpful personal AI assistant with access to tools.',
          messages: [
            {
              id: `hm-${Date.now()}`,
              role: 'user' as const,
              content: prompt,
              timestamp: Date.now(),
            },
          ],
          signal: new AbortController(),
        },
        {
          onStateChange: () => {},
          onToken: () => {},
          onToolCallStart: () => {},
          onToolCallComplete: () => {},
          onAssistantMessage: () => {},
          onToolMessage: () => {},
          onError: () => {},
          onDone: () => {},
        },
      );
    });
  } catch (e) {
    console.warn('[startup] loadHooksFromDirectory failed:', e);
  }

  try {
    await emitAppEvent('launch');
  } catch (e) {
    console.warn('[startup] emitAppEvent(launch) failed:', e);
  }
}

async function runBootOnLaunchIfPresent(): Promise<void> {
  try {
    const hasBoot = await hasBootMd();
    if (!hasBoot) return;
    const settings = useSettingsStore.getState();
    const provider = resolveEnabledProvider(settings.providers, settings.activeProviderId);
    if (!provider) return;
    const model = resolveConversationModel(provider, {
      activeProviderId: settings.activeProviderId,
      activeModel: settings.activeModel,
    });
    if (!model) return;
    const apiKey = await resolveProviderApiKey(provider);
    if (providerRequiresApiKey(provider) && !apiKey) return;
    await runBootOnce({ ...provider, apiKey }, settings.providers, model);
  } catch {
    // Boot execution is non-critical
  }
}

function initializeDeferredStartupServices(): void {
  // Keep first render responsive by pushing non-essential startup I/O
  // and model-triggered work until the app reaches an idle window.
  scheduleNonCriticalStartupWork(() => {
    void hydrateCanvasSurfaces().catch((e) =>
      console.warn('[startup] hydrateCanvasSurfaces failed:', e),
    );
    void initializeNotifications().catch((e) =>
      console.warn('[startup] initializeNotifications failed:', e),
    );
    void registerBackgroundFetch().catch((e) =>
      console.warn('[startup] registerBackgroundFetch failed:', e),
    );
    void runStartupHooksAndEmitLaunchEvent();
    void runBootOnLaunchIfPresent();
    void runMemoryMigrationTick().catch((e) =>
      console.warn('[startup] runMemoryMigrationTick failed:', e),
    );
  });
}

async function executeScheduledJob(job: CronJob): Promise<string> {
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
                settings.defaultConversationMode === 'agentic'
                  ? SUPER_AGENT_PERSONA_ID
                  : undefined,
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
                settings.defaultConversationMode === 'agentic'
                  ? SUPER_AGENT_PERSONA_ID
                  : undefined,
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
    const pendingSurfacedSubAgentOutputs = new Map<
      string,
      NonNullable<ReturnType<typeof parseSurfacedSubAgentOutputResult>>
    >();
    let surfacedSubAgentOutputActive = false;

    const clearSurfacedSubAgentOutputLock = () => {
      surfacedSubAgentOutputActive = false;
    };

    const queueSurfacedSubAgentOutput = (toolCall: {
      id: string;
      result?: string;
    }): boolean => {
      const surfacedOutput = parseSurfacedSubAgentOutputResult(toolCall.result);
      if (!surfacedOutput) {
        pendingSurfacedSubAgentOutputs.delete(toolCall.id);
        return false;
      }

      pendingSurfacedSubAgentOutputs.set(toolCall.id, surfacedOutput);
      return true;
    };

    const flushSurfacedSubAgentOutput = (toolCallId: string) => {
      const surfacedOutput = pendingSurfacedSubAgentOutputs.get(toolCallId);
      if (!surfacedOutput) {
        return false;
      }

      pendingSurfacedSubAgentOutputs.delete(toolCallId);
      surfacedSubAgentOutputActive = true;
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

    const callbacks: OrchestratorCallbacks = {
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
        clearSurfacedSubAgentOutputLock();
        useChatStore.getState().addToolCall(conversationId, assistantMessageId, toolCall);
      },
      onToolCallComplete: (toolCall) => {
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
          const effectId = extractMessageEffect(toolCall.result);
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
        if (surfacedSubAgentOutputActive && incomingToolCalls.length === 0) {
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
        if (surfacedSubAgentOutputActive && incomingToolCalls.length > 0) {
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
      onError: (error) => {
        flushPendingSurfacedSubAgentOutputs();
        if (surfacedSubAgentOutputActive && accumulatedContent) {
          return;
        }
        const fallback = accumulatedContent || `Error: ${error.message}`;
        accumulatedContent = fallback;
        useChatStore.getState().updateMessage(conversationId, assistantMessageId, fallback);
      },
      onCompaction: (event) => {
        useChatStore.getState().applyConversationCompaction(conversationId, event.messages);
      },
      onUsage: () => {},
      onDone: () => {
        flushPendingSurfacedSubAgentOutputs();
      },
    };

    const messages =
      useChatStore
        .getState()
        .conversations.find((conversation) => conversation.id === conversationId)
        ?.messages.filter((message) => message.id !== assistantMessageId) || [];

    await runOrchestrator(
      {
        provider: { ...provider, apiKey },
        model,
        conversationId,
        systemPrompt:
          settings.systemPrompt || 'You are a helpful personal AI assistant with access to tools.',
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

    const result = accumulatedContent || `Scheduled task "${job.name}" completed.`;

    if (shouldDeliverNotification(job)) {
      await sendLocalNotification({
        title: job.name || 'Scheduled Task',
        body: summarizeNotificationBody(result),
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
    if (shouldDeliverNotification(job)) {
      await sendLocalNotification({
        title: job.name || 'Scheduled Task Failed',
        body: summarizeNotificationBody(`Error: ${errorMsg}`),
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

export function initializeServices(): void {
  if (initialized) return;
  initialized = true;

  void recoverPersistedAgentState().catch((e) =>
    console.warn('[startup] recoverPersistedAgentState failed:', e),
  );

  // Register built-in service skills (weather, news, etc.)
  registerBuiltInServiceSkills();
  activateEnabledSkills();

  void reconnectPersistedMcpServers().catch((e) =>
    console.warn('[startup] reconnectPersistedMcpServers failed:', e),
  );

  // Set up scheduler executor to run jobs through the main orchestrator.
  setSchedulerExecutor({
    execute: executeScheduledJob,
  });

  // Start the foreground scheduler to evaluate cron jobs
  startScheduler();

  // Sweep expired approval requests every 30 seconds
  const approvalSweepInterval = setInterval(() => {
    useApprovalStore.getState().sweepExpired();
  }, 30_000);
  unrefTimerIfSupported(approvalSweepInterval);

  initializeDeferredStartupServices();
}

/**
 * Lifecycle hook called when the app moves from background → foreground.
 * Currently used to throttle-tick the memory migration seed runner so the
 * v6→v7 archived-thread backlog drains across sessions.
 */
export function handleAppForeground(): void {
  void runMemoryMigrationTick().catch((e) =>
    console.warn('[startup] foreground memory tick failed:', e),
  );
}

/**
 * Lifecycle hook called when the app moves to background. Flushes dirty
 * consolidator threads via the configured `consolidationProvider`.
 */
export function handleAppBackground(): void {
  void runMemoryBackgroundFlush().catch((e) =>
    console.warn('[startup] background memory flush failed:', e),
  );
}
