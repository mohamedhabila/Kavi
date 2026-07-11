// ---------------------------------------------------------------------------
// Kavi — App Startup Initialization
// ---------------------------------------------------------------------------
// Called once on app launch to wire up background services.

import { InteractionManager } from 'react-native';
import { evaluateJobsOnce, startScheduler, setSchedulerExecutor } from './scheduler/engine';
import { executeScheduledJob } from './scheduler/jobExecutor';
import { registerBuiltInServiceSkills } from './integrations/registry';
import { activateEnabledSkills } from './skills/manager';
import { registerBackgroundFetch } from './scheduler/background';
import { syncSchedulerWakeNotifications } from './scheduler/wakeNotifications';
import { runBootOnLaunchIfPresent } from './agents/bootLaunch';
import { loadHooksFromDirectory } from './hooks/loader';
import { useSettingsStore } from '../store/useSettingsStore';
import { useChatStore } from '../store/useChatStore';
import { type PersistHydratableStore, waitForStoreHydration } from '../store/persistHydration';
import { runOrchestrator } from '../engine/orchestrator';
import { initializeNotifications } from './notifications/service';
import { hydrateCanvasSurfaces } from './canvas/renderer';
import { mcpManager } from './mcp/manager';
import { useApprovalStore } from './remote/approvalStore';
import { emitAppEvent } from './events/bus';
import { unrefTimerIfSupported } from '../utils/timers';
import { runMemoryMigrationTick, runMemoryBackgroundFlush } from './memory/lifecycle';
import { initializeMemoryPolicyObservation } from './memory/policy';
import { removeRetiredMemoryFileArtifacts } from './memory/retiredMemoryArtifacts';
import {
  providerRequiresApiKey,
  resolveConversationModel,
  resolveEnabledProvider,
  resolveProviderApiKey,
} from './llm/support/providerSupport';
import { resolveConversationPersonaForMode } from '../engine/graph/conversation/modeTransitions';
import { createAgentControlGraphTerminalOutcomeTracker } from '../engine/graph/terminalOutcome';
import { initializeDurableRecoveryLifecycle } from './executionJournal/durableRecoveryLifecycle';
import {
  triggerForegroundPersistedAgentRecovery,
  triggerPersistedAgentRecovery,
} from './startupRecovery';

let initialized = false;

async function waitForSettingsHydration(timeoutMs = 3000): Promise<void> {
  await waitForStoreHydration(
    useSettingsStore as typeof useSettingsStore & PersistHydratableStore,
    timeoutMs,
  );
}

async function waitForMemoryStoresHydration(): Promise<void> {
  await Promise.all([
    waitForStoreHydration(
      useSettingsStore as typeof useSettingsStore & PersistHydratableStore,
      null,
    ),
    waitForStoreHydration(useChatStore as typeof useChatStore & PersistHydratableStore, null),
  ]);
}

async function runHydratedMemoryMaintenance(includeMigration: boolean): Promise<void> {
  await waitForMemoryStoresHydration();
  await runMemoryBackgroundFlush();
  if (includeMigration) {
    await runMemoryMigrationTick();
  }
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
      const terminalOutcome = createAgentControlGraphTerminalOutcomeTracker();
      await runOrchestrator(
        {
          provider: { ...provider, apiKey },
          model,
          conversationId: `hook-${Date.now()}`,
          personaId: resolveConversationPersonaForMode({
            nextMode: settings.defaultConversationMode,
          }),
          taskId: null,
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
          onAgentControlGraphStateChange: terminalOutcome.recordControlGraphState,
          onStateChange: () => {},
          onToken: () => {},
          onToolCallStart: () => {},
          onToolCallComplete: () => {},
          onAssistantMessage: () => {},
          onToolMessage: () => {},
          onError: terminalOutcome.recordError,
          onDone: () => {},
        },
      );
      terminalOutcome.throwIfFailed();
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

async function initializeNotificationsAndWakeSync(): Promise<void> {
  await initializeNotifications();
  await syncSchedulerWakeNotifications({ force: true });
}

function initializeDeferredStartupServices(): void {
  // Keep first render responsive by pushing non-essential startup I/O
  // and model-triggered work until the app reaches an idle window.
  scheduleNonCriticalStartupWork(() => {
    void hydrateCanvasSurfaces().catch((e) =>
      console.warn('[startup] hydrateCanvasSurfaces failed:', e),
    );
    void initializeNotificationsAndWakeSync().catch((e) =>
      console.warn('[startup] initializeNotificationsAndWakeSync failed:', e),
    );
    void registerBackgroundFetch().catch((e) =>
      console.warn('[startup] registerBackgroundFetch failed:', e),
    );
    void runStartupHooksAndEmitLaunchEvent();
    void runBootOnLaunchIfPresent();
    void runHydratedMemoryMaintenance(true).catch((e) =>
      console.warn('[startup] hydrated memory maintenance failed:', e),
    );
  });
}


let retiredMemoryFileCleanupComplete = false;

function removeRetiredMemoryFileArtifactsUntilComplete(): void {
  if (retiredMemoryFileCleanupComplete) return;
  try {
    removeRetiredMemoryFileArtifacts();
    retiredMemoryFileCleanupComplete = true;
  } catch (error) {
    console.warn('[startup] retired memory file cleanup failed:', error);
  }
}

export function initializeServices(): void {
  removeRetiredMemoryFileArtifactsUntilComplete();
  if (initialized) return;
  initialized = true;

  initializeDurableRecoveryLifecycle();

  if (!initializeMemoryPolicyObservation()) {
    console.warn('[startup] memory policy observation unavailable; durable memory is disabled');
  }

  void triggerPersistedAgentRecovery().catch((e) =>
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
  void triggerForegroundPersistedAgentRecovery().catch((e) =>
    console.warn('[startup] foreground persisted-agent recovery failed:', e),
  );
  void evaluateJobsOnce({ trigger: 'foreground-reconcile' }).catch((e) =>
    console.warn('[startup] foreground scheduler reconciliation failed:', e),
  );
  void syncSchedulerWakeNotifications({ force: true }).catch((e) =>
    console.warn('[startup] foreground wake notification sync failed:', e),
  );
  void runHydratedMemoryMaintenance(true).catch((e) =>
    console.warn('[startup] foreground hydrated memory maintenance failed:', e),
  );
}

/**
 * Lifecycle hook called when the app moves to background. Flushes dirty
 * consolidator threads via the configured `consolidationProvider`.
 */
export function handleAppBackground(): void {
  void runHydratedMemoryMaintenance(false).catch((e) =>
    console.warn('[startup] background hydrated memory flush failed:', e),
  );
}
