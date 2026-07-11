jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import { seedE2EOracleEvidence } from '../../src/acceptance/e2eAgent/e2eOracleEvidenceSeeder';
import { resetE2EMemorySandbox } from '../../src/acceptance/e2eAgent/sandboxMemory';
import { getFactById, listFacts } from '../../src/services/memory/facts/queries';
import { buildLivingMemorySections } from '../../src/services/memory/livingMemoryBridge';
import { useSettingsStore } from '../../src/store/useSettingsStore';

const CONVERSATION_ID = 'oracle-integration-thread';
const WORKSPACE_ID = 'oracle-integration-workspace';
const ORACLE_VALUE = 'ORACLE-PROMPT-VISIBLE-42';

async function retrieveOracleValue() {
  const now = Date.now() + 1_000;
  return buildLivingMemorySections({
    messages: [
      {
        id: 'oracle-probe-user',
        role: 'user',
        content: 'What is the oracle_preference for oracle-integration-user?',
        timestamp: now - 1,
      },
    ],
    threadCreatedAt: now - 2,
    conversationId: WORKSPACE_ID,
    sourceThreadId: CONVERSATION_ID,
    taskId: null,
    personaId: 'default',
    now,
    candidateStrategy: 'lexical',
  });
}

describe('oracle evidence production retrieval integration', () => {
  const originalDisableLongTermMemory = useSettingsStore.getState().disableLongTermMemory;

  beforeEach(() => {
    resetE2EMemorySandbox();
    useSettingsStore.setState({ disableLongTermMemory: false });
  });

  afterAll(() => {
    resetE2EMemorySandbox();
    useSettingsStore.setState({ disableLongTermMemory: originalDisableLongTermMemory });
  });

  it('seeds grounded evidence, admits it to the real prompt stack, then removes it on cleanup', async () => {
    const seeded = await seedE2EOracleEvidence({
      declaration: {
        interface: 'memory_remember',
        allowSeeding: true,
        facts: [
          {
            subject: 'oracle-integration-user',
            predicate: 'oracle_preference',
            value: ORACLE_VALUE,
            scope: 'global',
          },
        ],
      },
      conversationId: CONVERSATION_ID,
      workspaceConversationId: WORKSPACE_ID,
    });

    expect(seeded.seededFactCount).toBe(1);
    expect(seeded.seededFactIds).toHaveLength(1);
    const persisted = getFactById(seeded.seededFactIds[0]);
    expect(persisted).toMatchObject({
      scope: 'conversation',
      originConversationId: WORKSPACE_ID,
      originThreadId: CONVERSATION_ID,
      sourceMessageId: expect.stringMatching(/^e2e-oracle-evidence-[a-f0-9]{64}$/u),
    });

    const visible = await retrieveOracleValue();
    expect(visible.recalledFactCount).toBe(1);
    expect(visible.sections.map((section) => section.text).join('\n')).toContain(ORACLE_VALUE);
    expect(visible.retrievalEvent).toMatchObject({ status: 'recorded' });

    resetE2EMemorySandbox();
    expect(listFacts({ includeInvalidated: true })).toEqual([]);
    const cleaned = await retrieveOracleValue();
    expect(cleaned.recalledFactCount).toBe(0);
    expect(cleaned.sections.map((section) => section.text).join('\n')).not.toContain(ORACLE_VALUE);
  });
});
