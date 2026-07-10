import { type PersistHydratableStore, waitForStoreHydration } from '../store/persistHydration';
import { useChatStore } from '../store/useChatStore';
import { repairTerminalAgentRunsMissingFinalResponses } from './agents/agentRunRepair';
import { initSubAgentRegistry, listActiveSubAgents } from './agents/subAgent';
import { recoverInterruptedForegroundModelExecutions } from './executionJournal/foregroundModelExecutionRecovery';
import { maintainAllForegroundModelExecutionRetention } from './executionJournal/foregroundModelExecutionRetention';
import { releaseStaleForegroundModelProjectionOwners } from './executionJournal/foregroundModelProjectionCleanup';

async function waitForChatHydration(): Promise<void> {
  await waitForStoreHydration(
    useChatStore as typeof useChatStore & PersistHydratableStore,
    null,
  );
}

let recoveryPromise: Promise<void> | null = null;
let hasCompletedInitialRecovery = false;

async function recoverForegroundJournalState(): Promise<void> {
  await waitForChatHydration();
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
    maintainAllForegroundModelExecutionRetention({ now: Date.now() });
  } catch (error) {
    console.warn('[startup] foreground model journal retention failed:', error);
  }
}

export async function recoverPersistedAgentState(): Promise<void> {
  await waitForChatHydration();

  const chatState = useChatStore.getState();
  await initSubAgentRegistry(chatState.conversations);
  const activeSubAgents = listActiveSubAgents();
  chatState.recoverInterruptedAgentRuns(activeSubAgents, {
    timestamp: Date.now(),
  });
  await recoverForegroundJournalState();
  await repairTerminalAgentRunsMissingFinalResponses({
    activeSubAgents,
  });
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

/** Retry only journal-owned projection cleanup on foreground; live AgentRuns remain untouched. */
export function triggerForegroundJournalRecovery(): Promise<void> {
  if (recoveryPromise) return recoveryPromise;
  if (!hasCompletedInitialRecovery) return triggerPersistedAgentRecovery();
  recoveryPromise = recoverForegroundJournalState().finally(() => {
    recoveryPromise = null;
  });
  return recoveryPromise;
}
