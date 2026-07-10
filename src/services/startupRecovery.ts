import { type PersistHydratableStore, waitForStoreHydration } from '../store/persistHydration';
import { useChatStore } from '../store/useChatStore';
import { repairTerminalAgentRunsMissingFinalResponses } from './agents/agentRunRepair';
import { initSubAgentRegistry, listActiveSubAgents } from './agents/subAgent';
import { recoverInterruptedForegroundModelExecutions } from './executionJournal/foregroundModelExecutionRecovery';

async function waitForChatHydration(timeoutMs = 3000): Promise<void> {
  await waitForStoreHydration(
    useChatStore as typeof useChatStore & PersistHydratableStore,
    timeoutMs,
  );
}

export async function recoverPersistedAgentState(): Promise<void> {
  await waitForChatHydration();

  const chatState = useChatStore.getState();
  await initSubAgentRegistry(chatState.conversations);
  const activeSubAgents = listActiveSubAgents();
  chatState.recoverInterruptedAgentRuns(activeSubAgents, {
    timestamp: Date.now(),
  });
  try {
    await recoverInterruptedForegroundModelExecutions();
  } catch (error) {
    console.warn('[startup] foreground model recovery failed:', error);
  }
  await repairTerminalAgentRunsMissingFinalResponses({
    activeSubAgents,
  });
}
