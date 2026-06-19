import { ensureDefaultBlocks } from '../../../src/services/memory/blocks';
import { ensureFactSchema, resetFactSchemaCacheForTests } from '../../../src/services/memory/schema';
import { closeMemoryDb } from '../../../src/services/memory/sqlite-store';
import { __resetMemoryLifecycleForTests } from '../../../src/services/memory/lifecycle';
import { getWorkingBlock } from '../../../src/services/memory/workingBlocks';
import { useChatStore } from '../../../src/store/useChatStore';
import { useSettingsStore } from '../../../src/store/useSettingsStore';

export function resetMemoryScenario(resetSqlite?: () => void): void {
  closeMemoryDb();
  resetSqlite?.();
  resetFactSchemaCacheForTests();
  ensureFactSchema();
  ensureDefaultBlocks();
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
  blockType: string,
): Promise<string | null> {
  const block = await getWorkingBlock(conversationId, blockType);
  return block?.content ?? null;
}