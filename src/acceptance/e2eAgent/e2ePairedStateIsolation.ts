import {
  flushChatStorePersistenceNow,
  requestChatStorePersistenceCheckpoint,
} from '../../store/chatStorePersistence';
import { useChatStore } from '../../store/useChatStore';
import { useSettingsStore } from '../../store/useSettingsStore';
import {
  getE2ENativeMobileFixtureStateSnapshot,
  getE2ENativeMobileInvocationSnapshots,
  resetE2ENativeMobileFixtures,
} from './e2eNativeMobileFixtures';
import { assertE2EMemorySandboxReset, resetE2EMemorySandbox } from './sandboxMemory';
import { assertE2EWorkspaceSandboxReset, resetE2EWorkspaceSandbox } from './sandboxWorkspace';

export function resetAndVerifyE2EScenarioSandboxes(): void {
  resetE2EWorkspaceSandbox();
  resetE2EMemorySandbox();
  resetE2ENativeMobileFixtures();
  assertE2EWorkspaceSandboxReset();
  assertE2EMemorySandboxReset();
  assertE2ENativeMobileFixturesReset();
}

function assertE2ENativeMobileFixturesReset(): void {
  if (getE2ENativeMobileInvocationSnapshots().length !== 0) {
    throw new Error('E2E native fixture reset left invocation evidence.');
  }
  const leaves: unknown[] = [];
  const visit = (value: unknown): void => {
    if (value && typeof value === 'object') {
      Object.values(value as Record<string, unknown>).forEach(visit);
    } else {
      leaves.push(value);
    }
  };
  visit(getE2ENativeMobileFixtureStateSnapshot());
  if (leaves.some((value) => value !== '' && value !== false && value !== 0)) {
    throw new Error('E2E native fixture reset left mutable device state.');
  }
}

export async function resetAndVerifyE2EPairedChatState(): Promise<void> {
  useChatStore.setState({
    conversations: [],
    activeConversationId: null,
    isLoading: false,
  });
  requestChatStorePersistenceCheckpoint(0);
  await flushChatStorePersistenceNow();
  const state = useChatStore.getState();
  if (state.conversations.length !== 0 || state.activeConversationId !== null || state.isLoading) {
    throw new Error('E2E paired reset left chat or agent-run state behind.');
  }
}

export async function resetAndVerifyE2EPairedConditionState(): Promise<void> {
  await resetAndVerifyE2EPairedChatState();
  resetAndVerifyE2EScenarioSandboxes();
}

export async function withE2EPairedStoreIsolation<T>(
  task: () => Promise<T>,
): Promise<T> {
  const chatSnapshot = useChatStore.getState();
  const settingsSnapshot = useSettingsStore.getState();
  let taskFailed = false;
  try {
    return await task();
  } catch (error) {
    taskFailed = true;
    throw error;
  } finally {
    try {
      useChatStore.setState(chatSnapshot, true);
      useSettingsStore.setState(settingsSnapshot, true);
      requestChatStorePersistenceCheckpoint(0);
      await flushChatStorePersistenceNow();
    } catch (restorationError) {
      if (!taskFailed) throw restorationError;
    }
  }
}
