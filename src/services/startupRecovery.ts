import {
  type PersistHydratableStore,
  waitForRequiredStoreHydration,
} from '../store/persistHydration';
import { flushChatStorePersistenceNow } from '../store/chatStorePersistence';
import { useChatStore } from '../store/useChatStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { repairTerminalAgentRunsMissingFinalResponses } from './agents/agentRunRepair';
import { initSubAgentRegistry, listActiveSubAgents } from './agents/subAgent';
import { recoverInterruptedForegroundModelExecutions } from './executionJournal/foregroundModelExecutionRecovery';
import { maintainForegroundModelExecutionRetention } from './executionJournal/foregroundModelExecutionRetention';
import { releaseStaleForegroundExecutionProjectionOwners } from './executionJournal/foregroundExecutionProjectionCleanup';
import { maintainTerminalExecutionRetention } from './executionJournal/terminalExecutionRetention';
import {
  reconcileDurableRecoveryLifecycle,
  type DurableRecoveryLifecycleSource,
} from './executionJournal/durableRecoveryLifecycle';
import { buildToolEffectRestartDispositionResolver } from './executionJournal/toolEffectRestartDisposition';
import { listActiveToolEffectRestartInputs } from '../store/agentRuns/toolCalls';
import type { Conversation } from '../types/conversation';
import { useSchedulerStore } from './scheduler/store';
import { releaseStaleScheduledProjectionOwners } from './scheduler/scheduledProjectionRecovery';
import { settleOpenMessageMemoryPublications } from './memory/messageMemoryPublicationSettlement';

const REQUIRED_HYDRATION_TIMEOUT_MS = 5_000;

async function waitForChatHydration(): Promise<void> {
  await waitForRequiredStoreHydration(
    useChatStore as typeof useChatStore & PersistHydratableStore,
    { name: 'chat state', timeoutMs: REQUIRED_HYDRATION_TIMEOUT_MS },
  );
}

async function waitForSettingsHydration(): Promise<void> {
  await waitForRequiredStoreHydration(
    useSettingsStore as typeof useSettingsStore & PersistHydratableStore,
    { name: 'settings state', timeoutMs: REQUIRED_HYDRATION_TIMEOUT_MS },
  );
}

async function waitForSchedulerHydration(): Promise<void> {
  await waitForRequiredStoreHydration(
    useSchedulerStore as typeof useSchedulerStore & PersistHydratableStore,
    { name: 'scheduler state', timeoutMs: REQUIRED_HYDRATION_TIMEOUT_MS },
  );
}

let recoveryPromise: Promise<void> | null = null;
let hasCompletedInitialRecovery = false;

function collectForegroundExecutionOwners(
  conversations: ReadonlyArray<Conversation>,
): Map<string, Map<string, string>> {
  const owners = new Map<string, Map<string, string>>();
  for (const conversation of conversations) {
    const owner = conversation.modelProjectionOwner;
    if (!owner || owner.surface !== 'foreground') continue;
    const matchingAgentRuns = (conversation.agentRuns ?? []).filter(
      (candidate) =>
        candidate.status === 'running' && candidate.userMessageId === owner.requestMessageId,
    );
    if (matchingAgentRuns.length !== 1) continue;
    const agentRun = matchingAgentRuns[0]!;
    owners.set(conversation.id, new Map([[agentRun.id, owner.runId]]));
  }
  return owners;
}

async function recoverForegroundJournalState(): Promise<void> {
  try {
    await recoverInterruptedForegroundModelExecutions();
  } catch (error) {
    console.warn('[startup] foreground model recovery failed:', error);
  }
  try {
    await releaseStaleForegroundExecutionProjectionOwners();
  } catch (error) {
    console.warn('[startup] foreground execution projection cleanup failed:', error);
  }
  try {
    maintainForegroundModelExecutionRetention({ now: Date.now() });
  } catch (error) {
    console.warn('[startup] foreground model journal retention failed:', error);
  }
}

function maintainExternalExecutionRetention(): void {
  try {
    maintainTerminalExecutionRetention({
      now: Date.now(),
      durabilityClass: 'external_durable_operation',
    });
  } catch (error) {
    console.warn('[startup] external durable journal retention failed:', error);
  }
}

async function recoverPersistedAgentStateForSource(
  source: DurableRecoveryLifecycleSource,
  initializeSubAgents: boolean,
): Promise<void> {
  await Promise.all([
    waitForSettingsHydration(),
    waitForChatHydration(),
    waitForSchedulerHydration(),
  ]);
  await releaseStaleScheduledProjectionOwners();

  if (initializeSubAgents) {
    await initSubAgentRegistry(useChatStore.getState().conversations);
  }
  await reconcileDurableRecoveryLifecycle(source);
  if (source === 'startup') {
    const activeSubAgents = listActiveSubAgents();
    const executionRunIdByConversationAndAgentRun = collectForegroundExecutionOwners(
      useChatStore.getState().conversations,
    );
    // Only a fresh process startup revokes in-process foreground ownership.
    // A same-process foreground transition must not race a live model or tool.
    await recoverForegroundJournalState();
    const recoveredChatState = useChatStore.getState();
    const resolveToolEffect = await buildToolEffectRestartDispositionResolver(
      recoveredChatState.conversations.flatMap((conversation) =>
        (conversation.agentRuns ?? [])
          .filter((run) => run.status === 'running')
          .flatMap((run) => {
            const executionRunId = executionRunIdByConversationAndAgentRun
              .get(conversation.id)
              ?.get(run.id);
            return executionRunId
              ? listActiveToolEffectRestartInputs({
                  conversationId: conversation.id,
                  executionRunId,
                  messages: conversation.messages,
                  run,
                })
              : [];
          }),
      ),
    );
    recoveredChatState.recoverInterruptedAgentRuns(activeSubAgents, {
      timestamp: Date.now(),
      resolveToolEffect,
      executionRunIdByConversationAndAgentRun,
    });
    await repairTerminalAgentRunsMissingFinalResponses({
      activeSubAgents,
    });
  }
  await settleOpenMessageMemoryPublications();
  await flushChatStorePersistenceNow();
  maintainExternalExecutionRetention();
}

export async function recoverPersistedAgentState(): Promise<void> {
  await recoverPersistedAgentStateForSource('startup', true);
}

/** Single-flight recovery that retries on later foreground events after each completed sweep. */
export function triggerPersistedAgentRecovery(): Promise<void> {
  if (recoveryPromise) return recoveryPromise;
  recoveryPromise = recoverPersistedAgentState()
    .then(() => {
      hasCompletedInitialRecovery = true;
    })
    .finally(() => {
      recoveryPromise = null;
    });
  return recoveryPromise;
}

/** Block new foreground generations until the initial hydrated recovery sweep is complete. */
export function waitForPersistedAgentRecoveryReadiness(): Promise<void> {
  if (recoveryPromise) return recoveryPromise;
  return hasCompletedInitialRecovery ? Promise.resolve() : triggerPersistedAgentRecovery();
}

/** Retry the complete reconciliation transaction after a foreground transition. */
export function triggerForegroundPersistedAgentRecovery(): Promise<void> {
  if (recoveryPromise) return recoveryPromise;
  if (!hasCompletedInitialRecovery) return triggerPersistedAgentRecovery();
  recoveryPromise = recoverPersistedAgentStateForSource('foreground', false).finally(() => {
    recoveryPromise = null;
  });
  return recoveryPromise;
}
