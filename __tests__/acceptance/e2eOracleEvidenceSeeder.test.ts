jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import { seedE2EOracleEvidence } from '../../src/acceptance/e2eAgent/e2eOracleEvidenceSeeder';
import type { E2EOracleEvidenceDeclaration } from '../../src/acceptance/e2eAgent/e2ePairedConditions';
import type { MemoryFact } from '../../src/services/memory/facts/types';

function persistedFact(overrides: Partial<MemoryFact> = {}): MemoryFact {
  return {
    id: 'oracle-fact-id',
    subjectId: 'subject-id',
    predicate: 'preference',
    objectText: 'tea',
    objectEntityId: null,
    attributes: {},
    confidence: 1,
    sourceMessageId: null,
    sourceRunId: null,
    sourceTurnId: null,
    sourceSummary: null,
    scope: 'conversation',
    originConversationId: 'isolated-workspace',
    originThreadId: 'isolated-thread',
    originTaskId: null,
    validAt: 1,
    invalidAt: null,
    createdAt: 1,
    updatedAt: 1,
    deletedAt: null,
    pinned: false,
    importance: 0.5,
    accessCount: 0,
    lastRecalledAt: null,
    lastAccessedAt: null,
    decayPolicy: 'normal',
    decayRate: 0.03,
    retrievability: 1,
    stability: 0.5,
    memoryKind: 'semantic_fact',
    reviewState: 'auto',
    sensitivity: 'normal',
    contentHash: 'hash',
    expiresAt: null,
    ...overrides,
  };
}

describe('paired oracle evidence seeding', () => {
  it('uses the product memory tool shape while forcing isolated runtime provenance', async () => {
    const executeTool = jest.fn(async ({ conversationId, workspaceConversationId }) =>
      JSON.stringify({
        ok: true,
        status: 'created',
        fact: {
          id: 'oracle-fact-id',
          scope: 'conversation',
          originConversationId: workspaceConversationId,
          originThreadId: conversationId,
          originTaskId: null,
          sourceMessageId: null,
        },
      }),
    );
    const declaration: E2EOracleEvidenceDeclaration = {
      interface: 'memory_remember',
      allowSeeding: true,
      facts: [
        {
          subject: 'user',
          subjectType: 'self',
          predicate: 'preference',
          value: 'tea',
          confidence: 0.9,
          importance: 0.8,
          pinned: true,
          scope: 'global',
          originConversationId: 'DECLARED-ORIGIN',
          originThreadId: 'DECLARED-THREAD',
          originTaskId: 'DECLARED-TASK',
          sourceRunId: 'DECLARED-RUN',
          sourceSummary: 'DECLARED-SUMMARY',
        },
      ],
    };

    await expect(
      seedE2EOracleEvidence({
        declaration,
        conversationId: 'isolated-thread',
        workspaceConversationId: 'isolated-workspace',
        executeTool,
        readPersistedFact: () => persistedFact(),
      }),
    ).resolves.toEqual({ seededFactCount: 1 });

    expect(executeTool).toHaveBeenCalledWith({
      name: 'memory_remember',
      conversationId: 'isolated-thread',
      workspaceConversationId: 'isolated-workspace',
      args: {
        subject: 'user',
        subjectType: 'self',
        predicate: 'preference',
        value: 'tea',
        confidence: 0.9,
        importance: 0.8,
        pinned: true,
        scope: 'conversation',
      },
    });
    const serializedArgs = JSON.stringify(executeTool.mock.calls[0][0].args);
    for (const sentinel of [
      'DECLARED-ORIGIN',
      'DECLARED-THREAD',
      'DECLARED-TASK',
      'DECLARED-RUN',
      'DECLARED-SUMMARY',
    ]) {
      expect(serializedArgs).not.toContain(sentinel);
    }
  });

  it('fails closed when the product result or persisted provenance is invalid', async () => {
    const declaration: E2EOracleEvidenceDeclaration = {
      interface: 'memory_remember',
      allowSeeding: true,
      facts: [{ subject: 'user', predicate: 'preference', value: 'tea', scope: 'global' }],
    };
    await expect(
      seedE2EOracleEvidence({
        declaration,
        conversationId: 'isolated-thread',
        workspaceConversationId: 'isolated-workspace',
        executeTool: async () => '{malformed',
        readPersistedFact: () => persistedFact(),
      }),
    ).rejects.toThrow('malformed JSON');

    await expect(
      seedE2EOracleEvidence({
        declaration,
        conversationId: 'isolated-thread',
        workspaceConversationId: 'isolated-workspace',
        executeTool: async () =>
          JSON.stringify({
            ok: true,
            fact: {
              id: 'oracle-fact-id',
              scope: 'conversation',
              originConversationId: 'isolated-workspace',
              originThreadId: 'isolated-thread',
              originTaskId: null,
              sourceMessageId: null,
            },
          }),
        readPersistedFact: () => persistedFact({ sourceRunId: 'untrusted-run' }),
      }),
    ).rejects.toThrow('persisted untrusted provenance');
  });

  it('rejects non-canonical or over-limit declarations before invoking the tool', async () => {
    const executeTool = jest.fn();
    const duplicateDeclaration: E2EOracleEvidenceDeclaration = {
      interface: 'memory_remember',
      allowSeeding: true,
      facts: [
        { subject: 'user', predicate: 'preference', value: 'tea' },
        { subject: 'user', predicate: 'preference', value: 'tea' },
      ],
    };
    await expect(
      seedE2EOracleEvidence({
        declaration: duplicateDeclaration,
        conversationId: 'isolated-thread',
        workspaceConversationId: 'isolated-workspace',
        executeTool,
      }),
    ).rejects.toThrow('canonical memory_remember declaration');

    const overLimit: E2EOracleEvidenceDeclaration = {
      interface: 'memory_remember',
      allowSeeding: true,
      facts: Array.from({ length: 33 }, (_, index) => ({
        subject: 'user',
        predicate: `fact-${index}`,
        value: 'value',
      })),
    };
    await expect(
      seedE2EOracleEvidence({
        declaration: overLimit,
        conversationId: 'isolated-thread',
        workspaceConversationId: 'isolated-workspace',
        executeTool,
      }),
    ).rejects.toThrow('at most 32');
    expect(executeTool).not.toHaveBeenCalled();
  });
});
