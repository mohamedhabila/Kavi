jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import { runMemoryTransaction } from '../../../src/services/memory/access/transaction';
import { closeMemoryDb, getMemoryDb } from '../../../src/services/memory/database';
import { upsertEntity } from '../../../src/services/memory/entities';
import { decodeMemoryFactContributionPayload } from '../../../src/services/memory/factContributionCodec';
import {
  raiseScopedMemoryFactSensitivityFloor,
  setManagedMemoryFactPinned,
  setScopedMemoryFactReviewState,
} from '../../../src/services/memory/factExplicitOverrides';
import { loadFactExplicitOverrideInTransaction } from '../../../src/services/memory/factExplicitOverrideState';
import {
  persistFactContributionInTransaction,
  type MemoryFactContributionWriteContext,
} from '../../../src/services/memory/factContributionStore';
import { replaceCurrentFactWithContribution } from '../../../src/services/memory/facts/exactReplacement';
import { normalizeRecordFactMutation } from '../../../src/services/memory/facts/mutationNormalization';
import {
  recordFactWithApplicability,
  recordFactWithContribution,
} from '../../../src/services/memory/facts/mutations';
import type { RecordFactInput } from '../../../src/services/memory/facts/types';
import { resolveLocalMemoryAccessScope } from '../../../src/services/memory/memoryScopeStore';
import {
  clearStructuredMemory,
  ensureFactSchema,
  resetFactSchemaCacheForTests,
} from '../../../src/services/memory/schema';

const expoSqlite = require('expo-sqlite') as { __resetExpoSqliteForTests: () => void };
const grounded = { factClass: 'subjective_user', sourceAuthority: 'grounded_user' } as const;

beforeEach(() => {
  closeMemoryDb();
  expoSqlite.__resetExpoSqliteForTests();
  resetFactSchemaCacheForTests();
  ensureFactSchema();
});

afterEach(() => {
  clearStructuredMemory();
  closeMemoryDb();
  expoSqlite.__resetExpoSqliteForTests();
});

function subjectId(): string {
  return upsertEntity({ type: 'self', name: 'user', now: 1 }).id;
}

function globalFact(
  subject: string,
  objectText: string,
  overrides: Partial<RecordFactInput> = {},
): RecordFactInput {
  return {
    subjectId: subject,
    predicate: 'favorite_color',
    objectText,
    scope: 'global',
    sourceMessageId: 'user-message-1',
    sourceTurnId: 'assistant-turn-1',
    now: 100,
    ...overrides,
  };
}

function context(
  producerEventId: string,
  aliases: MemoryFactContributionWriteContext['sourceAliases'] = [
    { sourceKind: 'message', sourceId: 'user-message-1' },
    { sourceKind: 'turn', sourceId: 'assistant-turn-1' },
  ],
  scope: Partial<
    Pick<MemoryFactContributionWriteContext, 'memoryConversationId' | 'sourceThreadId' | 'taskId'>
  > = {},
): MemoryFactContributionWriteContext {
  return {
    memoryConversationId: scope.memoryConversationId ?? 'conversation-1',
    sourceThreadId: scope.sourceThreadId ?? 'thread-1',
    taskId: scope.taskId ?? null,
    producer: { producerId: 'test_writer', producerEventId },
    sourceAliases: aliases,
  };
}

function contributionCount(): number {
  return (
    getMemoryDb().getFirstSync<{ count: number }>(
      'SELECT COUNT(*) AS count FROM memory_fact_contributions',
    )?.count ?? 0
  );
}

function factProjection(factId: string) {
  return getMemoryDb().getFirstSync<{
    pinned: number;
    review_state: string;
    sensitivity: string;
    repeated_mention_count: number;
  }>(
    `SELECT pinned, review_state, sensitivity, repeated_mention_count
       FROM memory_facts
      WHERE id = ? LIMIT 1`,
    factId,
  );
}

function factRows(): Array<{
  id: string;
  object_text: string;
  attributes: string;
  confidence: number;
  fact_class: string;
  source_authority: string;
  invalid_at: number | null;
  memory_owner_id: string;
}> {
  return getMemoryDb().getAllSync(
    `SELECT id, object_text, attributes, confidence, fact_class, source_authority,
            invalid_at, memory_owner_id
       FROM memory_facts
      ORDER BY created_at ASC, id ASC`,
  );
}

function contributionPayloads() {
  return getMemoryDb()
    .getAllSync<{
      payload_version: number;
      payload_json: string;
      payload_sha256: string;
      payload_byte_length: number;
    }>(
      `SELECT payload_version, payload_json, payload_sha256, payload_byte_length
         FROM memory_fact_contributions
        ORDER BY contributed_at ASC, id ASC`,
    )
    .map((row) =>
      decodeMemoryFactContributionPayload({
        payloadVersion: row.payload_version,
        payloadJson: row.payload_json,
        payloadSha256: row.payload_sha256,
        payloadByteLength: row.payload_byte_length,
      }),
    );
}

describe('atomic contributed fact mutations', () => {
  it('creates one contribution and replays the exact causal event idempotently', () => {
    const subject = subjectId();
    const input = globalFact(subject, 'blue', { attributes: { explicit: true } });
    const source = context('event-1');

    expect(recordFactWithContribution(input, grounded, source).status).toBe('created');
    expect(recordFactWithContribution(input, grounded, source).status).toBe('duplicate');
    expect(() =>
      recordFactWithContribution(
        input,
        grounded,
        context('event-1', [
          { sourceKind: 'message', sourceId: 'user-message-1' },
          { sourceKind: 'turn', sourceId: 'assistant-turn-1' },
          { sourceKind: 'run', sourceId: 'extra-run' },
        ]),
      ),
    ).toThrow('memory_fact_contribution_replay_mismatch');
    expect(contributionCount()).toBe(1);
    expect(
      getMemoryDb().getAllSync<{ source_kind: string; source_id: string }>(
        `SELECT source_kind, source_id FROM memory_fact_contribution_sources
          ORDER BY source_kind ASC, source_id ASC`,
      ),
    ).toEqual([
      { source_kind: 'message', source_id: 'user-message-1' },
      { source_kind: 'turn', source_id: 'assistant-turn-1' },
    ]);
  });

  it('keeps distinct source contributions unmerged and replays the later event once', () => {
    const subject = subjectId();
    recordFactWithContribution(
      globalFact(subject, 'blue', {
        attributes: { first: true },
        confidence: 0.9,
      }),
      grounded,
      context('event-1'),
    );
    const secondInput = globalFact(subject, 'blue', {
      attributes: { second: true },
      confidence: 0.4,
      sourceMessageId: 'user-message-2',
      sourceTurnId: 'assistant-turn-2',
      now: 200,
    });
    const secondSource = context('event-2', [
      { sourceKind: 'message', sourceId: 'user-message-2' },
      { sourceKind: 'turn', sourceId: 'assistant-turn-2' },
    ]);
    const second = recordFactWithContribution(secondInput, grounded, secondSource);

    expect(second.fact.confidence).toBe(0.9);
    expect(second.fact.attributes).toEqual({ first: true, second: true });
    expect(contributionCount()).toBe(2);
    const payloads = contributionPayloads();
    expect(payloads[1]!.input.confidence).toBe(0.4);
    expect(payloads[1]!.input.attributes).toEqual({ second: true });
    expect(recordFactWithContribution(secondInput, grounded, secondSource)).toMatchObject({
      fact: { id: second.fact.id, repeatedMentionCount: 1 },
    });
    expect(contributionCount()).toBe(2);
    expect(contributionPayloads()).toEqual(payloads);
  });

  it('repairs duplicate projections from canonical intent without rewriting causal payloads', () => {
    const subject = subjectId();
    const originalInput = globalFact(subject, 'blue', { pinned: true });
    const originalSource = context('event-1');
    const original = recordFactWithContribution(originalInput, grounded, originalSource).fact;
    const currentScope = resolveLocalMemoryAccessScope({
      memoryConversationId: 'conversation-1',
      sourceThreadId: 'thread-1',
      personaId: 'default',
      taskId: null,
    });

    setManagedMemoryFactPinned({ factId: original.id, pinned: false, now: 200 });
    setScopedMemoryFactReviewState({
      factId: original.id,
      currentScope,
      reviewState: 'verified',
      now: 210,
    });
    raiseScopedMemoryFactSensitivityFloor({
      factId: original.id,
      currentScope,
      sensitivityFloor: 'sensitive',
      now: 220,
    });
    const canonicalIntent = loadFactExplicitOverrideInTransaction(original.id);
    expect(canonicalIntent).toMatchObject({
      pinnedOverride: false,
      pinnedAt: 200,
      reviewStateOverride: 'verified',
      reviewStateAt: 210,
      sensitivityFloor: 'sensitive',
      sensitivityFloorAt: 220,
      updatedAt: 220,
    });

    getMemoryDb().runSync(
      `UPDATE memory_facts
          SET pinned = 1, review_state = 'rejected', sensitivity = 'normal'
        WHERE id = ?`,
      original.id,
    );

    expect(() =>
      recordFactWithContribution(
        originalInput,
        grounded,
        context('event-1', [
          { sourceKind: 'message', sourceId: 'user-message-1' },
          { sourceKind: 'turn', sourceId: 'assistant-turn-1' },
          { sourceKind: 'run', sourceId: 'unexpected-run' },
        ]),
      ),
    ).toThrow('memory_fact_contribution_replay_mismatch');
    expect(factProjection(original.id)).toEqual({
      pinned: 1,
      review_state: 'rejected',
      sensitivity: 'normal',
      repeated_mention_count: 0,
    });
    expect(loadFactExplicitOverrideInTransaction(original.id)).toEqual(canonicalIntent);

    const replay = recordFactWithContribution(originalInput, grounded, originalSource);
    expect(replay).toMatchObject({
      status: 'duplicate',
      fact: {
        id: original.id,
        pinned: false,
        reviewState: 'verified',
        sensitivity: 'sensitive',
        repeatedMentionCount: 0,
      },
    });
    expect(factProjection(original.id)).toEqual({
      pinned: 0,
      review_state: 'verified',
      sensitivity: 'sensitive',
      repeated_mention_count: 0,
    });
    expect(contributionCount()).toBe(1);
    expect(loadFactExplicitOverrideInTransaction(original.id)).toEqual(canonicalIntent);

    const duplicate = recordFactWithContribution(
      globalFact(subject, 'blue', {
        pinned: true,
        reviewState: 'rejected',
        sourceMessageId: 'user-message-2',
        sourceTurnId: 'assistant-turn-2',
        now: 300,
      }),
      grounded,
      context('event-2', [
        { sourceKind: 'message', sourceId: 'user-message-2' },
        { sourceKind: 'turn', sourceId: 'assistant-turn-2' },
      ]),
    );

    expect(duplicate).toMatchObject({
      status: 'duplicate',
      fact: {
        id: original.id,
        pinned: false,
        reviewState: 'verified',
        sensitivity: 'sensitive',
        repeatedMentionCount: 1,
      },
    });
    expect(factProjection(original.id)).toEqual({
      pinned: 0,
      review_state: 'verified',
      sensitivity: 'sensitive',
      repeated_mention_count: 1,
    });
    expect(contributionCount()).toBe(2);
    expect(contributionPayloads()[1]!.input).toMatchObject({
      pinned: true,
      reviewState: 'rejected',
    });
    expect(loadFactExplicitOverrideInTransaction(original.id)).toEqual(canonicalIntent);
  });

  it('rejects changed metadata for one event and rolls back aggregate provenance changes', () => {
    const subject = subjectId();
    const input = globalFact(subject, 'blue');
    const source = context('event-1');
    recordFactWithContribution(
      input,
      { factClass: 'unknown', sourceAuthority: 'assistant_inferred' },
      source,
    );

    expect(() => recordFactWithContribution(input, grounded, source)).toThrow(
      'memory_fact_contribution_replay_mismatch',
    );
    expect(factRows()).toEqual([
      expect.objectContaining({
        fact_class: 'unknown',
        source_authority: 'assistant_inferred',
      }),
    ]);
    expect(contributionCount()).toBe(1);
  });

  it('rejects a changed fact for one event and rolls back the newly created row', () => {
    const subject = subjectId();
    const source = context('event-1');
    recordFactWithContribution(globalFact(subject, 'blue'), grounded, source);

    expect(() =>
      recordFactWithContribution(globalFact(subject, 'green'), grounded, source),
    ).toThrow('memory_fact_contribution_replay_mismatch');
    expect(factRows().map((row) => row.object_text)).toEqual(['blue']);
    expect(contributionCount()).toBe(1);
  });

  it('atomically records an exact replacement edge and effective inherited metadata', () => {
    const subject = subjectId();
    const previous = recordFactWithContribution(
      globalFact(subject, 'blue', {
        pinned: true,
        reviewState: 'verified',
        memoryKind: 'decision',
      }),
      grounded,
      context('event-old'),
    ).fact;
    getMemoryDb().runSync(
      `UPDATE memory_facts
          SET sensitivity = 'normal', sensitivity_policy_version = 1
        WHERE id = ?`,
      previous.id,
    );
    const replacement = replaceCurrentFactWithContribution(
      {
        ...globalFact(subject, 'green', {
          sourceMessageId: 'user-message-2',
          sourceTurnId: 'assistant-turn-2',
          now: 200,
        }),
        expectedCurrentFactId: previous.id,
      },
      grounded,
      context('event-new', [
        { sourceKind: 'message', sourceId: 'user-message-2' },
        { sourceKind: 'turn', sourceId: 'assistant-turn-2' },
      ]),
    );
    expect(replacement.status).toBe('created');
    if (replacement.status === 'conflict') throw new Error('unexpected conflict');
    expect(replacement.fact.pinned).toBe(true);
    expect(replacement.fact.reviewState).toBe('verified');
    expect(replacement.fact.sensitivity).toBe('restricted');
    expect(replacement.fact.memoryKind).toBe('decision');
    expect(replacement.superseded.map((fact) => fact.id)).toEqual([previous.id]);
    expect(
      getMemoryDb().getAllSync<{
        predecessor_fact_id: string;
        successor_fact_id: string;
        superseded_at: number;
        pinned_input_explicit: number;
        review_state_input_explicit: number;
        successor_pinned_baseline: number;
        successor_review_state_baseline: string;
        successor_sensitivity_floor: string;
        successor_sensitivity_policy_version: number;
      }>(
        `SELECT edge.predecessor_fact_id, edge.successor_fact_id, edge.superseded_at,
                snapshot.pinned_input_explicit, snapshot.review_state_input_explicit,
                snapshot.successor_pinned_baseline,
                snapshot.successor_review_state_baseline,
                snapshot.successor_sensitivity_floor,
                snapshot.successor_sensitivity_policy_version
           FROM memory_fact_contribution_supersessions AS edge
           JOIN memory_fact_contribution_supersession_snapshots AS snapshot
             ON snapshot.contribution_id = edge.contribution_id`,
      ),
    ).toEqual([
      {
        predecessor_fact_id: previous.id,
        successor_fact_id: replacement.fact.id,
        superseded_at: 200,
        pinned_input_explicit: 0,
        review_state_input_explicit: 0,
        successor_pinned_baseline: 1,
        successor_review_state_baseline: 'verified',
        successor_sensitivity_floor: 'restricted',
        successor_sensitivity_policy_version: 2,
      },
    ]);
    const replacementPayload = contributionPayloads()[1]!;
    expect(replacementPayload.input.pinned).toBe(false);
    expect(replacementPayload.input.reviewState).toBe('auto');
    expect(replacementPayload.input.memoryKind).toBe('decision');
    expect(replacementPayload.input.supersedePrior).toBe(false);
    resetFactSchemaCacheForTests();
    expect(() => ensureFactSchema()).not.toThrow();
  });

  it('inherits exact current metadata for a contributed same-value replacement', () => {
    const subject = subjectId();
    const current = recordFactWithContribution(
      globalFact(subject, 'blue', {
        attributes: { initial: true },
        confidence: 0.4,
        importance: 0.2,
        pinned: true,
        reviewState: 'verified',
        memoryKind: 'goal',
      }),
      grounded,
      context('event-old'),
    ).fact;

    const replacementInput = {
      ...globalFact(subject, 'blue', {
        sourceMessageId: 'user-message-2',
        sourceTurnId: 'assistant-turn-2',
        now: 200,
      }),
      expectedCurrentFactId: current.id,
    };
    const replacementSource = context('event-same-value', [
      { sourceKind: 'message', sourceId: 'user-message-2' },
      { sourceKind: 'turn', sourceId: 'assistant-turn-2' },
    ]);
    const duplicate = replaceCurrentFactWithContribution(
      replacementInput,
      grounded,
      replacementSource,
    );

    expect(duplicate.status).toBe('duplicate');
    if (duplicate.status === 'conflict') throw new Error('unexpected conflict');
    expect(duplicate.fact.id).toBe(current.id);
    expect(duplicate.fact.pinned).toBe(true);
    expect(duplicate.fact.reviewState).toBe('verified');
    expect(duplicate.fact.memoryKind).toBe('goal');
    expect(factRows()).toHaveLength(1);
    expect(contributionCount()).toBe(2);
    const payload = contributionPayloads()[1]!;
    expect(payload.input.pinned).toBe(false);
    expect(payload.input.reviewState).toBe('auto');
    expect(payload.input.memoryKind).toBe('goal');

    const later = recordFactWithContribution(
      globalFact(subject, 'blue', {
        attributes: { later: true },
        confidence: 0.9,
        importance: 0.8,
        memoryKind: 'goal',
        sourceMessageId: 'user-message-3',
        sourceTurnId: 'assistant-turn-3',
        now: 300,
      }),
      grounded,
      context('event-later', [
        { sourceKind: 'message', sourceId: 'user-message-3' },
        { sourceKind: 'turn', sourceId: 'assistant-turn-3' },
      ]),
    );
    expect(later.fact).toMatchObject({
      id: current.id,
      confidence: 0.9,
      importance: 0.8,
      repeatedMentionCount: 2,
    });
    const stablePayloads = contributionPayloads();
    expect(
      replaceCurrentFactWithContribution(replacementInput, grounded, replacementSource),
    ).toMatchObject({
      status: 'duplicate',
      fact: { id: current.id, repeatedMentionCount: 2 },
    });
    expect(contributionCount()).toBe(3);
    expect(contributionPayloads()).toEqual(stablePayloads);
  });

  it('does not create a contribution when exact replacement conflicts', () => {
    const subject = subjectId();
    const result = replaceCurrentFactWithContribution(
      {
        ...globalFact(subject, 'green'),
        expectedCurrentFactId: 'fact-missing',
      },
      grounded,
      context('event-conflict'),
    );

    expect(result).toMatchObject({ status: 'conflict', conflict: 'target_changed' });
    expect(contributionCount()).toBe(0);
    expect(factRows()).toEqual([]);
  });

  it('rolls back fact creation for invalid aliases and exact source scope', () => {
    const subject = subjectId();
    expect(() =>
      recordFactWithContribution(globalFact(subject, 'blue'), grounded, context('event-1', [])),
    ).toThrow('memory_fact_contribution_sources_invalid');

    expect(() =>
      recordFactWithContribution(
        {
          subjectId: subject,
          predicate: 'session_state',
          objectText: 'active',
          scope: 'session',
          originConversationId: 'conversation-1',
          originThreadId: 'thread-1',
          originTaskId: 'task-1',
          now: 100,
        },
        grounded,
        context('event-2', [{ sourceKind: 'turn', sourceId: 'assistant-turn-1' }], {
          taskId: 'task-2',
        }),
      ),
    ).toThrow('memory_fact_contribution_scope_mismatch');
    expect(factRows()).toEqual([]);
    expect(contributionCount()).toBe(0);
  });

  it('rolls back when payload sources are missing or have the wrong alias kind', () => {
    const subject = subjectId();
    const input = globalFact(subject, 'blue', { sourceRunId: 'run-1' });

    expect(() =>
      recordFactWithContribution(
        input,
        grounded,
        context('event-wrong-kind', [
          { sourceKind: 'turn', sourceId: 'user-message-1' },
          { sourceKind: 'turn', sourceId: 'assistant-turn-1' },
          { sourceKind: 'run', sourceId: 'run-1' },
        ]),
      ),
    ).toThrow('memory_fact_contribution_source_alias_missing');
    expect(() =>
      recordFactWithContribution(
        input,
        grounded,
        context('event-missing-run', [
          { sourceKind: 'message', sourceId: 'user-message-1' },
          { sourceKind: 'turn', sourceId: 'assistant-turn-1' },
        ]),
      ),
    ).toThrow('memory_fact_contribution_source_alias_missing');
    expect(factRows()).toEqual([]);
    expect(contributionCount()).toBe(0);
  });

  it('rolls back when normalized fact metadata cannot form a valid ledger payload', () => {
    const subject = subjectId();
    expect(() =>
      recordFactWithContribution(
        globalFact(subject, 'blue', {
          attributes: { invalid: undefined } as unknown as Record<string, unknown>,
        }),
        grounded,
        context('event-invalid-payload'),
      ),
    ).toThrow('memory_fact_contribution_payload_invalid');
    expect(factRows()).toEqual([]);
    expect(contributionCount()).toBe(0);
  });

  it('rejects foreign-owner and content mismatches without leaving transaction changes', () => {
    const subject = subjectId();
    const input = globalFact(subject, 'blue');
    const fact = recordFactWithApplicability(input, grounded).fact;
    const payload = normalizeRecordFactMutation(input, grounded);
    const owner = fact.memoryOwnerId!;

    expect(() =>
      runMemoryTransaction(() => {
        getMemoryDb().runSync(
          "UPDATE memory_facts SET memory_owner_id = 'foreign-owner' WHERE id = ?",
          fact.id,
        );
        persistFactContributionInTransaction({
          fact,
          payload,
          context: context('event-owner'),
          supersession: {
            superseded: [],
            pinnedInputExplicit: false,
            reviewStateInputExplicit: false,
          },
        });
      }),
    ).toThrow('memory_fact_contribution_fact_mismatch');
    expect(factRows()[0]!.memory_owner_id).toBe(owner);

    expect(() =>
      persistFactContributionInTransaction({
        fact,
        payload: normalizeRecordFactMutation(globalFact(subject, 'green'), grounded),
        context: context('event-content'),
        supersession: {
          superseded: [],
          pinnedInputExplicit: false,
          reviewStateInputExplicit: false,
        },
      }),
    ).toThrow('memory_fact_contribution_fact_mismatch');
    expect(contributionCount()).toBe(0);
  });
});
