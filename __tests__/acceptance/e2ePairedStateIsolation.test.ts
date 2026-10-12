jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import {
  getE2ENativeMobileFixtureStateSnapshot,
  getE2ENativeMobileInvocationSnapshots,
} from '../../src/acceptance/e2eAgent/e2eNativeMobileFixtures';
import {
  resetAndVerifyE2EPairedConditionState,
  resetAndVerifyE2EScenarioSandboxes,
} from '../../src/acceptance/e2eAgent/e2ePairedStateIsolation';
import {
  assertE2EMemorySandboxReset,
  E2E_RESETTABLE_MEMORY_TABLES,
} from '../../src/acceptance/e2eAgent/sandboxMemory';
import {
  listWorkspaceRelativePaths,
  writeWorkspaceRelativeFile,
} from '../../src/acceptance/e2eAgent/sandboxWorkspace';
import { recordE2ENativeMobileInvocation } from '../../src/acceptance/e2eAgent/e2eNativeMobileEvidence';
import { executeMemoryRemember } from '../../src/services/memory/core/memoryItemsTools';
import { listMemoryItems } from '../../src/services/memory/core/memoryItemsStore';
import { indexMemoryTurn } from '../../src/services/memory/core/memoryTurnsStore';
import { getMemoryDb } from '../../src/services/memory/database';
import { useChatStore } from '../../src/store/useChatStore';

describe('paired E2E state isolation', () => {
  it('keeps the reset verification list synchronized with mutable memory tables', () => {
    expect(E2E_RESETTABLE_MEMORY_TABLES).toEqual([
      'memory_items',
      'memory_capture_cursor',
      'memory_prompt_log',
      'memory_turns',
    ]);
  });

  it('rejects a remembered past turn left behind as an incomplete reset', () => {
    resetAndVerifyE2EScenarioSandboxes();
    indexMemoryTurn({
      conversationId: 'contaminated-conversation',
      userMessageId: 'contaminated-user',
      userText: 'PRIVATE-CONTAMINATED-PLAN',
      replyText: 'Planned.',
      at: 1,
    });
    expect(() => assertE2EMemorySandboxReset()).toThrow('memory_turns');
    resetAndVerifyE2EScenarioSandboxes();
  });

  it('clears workspace, SQLite memory, and native state', () => {
    resetAndVerifyE2EScenarioSandboxes();
    writeWorkspaceRelativeFile('state-isolation', 'private.txt', 'PRIVATE-WORKSPACE');
    expect(
      JSON.parse(
        executeMemoryRemember(
          { content: 'The user’s preferred label is PRIVATE-MEMORY' },
          {
            conversationId: 'state-isolation',
            sourceMessageId: 'state-isolation-user',
            inRequestUserMessageIds: [],
            now: 1,
          },
        ).content,
      ),
    ).toMatchObject({ ok: true });
    const nativeState = getE2ENativeMobileFixtureStateSnapshot();
    recordE2ENativeMobileInvocation({
      toolName: 'clipboard_read',
      result: JSON.stringify({ status: 'ok' }),
      stateBefore: nativeState,
      stateAfter: nativeState,
    });

    resetAndVerifyE2EScenarioSandboxes();

    expect(listWorkspaceRelativePaths('state-isolation')).toEqual([]);
    expect(listMemoryItems({ limit: 10, offset: 0 })).toEqual([]);
    expect(getE2ENativeMobileInvocationSnapshots()).toEqual([]);
  });

  it('clears memory as well as chat before every paired condition', async () => {
    resetAndVerifyE2EScenarioSandboxes();
    useChatStore.setState({
      conversations: [
        {
          id: 'contaminated-chat',
          title: 'Contaminated chat',
          messages: [],
          agentRuns: [],
          createdAt: 1,
          updatedAt: 1,
        },
      ],
      activeConversationId: 'contaminated-chat',
      isLoading: false,
    });
    expect(
      JSON.parse(
        executeMemoryRemember(
          { content: 'The user’s preferred label is MUST-NOT-CROSS-CONDITIONS' },
          {
            conversationId: 'paired-isolation',
            sourceMessageId: 'paired-isolation-user',
            inRequestUserMessageIds: [],
            now: 1,
          },
        ).content,
      ),
    ).toMatchObject({ ok: true });
    indexMemoryTurn({
      conversationId: 'contaminated-chat',
      userMessageId: 'contaminated-user',
      userText: 'MUST-NOT-CROSS-CONDITIONS plan',
      replyText: 'Planned.',
      at: 1,
    });
    expect(
      getMemoryDb().getFirstSync<{ count: number }>('SELECT COUNT(*) AS count FROM memory_turns')
        ?.count,
    ).toBe(1);

    await resetAndVerifyE2EPairedConditionState();

    expect(useChatStore.getState().conversations).toEqual([]);
    expect(listMemoryItems({ limit: 10, offset: 0 })).toEqual([]);
    expect(
      getMemoryDb().getFirstSync<{ count: number }>('SELECT COUNT(*) AS count FROM memory_turns')
        ?.count,
    ).toBe(0);
  });
});
