import { type PersistHydratableStore, waitForStoreHydration } from '../store/persistHydration';
import { flushChatStorePersistenceNow } from '../store/chatStorePersistence';
import { useChatStore } from '../store/useChatStore';
import { repairTerminalAgentRunsMissingFinalResponses } from './agents/agentRunRepair';
import { initSubAgentRegistry, listActiveSubAgents } from './agents/subAgent';
import { recoverInterruptedForegroundModelExecutions } from './executionJournal/foregroundModelExecutionRecovery';
import { maintainForegroundModelExecutionRetention } from './executionJournal/foregroundModelExecutionRetention';
import { releaseStaleForegroundModelProjectionOwners } from './executionJournal/foregroundModelProjectionCleanup';
import { maintainTerminalExecutionRetention } from './executionJournal/terminalExecutionRetention';
import {
  reconcileDurableRecoveryLifecycle,
  type DurableRecoveryLifecycleSource,
} from './executionJournal/durableRecoveryLifecycle';
import { buildToolEffectRestartDispositionResolver } from './executionJournal/toolEffectRestartDisposition';
import { listActiveToolEffectRestartInputs } from '../store/agentRuns/toolCalls';

async function waitForChatHydration(): Promise<void> {
  await waitForStoreHydration(useChatStore as typeof useChatStore & PersistHydratableStore, null);
}

let recoveryPromise: Promise<void> | null = null;
let hasCompletedInitialRecovery = false;

async function recoverForegroundJournalState(): Promise<void> {
  try {
    await recoverInterruptedForegroundModelExecutions();
  } catch (error) {
    console.warn('[startup] foreground model recovery failed:', error);
  }
  try {
    await releaseStaleForegroundModelProjectionOwners();
  } catch (error) {
    console.warn('[startup] foreground model projection cleanup failed:', error);
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
  await waitForChatHydration();

  if (initializeSubAgents) {
    await initSubAgentRegistry(useChatStore.getState().conversations);
  }
  const activeSubAgents = listActiveSubAgents();
  await reconcileDurableRecoveryLifecycle(source);
  // Reconcile journal-owned projections and exact effect receipts before the
  // AgentRun owner projects task tools or terminalizes final responses.
  await recoverForegroundJournalState();
  const recoveredChatState = useChatStore.getState();
  const resolveToolEffect = await buildToolEffectRestartDispositionResolver(
    recoveredChatState.conversations.flatMap((conversation) =>
      (conversation.agentRuns ?? [])
        .filter((run) => run.status === 'running')
        .flatMap((run) =>
          listActiveToolEffectRestartInputs({
            conversationId: conversation.id,
            messages: conversation.messages,
            run,
          }),
        ),
    ),
  );
  recoveredChatState.recoverInterruptedAgentRuns(activeSubAgents, {
    timestamp: Date.now(),
    resolveToolEffect,
  });
  await repairTerminalAgentRunsMissingFinalResponses({
    activeSubAgents,
  });
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
