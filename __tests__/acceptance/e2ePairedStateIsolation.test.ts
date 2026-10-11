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
import { editPromptEligibleWorkingBlock } from '../../src/services/memory/workingBlocks';
import { executeMemoryRemember } from '../../src/services/memory/core/memoryItemsTools';
import { listMemoryItems } from '../../src/services/memory/core/memoryItemsStore';
import { getMemoryDb } from '../../src/services/memory/database';
import { useChatStore } from '../../src/store/useChatStore';

describe('paired E2E state isolation', () => {
  it('keeps the reset verification list synchronized with mutable memory tables', () => {
    expect(E2E_RESETTABLE_MEMORY_TABLES).toEqual([
      'memory_consolidation_state',
      'memory_entities',
      'memory_episodes',
      'memory_fact_evidence',
      'memory_fact_term_stats',
      'memory_fact_terms',
      'memory_facts',
      'memory_ingestion_jobs',
      'memory_ingestion_source_snapshots',
      'memory_ingestion_structural_receipts',
      'memory_ingestion_receipts',
      'memory_items',
      'memory_migration_state',
      'memory_capture_cursor',
      'memory_prompt_log',
      'memory_reflections',
      'memory_retrieval_events',
      'memory_retrieval_outcomes',
      'memory_tasks',
      'memory_verified_procedure_observations',
      'memory_turns',
      'memory_working_blocks',
    ]);
  });

  it('rejects contaminated scoped working state as an incomplete reset', () => {
    resetAndVerifyE2EScenarioSandboxes();
    editPromptEligibleWorkingBlock('active_focus', 'PRIVATE-CONTAMINATED-FOCUS', {
      conversationId: 'contaminated-conversation',
      threadId: 'contaminated-thread',
    });
    expect(() => assertE2EMemorySandboxReset()).toThrow('memory_working_blocks');
    resetAndVerifyE2EScenarioSandboxes();
  });

  it('clears workspace, SQLite memory, and native state', () => {
    resetAndVerifyE2EScenarioSandboxes();
    writeWorkspaceRelativeFile('state-isolation', 'private.txt', 'PRIVATE-WORKSPACE');
    expect(
      JSON.parse(
        executeMemoryRemember(
          { content: 'The user’s preferred label is PRIVATE-MEMORY' },
          { conversationId: 'state-isolation', sourceMessageId: 'state-isolation-user', now: 1 },
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
          { conversationId: 'paired-isolation', sourceMessageId: 'paired-isolation-user', now: 1 },
        ).content,
      ),
    ).toMatchObject({ ok: true });
    getMemoryDb().runSync(
      `INSERT INTO memory_verified_procedure_observations(
        id, memory_owner_id, memory_conversation_id_hash, source_thread_id_hash,
        source_run_id_hash, procedure_id, procedure_contract_digest, platform,
        precondition_ids_json, precondition_ids_hash, evidence_manifest_json,
        evidence_manifest_digest, evidence_id_digest, linkage_digest,
        terminal_proof_digest, contract_version, observed_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'ios', '["platform.ios"]', ?, '{}', ?, ?, ?, ?, 1, 1, 1)`,
      `verified_procedure_${'a'.repeat(64)}`,
      'vault_owner_test',
      '1'.repeat(64),
      '2'.repeat(64),
      '3'.repeat(64),
      'verified-procedure.test',
      '4'.repeat(64),
      '5'.repeat(64),
      '6'.repeat(64),
      '7'.repeat(64),
      '8'.repeat(64),
      '9'.repeat(64),
    );
    expect(
      getMemoryDb().getFirstSync<{ count: number }>(
        'SELECT COUNT(*) AS count FROM memory_verified_procedure_observations',
      )?.count,
    ).toBe(1);

    await resetAndVerifyE2EPairedConditionState();

    expect(useChatStore.getState().conversations).toEqual([]);
    expect(listMemoryItems({ limit: 10, offset: 0 })).toEqual([]);
    expect(
      getMemoryDb().getFirstSync<{ count: number }>(
        'SELECT COUNT(*) AS count FROM memory_verified_procedure_observations',
      )?.count,
    ).toBe(0);
  });
});
