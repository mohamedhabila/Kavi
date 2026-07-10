jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import {
  getE2ENativeMobileFixtureStateSnapshot,
  getE2ENativeMobileInvocationSnapshots,
} from '../../src/acceptance/e2eAgent/e2eNativeMobileFixtures';
import { resetAndVerifyE2EScenarioSandboxes } from '../../src/acceptance/e2eAgent/e2ePairedStateIsolation';
import {
  assertE2EMemorySandboxReset,
  E2E_RESETTABLE_MEMORY_TABLES,
} from '../../src/acceptance/e2eAgent/sandboxMemory';
import {
  listWorkspaceRelativePaths,
  writeWorkspaceRelativeFile,
} from '../../src/acceptance/e2eAgent/sandboxWorkspace';
import { recordE2ENativeMobileInvocation } from '../../src/acceptance/e2eAgent/e2eNativeMobileEvidence';
import { listBlocks } from '../../src/services/memory/blocks';
import { editBlock } from '../../src/services/memory/blocks';
import { listFacts } from '../../src/services/memory/facts/queries';
import { executeMemoryRemember } from '../../src/services/memory/memoryTools';

describe('paired E2E state isolation', () => {
  it('keeps the reset verification list synchronized with mutable memory tables', () => {
    expect(E2E_RESETTABLE_MEMORY_TABLES).toEqual([
      'memory_chunks',
      'memory_consolidation_state',
      'memory_entities',
      'memory_episodes',
      'memory_fact_evidence',
      'memory_fact_term_stats',
      'memory_fact_terms',
      'memory_facts',
      'memory_ingestion_jobs',
      'memory_ingestion_receipts',
      'memory_migration_state',
      'memory_reflections',
      'memory_retrieval_events',
      'memory_tasks',
      'memory_working_blocks',
    ]);
  });

  it('rejects contaminated default prompt blocks as an incomplete reset', () => {
    resetAndVerifyE2EScenarioSandboxes();
    editBlock('profile', 'PRIVATE-CONTAMINATED-PROFILE', { replace: true });
    expect(() => assertE2EMemorySandboxReset()).toThrow(
      'non-canonical profile block state',
    );
    resetAndVerifyE2EScenarioSandboxes();
  });

  it('clears workspace, SQLite memory, and native state while reseeding default blocks', () => {
    resetAndVerifyE2EScenarioSandboxes();
    writeWorkspaceRelativeFile('state-isolation', 'private.txt', 'PRIVATE-WORKSPACE');
    expect(
      executeMemoryRemember({
        subject: 'user',
        predicate: 'private_fact',
        value: 'PRIVATE-MEMORY',
        scope: 'conversation',
        originConversationId: 'state-isolation',
        originThreadId: 'state-isolation',
      }),
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
    expect(listFacts({ includeInvalidated: true })).toEqual([]);
    expect(getE2ENativeMobileInvocationSnapshots()).toEqual([]);
    expect(listBlocks().length).toBeGreaterThan(0);
  });
});
