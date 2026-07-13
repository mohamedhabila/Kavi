import { getSchemaReadyMemoryDb } from './access/schemaGuard';
import {
  buildMemoryFactContributionId,
  decodeMemoryFactContributionPayload,
  encodeMemoryFactContributionPayload,
  normalizeMemoryFactContributionSourceAliases,
  normalizeMemoryFactContributionSourceScope,
  requireMemoryFactContributionProducerIdentity,
  type MemoryFactContributionPayloadV1,
  type MemoryFactContributionProducerIdentity,
  type MemoryFactContributionSourceAlias,
} from './factContributionCodec';
import { hasExactFactContentIdentity } from './facts/contentIdentity';
import type { FactRow, MemoryFact } from './facts/types';
import { getLocalMemoryVaultOwnerId } from './memoryVaultIdentity';

export interface MemoryFactContributionWriteContext {
  memoryConversationId: string;
  sourceThreadId: string;
  taskId?: string | null;
  producer: MemoryFactContributionProducerIdentity;
  sourceAliases: ReadonlyArray<MemoryFactContributionSourceAlias>;
}

export interface MemoryFactContributionWriteReceipt {
  id: string;
  status: 'created' | 'replayed';
}

export interface MemoryFactContributionReplay {
  factId: string;
  payload: MemoryFactContributionPayloadV1;
}

interface ContributionRow {
  id: string;
  fact_id: string;
  memory_owner_id: string;
  memory_conversation_id: string;
  source_thread_id: string;
  task_id: string;
  producer_id: string;
  producer_event_id: string;
  payload_version: number;
  payload_json: string;
  payload_sha256: string;
  payload_byte_length: number;
  contributed_at: number;
}

interface ContributionSourceRow {
  source_kind: string;
  source_id: string;
}

interface SupersessionRow {
  superseded_at: number;
}

function fail(code: string): never {
  throw new Error(code);
}

function assertFactMatchesPayload(
  row: FactRow | null | undefined,
  fact: MemoryFact,
  payload: MemoryFactContributionPayloadV1,
  memoryOwnerId: string,
): void {
  if (
    !row ||
    row.memory_owner_id !== memoryOwnerId ||
    fact.id !== row.id ||
    fact.memoryOwnerId !== memoryOwnerId ||
    !hasExactFactContentIdentity(
      {
        memoryOwnerId: row.memory_owner_id,
        memoryKind: row.memory_kind,
        scope: row.scope,
        originConversationId: row.origin_conversation_id,
        originThreadId: row.origin_thread_id,
        originTaskId: row.origin_task_id,
        personaId: row.persona_id,
        subjectId: row.subject_id,
        predicate: row.predicate,
        objectText: row.object_text,
        objectEntityId: row.object_entity_id,
      },
      {
        ...payload.input,
        memoryOwnerId,
        personaId: payload.applicability.personaId,
      },
    )
  ) {
    fail('memory_fact_contribution_fact_mismatch');
  }
}

function assertSourceScopeMatchesPayload(
  payload: MemoryFactContributionPayloadV1,
  scope: ReturnType<typeof normalizeMemoryFactContributionSourceScope>,
): void {
  const input = payload.input;
  if (input.scope === 'global' || input.scope === 'persona') return;
  if (input.originConversationId !== scope.memoryConversationId) {
    fail('memory_fact_contribution_scope_mismatch');
  }
  if (input.originThreadId !== null && input.originThreadId !== scope.sourceThreadId) {
    fail('memory_fact_contribution_scope_mismatch');
  }
  if (input.scope === 'session' && input.originTaskId !== scope.taskId) {
    fail('memory_fact_contribution_scope_mismatch');
  }
}

function assertPayloadSourcesHaveAliases(
  payload: MemoryFactContributionPayloadV1,
  aliases: ReadonlyArray<MemoryFactContributionSourceAlias>,
): void {
  const aliasKeys = new Set(aliases.map((alias) => `${alias.sourceKind}\u0000${alias.sourceId}`));
  const required = [
    { sourceKind: 'message', sourceId: payload.input.sourceMessageId },
    { sourceKind: 'turn', sourceId: payload.input.sourceTurnId },
    { sourceKind: 'run', sourceId: payload.input.sourceRunId },
  ] as const;
  if (
    required.some(
      (source) =>
        source.sourceId !== null && !aliasKeys.has(`${source.sourceKind}\u0000${source.sourceId}`),
    )
  ) {
    fail('memory_fact_contribution_source_alias_missing');
  }
}

function rowMatches(row: ContributionRow, expected: Omit<ContributionRow, 'id'>): boolean {
  return (
    row.fact_id === expected.fact_id &&
    row.memory_owner_id === expected.memory_owner_id &&
    row.memory_conversation_id === expected.memory_conversation_id &&
    row.source_thread_id === expected.source_thread_id &&
    row.task_id === expected.task_id &&
    row.producer_id === expected.producer_id &&
    row.producer_event_id === expected.producer_event_id &&
    row.payload_version === expected.payload_version &&
    row.payload_json === expected.payload_json &&
    row.payload_sha256 === expected.payload_sha256 &&
    row.payload_byte_length === expected.payload_byte_length &&
    row.contributed_at === expected.contributed_at
  );
}

function sourceRowsMatch(
  actual: ReadonlyArray<ContributionSourceRow>,
  expected: ReadonlyArray<MemoryFactContributionSourceAlias>,
): boolean {
  if (actual.length !== expected.length) return false;
  const actualKeys = new Set(actual.map((row) => `${row.source_kind}\u0000${row.source_id}`));
  return expected.every((alias) => actualKeys.has(`${alias.sourceKind}\u0000${alias.sourceId}`));
}

/** Read an exact prior producer event without weakening its alias identity. */
export function loadFactContributionReplay(
  context: MemoryFactContributionWriteContext,
): MemoryFactContributionReplay | null {
  const db = getSchemaReadyMemoryDb();
  const scope = normalizeMemoryFactContributionSourceScope({
    memoryOwnerId: getLocalMemoryVaultOwnerId(db),
    memoryConversationId: context.memoryConversationId,
    sourceThreadId: context.sourceThreadId,
    taskId: context.taskId,
  });
  const producer = requireMemoryFactContributionProducerIdentity(context.producer);
  const expectedAliases = normalizeMemoryFactContributionSourceAliases(context.sourceAliases);
  const id = buildMemoryFactContributionId({ scope, producer });
  const row = db.getFirstSync<ContributionRow>(
    'SELECT * FROM memory_fact_contributions WHERE id = ? LIMIT 1',
    id,
  );
  if (!row) return null;
  const sourceRows = db.getAllSync<ContributionSourceRow>(
    `SELECT source_kind, source_id
       FROM memory_fact_contribution_sources
      WHERE contribution_id = ?
      ORDER BY source_kind ASC, source_id ASC`,
    id,
  );
  if (!sourceRowsMatch(sourceRows, expectedAliases)) {
    fail('memory_fact_contribution_replay_mismatch');
  }
  return {
    factId: row.fact_id,
    payload: decodeMemoryFactContributionPayload({
      payloadVersion: row.payload_version,
      payloadJson: row.payload_json,
      payloadSha256: row.payload_sha256,
      payloadByteLength: row.payload_byte_length,
    }),
  };
}

/** Persist one immutable contribution while the owning fact transaction is active. */
export function persistFactContributionInTransaction(input: {
  fact: MemoryFact;
  payload: MemoryFactContributionPayloadV1;
  context: MemoryFactContributionWriteContext;
}): MemoryFactContributionWriteReceipt {
  const db = getSchemaReadyMemoryDb();
  const memoryOwnerId = getLocalMemoryVaultOwnerId(db);
  const scope = normalizeMemoryFactContributionSourceScope({
    memoryOwnerId,
    memoryConversationId: input.context.memoryConversationId,
    sourceThreadId: input.context.sourceThreadId,
    taskId: input.context.taskId,
  });
  const producer = requireMemoryFactContributionProducerIdentity(input.context.producer);
  const aliases = normalizeMemoryFactContributionSourceAliases(input.context.sourceAliases);
  const encoded = encodeMemoryFactContributionPayload(input.payload);
  const factRow = db.getFirstSync<FactRow>(
    'SELECT * FROM memory_facts WHERE id = ? LIMIT 1',
    input.fact.id,
  );
  assertFactMatchesPayload(factRow, input.fact, input.payload, memoryOwnerId);
  assertSourceScopeMatchesPayload(input.payload, scope);
  assertPayloadSourcesHaveAliases(input.payload, aliases);

  const id = buildMemoryFactContributionId({ scope, producer });
  const expected = {
    fact_id: input.fact.id,
    memory_owner_id: scope.memoryOwnerId,
    memory_conversation_id: scope.memoryConversationId,
    source_thread_id: scope.sourceThreadId,
    task_id: scope.taskId,
    producer_id: producer.producerId,
    producer_event_id: producer.producerEventId,
    payload_version: encoded.payloadVersion,
    payload_json: encoded.payloadJson,
    payload_sha256: encoded.payloadSha256,
    payload_byte_length: encoded.payloadByteLength,
    contributed_at: input.payload.input.now,
  };
  const existing = db.getFirstSync<ContributionRow>(
    'SELECT * FROM memory_fact_contributions WHERE id = ? LIMIT 1',
    id,
  );
  if (existing) {
    const sources = db.getAllSync<ContributionSourceRow>(
      `SELECT source_kind, source_id
         FROM memory_fact_contribution_sources
        WHERE contribution_id = ?
        ORDER BY source_kind ASC, source_id ASC`,
      id,
    );
    if (!rowMatches(existing, expected) || !sourceRowsMatch(sources, aliases)) {
      fail('memory_fact_contribution_replay_mismatch');
    }
    return { id, status: 'replayed' };
  }

  db.runSync(
    `INSERT INTO memory_fact_contributions(
       id, fact_id, memory_owner_id, memory_conversation_id, source_thread_id, task_id,
       producer_id, producer_event_id, payload_version, payload_json, payload_sha256,
       payload_byte_length, contributed_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    expected.fact_id,
    expected.memory_owner_id,
    expected.memory_conversation_id,
    expected.source_thread_id,
    expected.task_id,
    expected.producer_id,
    expected.producer_event_id,
    expected.payload_version,
    expected.payload_json,
    expected.payload_sha256,
    expected.payload_byte_length,
    expected.contributed_at,
  );
  for (const alias of aliases) {
    db.runSync(
      `INSERT INTO memory_fact_contribution_sources(
         contribution_id, memory_owner_id, memory_conversation_id, source_thread_id,
         task_id, source_kind, source_id
       ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      id,
      scope.memoryOwnerId,
      scope.memoryConversationId,
      scope.sourceThreadId,
      scope.taskId,
      alias.sourceKind,
      alias.sourceId,
    );
  }
  return { id, status: 'created' };
}

/** Attach exact replacement edges to their already-persisted successor contribution. */
export function persistFactContributionSupersessionsInTransaction(input: {
  contributionId: string;
  successorFactId: string;
  superseded: ReadonlyArray<Pick<MemoryFact, 'id' | 'invalidAt'>>;
}): void {
  if (input.superseded.length === 0) return;
  const db = getSchemaReadyMemoryDb();
  const contribution = db.getFirstSync<{ fact_id: string }>(
    'SELECT fact_id FROM memory_fact_contributions WHERE id = ? LIMIT 1',
    input.contributionId,
  );
  if (!contribution || contribution.fact_id !== input.successorFactId) {
    fail('memory_fact_contribution_supersession_successor_mismatch');
  }
  const predecessors = new Map<string, number>();
  for (const predecessor of input.superseded) {
    if (!Number.isSafeInteger(predecessor.invalidAt) || predecessor.invalidAt! < 0) {
      fail('memory_fact_contribution_supersession_invalid');
    }
    const prior = predecessors.get(predecessor.id);
    if (prior !== undefined && prior !== predecessor.invalidAt) {
      fail('memory_fact_contribution_supersession_invalid');
    }
    predecessors.set(predecessor.id, predecessor.invalidAt!);
  }
  for (const [predecessorFactId, supersededAt] of Array.from(predecessors).sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    const existing = db.getFirstSync<SupersessionRow>(
      `SELECT superseded_at
         FROM memory_fact_contribution_supersessions
        WHERE contribution_id = ? AND predecessor_fact_id = ? AND successor_fact_id = ?
        LIMIT 1`,
      input.contributionId,
      predecessorFactId,
      input.successorFactId,
    );
    if (existing) {
      if (existing.superseded_at !== supersededAt) {
        fail('memory_fact_contribution_supersession_replay_mismatch');
      }
      continue;
    }
    db.runSync(
      `INSERT INTO memory_fact_contribution_supersessions(
         contribution_id, predecessor_fact_id, successor_fact_id, superseded_at
       ) VALUES (?, ?, ?, ?)`,
      input.contributionId,
      predecessorFactId,
      input.successorFactId,
      supersededAt,
    );
  }
}
