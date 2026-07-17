import { getMemoryDb } from '../../src/services/memory/database';
import { upsertEntity } from '../../src/services/memory/entities';
import {
  buildMemoryFactContributionId,
  encodeMemoryFactContributionPayload,
  normalizeMemoryFactContributionSourceScope,
  type MemoryFactContributionPayloadV2,
  type MemoryFactContributionProducerIdentity,
} from '../../src/services/memory/factContributionCodec';
import { recordFactWithApplicability } from '../../src/services/memory/facts/mutations';
import type { FactRow, MemoryFact } from '../../src/services/memory/facts/types';
import { getLocalMemoryVaultOwnerId } from '../../src/services/memory/memoryVaultIdentity';

export function createSchemaFact(objectText: string) {
  const subject = upsertEntity({ type: 'self', name: 'user', now: 100 });
  return recordFactWithApplicability(
    {
      subjectId: subject.id,
      predicate: 'favorite_color',
      objectText,
      scope: 'global',
      sourceMessageId: 'user-message',
      sourceTurnId: 'assistant-message',
      now: 100,
    },
    { factClass: 'subjective_user', sourceAuthority: 'grounded_user' },
  ).fact;
}

function contributionPayload(
  subjectId: string,
  objectText: string,
): MemoryFactContributionPayloadV2 {
  return {
    version: 2,
    operation: { kind: 'record' },
    applicability: {
      factClass: 'subjective_user',
      sourceAuthority: 'grounded_user',
      personaId: null,
    },
    input: {
      subjectId,
      predicate: 'favorite_color',
      objectText,
      objectEntityId: null,
      attributes: {},
      confidence: 1,
      sourceMessageId: 'user-message',
      sourceRunId: 'run-1',
      scope: 'global',
      originConversationId: null,
      originThreadId: null,
      originTaskId: null,
      sourceTurnId: 'assistant-message',
      sourceSummary: null,
      importance: 0.5,
      decayPolicy: 'normal',
      expiresAt: null,
      validAt: 100,
      pinned: false,
      sourceActorId: null,
      retrievability: 1,
      stability: 0.5,
      decayRate: 0.03,
      reviewState: 'auto',
      sensitivityFloor: 'normal',
      memoryKind: 'semantic_fact',
      supersedePrior: false,
      now: 100,
    },
  };
}

export function insertSchemaContribution(input: {
  factId: string;
  subjectId: string;
  objectText: string;
  producer: MemoryFactContributionProducerIdentity;
  sourceSetVersion?: number;
  sourceSetCount?: number;
  sourceSetSha256?: string;
  supersessionSetVersion?: number;
  supersessionSetCount?: number;
  supersessionSetSha256?: string;
}) {
  const db = getMemoryDb();
  const scope = normalizeMemoryFactContributionSourceScope({
    memoryOwnerId: getLocalMemoryVaultOwnerId(db),
    memoryConversationId: 'conversation-1',
    sourceThreadId: 'thread-1',
    taskId: null,
  });
  const id = buildMemoryFactContributionId({
    scope,
    producer: input.producer,
  });
  const encoded = encodeMemoryFactContributionPayload(
    contributionPayload(input.subjectId, input.objectText),
  );
  const inserted = db.runSync(
    `INSERT INTO memory_fact_contributions(
       id, fact_id, memory_owner_id, memory_conversation_id, source_thread_id, task_id,
       producer_id, producer_event_id, source_set_version, source_set_count, source_set_sha256,
       supersession_set_version, supersession_set_count, supersession_set_sha256,
       payload_version, payload_json, payload_sha256, payload_byte_length, contributed_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    input.factId,
    scope.memoryOwnerId,
    scope.memoryConversationId,
    scope.sourceThreadId,
    scope.taskId,
    input.producer.producerId,
    input.producer.producerEventId,
    input.sourceSetVersion ?? 1,
    input.sourceSetCount ?? 1,
    input.sourceSetSha256 ?? '1'.repeat(64),
    input.supersessionSetVersion ?? 1,
    input.supersessionSetCount ?? 0,
    input.supersessionSetSha256 ?? '2'.repeat(64),
    encoded.payloadVersion,
    encoded.payloadJson,
    encoded.payloadSha256,
    encoded.payloadByteLength,
    100,
  );
  return { db, encoded, id, inserted, scope };
}

export function insertSchemaSupersessionSnapshot(
  contributionId: string,
  successor: MemoryFact,
): void {
  const db = getMemoryDb();
  const row = db.getFirstSync<FactRow>(
    'SELECT * FROM memory_facts WHERE id = ? LIMIT 1',
    successor.id,
  );
  if (!row) throw new Error('test_successor_missing');
  db.runSync(
    `INSERT INTO memory_fact_contribution_supersession_snapshots(
       contribution_id, successor_fact_id, superseded_at, snapshot_version,
       pinned_input_explicit, review_state_input_explicit, successor_pinned_baseline,
       successor_review_state_baseline, successor_sensitivity_floor,
       successor_sensitivity_policy_version
     ) VALUES (?, ?, ?, 1, 0, 0, ?, ?, ?, ?)`,
    contributionId,
    successor.id,
    successor.createdAt,
    row.pinned,
    row.review_state,
    row.sensitivity,
    row.sensitivity_policy_version,
  );
}
