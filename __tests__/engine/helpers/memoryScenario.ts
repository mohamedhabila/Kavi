import {
  ensureFactSchema,
  resetFactSchemaCacheForTests,
} from '../../../src/services/memory/schema';
import { closeMemoryDb } from '../../../src/services/memory/database';
import { __resetMemoryLifecycleForTests } from '../../../src/services/memory/lifecycle';
import {
  getWorkingBlock,
  type WorkingBlockLabel,
} from '../../../src/services/memory/workingBlocks';
import { useChatStore } from '../../../src/store/useChatStore';
import { useSettingsStore } from '../../../src/store/useSettingsStore';

export function resetMemoryScenario(resetSqlite?: () => void): void {
  closeMemoryDb();
  resetSqlite?.();
  resetFactSchemaCacheForTests();
  ensureFactSchema();
  __resetMemoryLifecycleForTests();
  useSettingsStore.setState({
    disableLongTermMemory: false,
    consolidationProvider: '',
    providers: [],
  } as never);
  useChatStore.setState({ conversations: [] } as never);
}

export async function readMemoryScenarioWorkingBlock(
  conversationId: string,
  blockType: WorkingBlockLabel,
): Promise<string | null> {
  const block = getWorkingBlock(blockType, {
    conversationId,
    threadId: conversationId,
  });
  return block?.content ?? null;
}
