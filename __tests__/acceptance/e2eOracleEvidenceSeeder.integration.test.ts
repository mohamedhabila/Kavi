jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import { seedE2EOracleEvidence } from '../../src/acceptance/e2eAgent/e2eOracleEvidenceSeeder';
import { resetE2EMemorySandbox } from '../../src/acceptance/e2eAgent/sandboxMemory';
import { getMemoryDb } from '../../src/services/memory/database';
import { getFactById, listFacts } from '../../src/services/memory/facts/queries';
import { findEntityByName } from '../../src/services/memory/entities';
import { buildLivingMemorySections } from '../../src/services/memory/livingMemoryBridge';
import { useSettingsStore } from '../../src/store/useSettingsStore';

const CONVERSATION_ID = 'oracle-integration-thread';
const WORKSPACE_ID = 'oracle-integration-workspace';
const ORACLE_VALUE = 'ORACLE-PROMPT-VISIBLE-42';

async function retrieveOracleValue(
  query = 'What is the oracle_preference for oracle-integration-user?',
) {
  const now = Date.now() + 1_000;
  return buildLivingMemorySections({
    messages: [
      {
        id: 'oracle-probe-user',
        role: 'user',
        content: query,
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
    const seedStartedAt = Date.now();
    const declaration = {
      interface: 'memory_remember',
      allowSeeding: true,
      facts: [
        {
          subject: 'oracle-integration-user',
          predicate: 'oracle_preference',
          value: ORACLE_VALUE,
          sensitivity: 'normal',
          scope: 'global',
        },
      ],
    } as const;
    const seeded = await seedE2EOracleEvidence({
      declaration,
      conversationId: CONVERSATION_ID,
      workspaceConversationId: WORKSPACE_ID,
      claimedAt: seedStartedAt,
      seedRunId: 'e2e-oracle-integration-seed-a',
    });
    const reseeded = await seedE2EOracleEvidence({
      declaration,
      conversationId: CONVERSATION_ID,
      workspaceConversationId: WORKSPACE_ID,
      claimedAt: seedStartedAt + 10,
      seedRunId: 'e2e-oracle-integration-seed-b',
    });
    const exactReplay = await seedE2EOracleEvidence({
      declaration,
      conversationId: CONVERSATION_ID,
      workspaceConversationId: WORKSPACE_ID,
      claimedAt: seedStartedAt,
      seedRunId: 'e2e-oracle-integration-seed-a',
    });

    expect(seeded.seededFactCount).toBe(1);
    expect(seeded.seededFactIds).toHaveLength(1);
    expect(reseeded).toEqual({ seededFactCount: 1, seededFactIds: seeded.seededFactIds });
    expect(exactReplay).toEqual({ seededFactCount: 1, seededFactIds: seeded.seededFactIds });
    expect(
      getMemoryDb().getFirstSync('SELECT COUNT(*) AS count FROM memory_fact_contributions'),
    ).toEqual({ count: 2 });
    const persisted = getFactById(seeded.seededFactIds[0]);
    expect(persisted).toMatchObject({
      scope: 'conversation',
      originConversationId: WORKSPACE_ID,
      originThreadId: CONVERSATION_ID,
      sourceMessageId: expect.stringMatching(/^e2e-oracle-evidence-[a-f0-9]{64}$/u),
      validAt: seedStartedAt,
      createdAt: seedStartedAt,
      retrievability: 1,
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

  it('seeds canonical-user oracle evidence through exact first-person product grounding', async () => {
    const seeded = await seedE2EOracleEvidence({
      declaration: {
        interface: 'memory_remember',
        allowSeeding: true,
        facts: [
          {
            subject: 'user',
            subjectType: 'self',
            predicate: 'preferred_channel',
            value: 'Signal',
            sensitivity: 'normal',
            scope: 'global',
          },
        ],
      },
      conversationId: CONVERSATION_ID,
      workspaceConversationId: WORKSPACE_ID,
    });

    const persisted = getFactById(seeded.seededFactIds[0]);
    expect(persisted).toMatchObject({
      predicate: 'preferred_channel',
      objectText: 'Signal',
      factClass: 'subjective_user',
      sourceAuthority: 'grounded_user',
      sourceMessageId: expect.stringMatching(/^e2e-oracle-evidence-[a-f0-9]{64}$/u),
    });
    expect(findEntityByName('user')).toMatchObject({ canonicalName: 'user', type: 'self' });

    const visible = await retrieveOracleValue('What is my preferred_channel?');
    expect(visible.recalledFactCount).toBe(1);
    expect(visible.sections.map((section) => section.text).join('\n')).toContain('Signal');
  });
});
