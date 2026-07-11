jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import { ensureDefaultBlocks } from '../../../src/services/memory/blocks';
import { upsertEntity } from '../../../src/services/memory/entities';
import { addFactEvidence } from '../../../src/services/memory/episodes/mutations';
import {
  recordFactWithApplicability,
  setFactPinned,
} from '../../../src/services/memory/facts/mutations';
import type { SealedFactApplicabilityProvenance } from '../../../src/services/memory/facts/applicabilityProvenance';
import { buildLivingMemorySections } from '../../../src/services/memory/livingMemoryBridge';
import { readRecentMemoryRetrievalEvents } from '../../../src/services/memory/retrievalLog';
import {
  ensureFactSchema,
  resetFactSchemaCacheForTests,
} from '../../../src/services/memory/schema';
import { closeMemoryDb } from '../../../src/services/memory/database';
import * as memoryDatabase from '../../../src/services/memory/database';
import * as factObservations from '../../../src/services/memory/facts/observations';
import type { Message } from '../../../src/types/message';

const expoSqlite = require('expo-sqlite') as { __resetExpoSqliteForTests: () => void };
const MEMORY_CONVERSATION_ID = 'policy-memory-conversation';
const SOURCE_THREAD_ID = 'policy-source-thread';
const QUERY_TOKEN = 'opaque-policy-anchor';

function userMessage(): Message {
  return {
    id: 'policy-user-message',
    role: 'user',
    content: QUERY_TOKEN,
    timestamp: 2_000,
  } as Message;
}

beforeEach(() => {
  closeMemoryDb();
  expoSqlite.__resetExpoSqliteForTests();
  resetFactSchemaCacheForTests();
  ensureFactSchema();
  ensureDefaultBlocks();
});

afterEach(() => {
  closeMemoryDb();
  jest.restoreAllMocks();
});

function seedFact(input: {
  predicate: string;
  value: string;
  reviewState?: 'auto' | 'verified' | 'pending_review' | 'stale' | 'conflicted' | 'rejected';
  sensitivity?: 'normal' | 'personal' | 'sensitive' | 'restricted';
  sealedApplicability?: SealedFactApplicabilityProvenance;
  evidence?: string;
}): string {
  const subject = upsertEntity({ name: `subject-${input.predicate}`, type: 'concept', now: 500 });
  const factInput = {
    subjectId: subject.id,
    predicate: input.predicate,
    objectText: `${QUERY_TOKEN} ${input.value}`,
    scope: 'conversation' as const,
    originConversationId: MEMORY_CONVERSATION_ID,
    originThreadId: SOURCE_THREAD_ID,
    sourceMessageId: `source-${input.predicate}`,
    reviewState: input.reviewState,
    sensitivity: input.sensitivity,
    importance: 1,
    confidence: 0.95,
    now: 1_000,
  };
  const recorded = recordFactWithApplicability(
    factInput,
    input.sealedApplicability ?? {
      factClass: 'subjective_user',
      sourceAuthority: 'grounded_user',
    },
  );
  setFactPinned(recorded.fact.id, true, 1_100);
  if (input.evidence) {
    addFactEvidence({
      factId: recorded.fact.id,
      messageId: `source-${input.predicate}`,
      role: 'user',
      quote: input.evidence,
      now: 1_200,
    });
  }
  return recorded.fact.id;
}

function dynamicPrompt(output: Awaited<ReturnType<typeof buildLivingMemorySections>>): string {
  return output.sections
    .filter((section) => !section.cacheable)
    .map((section) => section.text)
    .join('\n');
}

describe('living memory applicability integration', () => {
  it('filters before prompt and provenance expansion while retaining ask/abstain resolution', async () => {
    const visibleId = seedFact({
      predicate: 'visible_state',
      value: 'visible-memory-value',
      evidence: 'visible-local-evidence',
    });
    const staleId = seedFact({
      predicate: 'stale_state',
      value: 'stale-memory-value',
      reviewState: 'stale',
    });
    const sensitiveId = seedFact({
      predicate: 'sensitive_state',
      value: 'sensitive-memory-value',
      sensitivity: 'sensitive',
      evidence: 'sensitive-local-evidence',
    });
    const objectiveId = seedFact({
      predicate: 'objective_state',
      value: 'objective-memory-value',
      sealedApplicability: {
        factClass: 'objective',
        sourceAuthority: 'external_source',
      },
    });

    const output = await buildLivingMemorySections({
      messages: [userMessage()],
      conversationId: MEMORY_CONVERSATION_ID,
      sourceThreadId: SOURCE_THREAD_ID,
      personaId: 'default',
      taskId: null,
      now: 3_000,
      recallLimit: 12,
      externalMemoryEvidence: [
        {
          factId: objectiveId,
          relation: 'conflicts',
          factClass: 'objective',
          sourceAuthority: 'external_source',
          sourceKind: 'external_record',
          sourceId: 'external-record-1',
          observedAt: 2_500,
        },
      ],
    });
    const prompt = dynamicPrompt(output);

    expect(output.recalledFactCount).toBe(3);
    expect(output.applicabilityPolicy).toMatchObject({
      state: 'applied',
      candidateFactCount: 3,
      factActions: { use: 1, ask: 1, abstain: 1, silent: 0 },
    });
    expect(output.timings?.applicabilityPolicyMs).toEqual(expect.any(Number));
    expect(prompt).toContain('visible-memory-value');
    expect(prompt).toContain('stale-memory-value');
    expect(prompt).toContain('objective-memory-value');
    expect(prompt).not.toContain('sensitive-memory-value');
    expect(prompt).not.toContain('sensitive-local-evidence');
    expect(prompt).toContain('### Memory Resolution Required');
    expect(prompt).toContain('policy=ask reason=stale_memory');
    expect(prompt).toContain('policy=abstain reason=objective_external_conflict');

    expect(output.localEvidenceExpansion).toMatchObject({
      requestedSourceCount: 1,
      acceptedSourceCount: 1,
      sourceWithEvidenceCount: 1,
      emittedEvidenceCount: 1,
    });
    expect(prompt).toContain('visible-local-evidence');

    const event = readRecentMemoryRetrievalEvents()[0];
    expect(event).toMatchObject({
      counts: {
        candidateFactCount: 3,
        selectedFactCount: 3,
        selectedFactIds: expect.arrayContaining([visibleId, staleId, objectiveId]),
      },
    });
    expect(event?.counts.selectedFactIds).not.toContain(sensitiveId);

    const serializedSummary = JSON.stringify(output.applicabilityPolicy);
    expect(serializedSummary).not.toContain(visibleId);
    expect(serializedSummary).not.toContain(staleId);
    expect(serializedSummary).not.toContain(sensitiveId);
    expect(serializedSummary).not.toContain(objectiveId);
    expect(serializedSummary).not.toContain('memory-value');
    expect(serializedSummary).not.toContain('local-evidence');
  });

  it('degrades and abstains when persisted contradiction evidence cannot be read', async () => {
    seedFact({
      predicate: 'read_failure_state',
      value: 'must-not-be-used-after-read-failure',
      evidence: 'must-not-expand-after-read-failure',
    });
    jest
      .spyOn(factObservations, 'loadActiveMemoryFactConflictSignals')
      .mockImplementationOnce(() => {
        throw new Error('injected_observation_read_failure');
      });

    const output = await buildLivingMemorySections({
      messages: [userMessage()],
      conversationId: MEMORY_CONVERSATION_ID,
      sourceThreadId: SOURCE_THREAD_ID,
      personaId: 'default',
      taskId: null,
      now: 3_000,
    });
    const prompt = dynamicPrompt(output);

    expect(output.applicabilityPolicy).toMatchObject({
      state: 'degraded',
      factActions: { use: 0, ask: 0, abstain: 1, silent: 0 },
    });
    expect(prompt).toContain('policy=abstain reason=conflict_observation_read_failed');
    expect(prompt).not.toContain('must-not-expand-after-read-failure');
    expect(output.localEvidenceExpansion).toMatchObject({ requestedSourceCount: 0 });
    expect(readRecentMemoryRetrievalEvents()[0]).toMatchObject({ outcome: 'degraded' });
  });

  it('preserves memory-off parity with zero policy counts and no durable access', async () => {
    seedFact({ predicate: 'private_state', value: 'must-not-be-read' });
    const databaseSpy = jest.spyOn(memoryDatabase, 'getMemoryDb');

    const output = await buildLivingMemorySections({
      messages: [userMessage()],
      conversationId: MEMORY_CONVERSATION_ID,
      sourceThreadId: SOURCE_THREAD_ID,
      personaId: 'default',
      taskId: null,
      disableLongTermMemory: true,
      now: 3_000,
    });

    expect(output.sections).toEqual([]);
    expect(output.recalledFactCount).toBe(0);
    expect(output.recalledEpisodeCount).toBe(0);
    expect(output.retrievalEvent).toBeUndefined();
    expect(output.applicabilityPolicy).toMatchObject({
      state: 'disabled',
      candidateFactCount: 0,
      factActions: { use: 0, ask: 0, abstain: 0, silent: 0 },
    });
    expect(databaseSpy).not.toHaveBeenCalled();
  });
});
