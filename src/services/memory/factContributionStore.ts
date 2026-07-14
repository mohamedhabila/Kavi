import { getSchemaReadyMemoryDb } from './access/schemaGuard';
import {
  buildFactContributionSourceChildCommitment,
  type MemoryFactContributionChildCommitment,
} from './factContributionChildCommitments';
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
  type MemoryFactContributionSourceScope,
} from './factContributionCodec';
import {
  assertFactContributionSupersessionOperation,
  assertFactContributionSupersessionReplayInTransaction,
  loadVerifiedFactContributionSupersessionPlanInTransaction,
  persistFactContributionSupersessionPlanInTransaction,
  prepareFactContributionSupersessionPlanInTransaction,
  type FactContributionSupersessionParentMetadata,
  type FactContributionSupersessionPlan,
  type FactContributionSupersessionSemantics,
} from './factContributionSupersessionStore';
import { hasExactFactContentIdentity } from './facts/contentIdentity';
import type { FactRow, MemoryFact } from './facts/types';
import { getLocalMemoryVaultOwnerId } from './memoryVaultIdentity';
import { assertMemoryPersistenceSourcesAreWritable } from './withdrawalFence';

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
  id: string;
  factId: string;
  payload: MemoryFactContributionPayloadV1;
  sourceAliases: ReadonlyArray<MemoryFactContributionSourceAlias>;
  supersessionPlan: FactContributionSupersessionPlan;
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
  source_set_version: number;
  source_set_count: number;
  source_set_sha256: string;
  supersession_set_version: number;
  supersession_set_count: number;
  supersession_set_sha256: string;
  payload_version: number;
  payload_json: string;
  payload_sha256: string;
  payload_byte_length: number;
  contributed_at: number;
}

interface ContributionSourceRow {
  contribution_id: string;
  memory_owner_id: string;
  memory_conversation_id: string;
  source_thread_id: string;
  task_id: string;
  source_kind: string;
  source_id: string;
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

type ContributionReplayExpected = Omit<
  ContributionRow,
  'id' | 'supersession_set_version' | 'supersession_set_count' | 'supersession_set_sha256'
>;

function rowMatches(row: ContributionRow, expected: ContributionReplayExpected): boolean {
  return (
    row.fact_id === expected.fact_id &&
    row.memory_owner_id === expected.memory_owner_id &&
    row.memory_conversation_id === expected.memory_conversation_id &&
    row.source_thread_id === expected.source_thread_id &&
    row.task_id === expected.task_id &&
    row.producer_id === expected.producer_id &&
    row.producer_event_id === expected.producer_event_id &&
    row.source_set_version === expected.source_set_version &&
    row.source_set_count === expected.source_set_count &&
    row.source_set_sha256 === expected.source_set_sha256 &&
    row.payload_version === expected.payload_version &&
    row.payload_json === expected.payload_json &&
    row.payload_sha256 === expected.payload_sha256 &&
    row.payload_byte_length === expected.payload_byte_length &&
    row.contributed_at === expected.contributed_at
  );
}

function sourceAliasesMatch(
  actual: ReadonlyArray<MemoryFactContributionSourceAlias>,
  expected: ReadonlyArray<MemoryFactContributionSourceAlias>,
): boolean {
  if (actual.length !== expected.length) return false;
  const actualKeys = new Set(actual.map((alias) => `${alias.sourceKind}\u0000${alias.sourceId}`));
  return expected.every((alias) => actualKeys.has(`${alias.sourceKind}\u0000${alias.sourceId}`));
}

function exactSourceAliases(
  rows: ReadonlyArray<ContributionSourceRow>,
  contributionId: string,
  scope: MemoryFactContributionSourceScope,
): ReadonlyArray<MemoryFactContributionSourceAlias> {
  if (
    rows.some(
      (row) =>
        row.contribution_id !== contributionId ||
        row.memory_owner_id !== scope.memoryOwnerId ||
        row.memory_conversation_id !== scope.memoryConversationId ||
        row.source_thread_id !== scope.sourceThreadId ||
        row.task_id !== scope.taskId ||
        (row.source_kind !== 'message' && row.source_kind !== 'turn' && row.source_kind !== 'run'),
    )
  ) {
    fail('memory_fact_contribution_replay_mismatch');
  }
  try {
    return normalizeMemoryFactContributionSourceAliases(
      rows.map((row) => ({
        sourceKind: row.source_kind as MemoryFactContributionSourceAlias['sourceKind'],
        sourceId: row.source_id,
      })),
    );
  } catch {
    return fail('memory_fact_contribution_replay_mismatch');
  }
}

function commitmentMatches(
  commitment: MemoryFactContributionChildCommitment,
  version: number,
  count: number,
  sha256: string,
): boolean {
  return (
    commitment.version === version && commitment.count === count && commitment.sha256 === sha256
  );
}

function sourceCommitment(input: {
  contributionId: string;
  scope: MemoryFactContributionSourceScope;
  aliases: ReadonlyArray<MemoryFactContributionSourceAlias>;
}): MemoryFactContributionChildCommitment {
  try {
    return buildFactContributionSourceChildCommitment({
      contributionId: input.contributionId,
      scope: input.scope,
      sourceAliases: input.aliases,
    });
  } catch {
    return fail('memory_fact_contribution_replay_mismatch');
  }
}

function verifiedSupersessionPlan(
  contributionId: string,
  commitment: { version: number; count: number; sha256: string },
  parent: FactContributionSupersessionParentMetadata,
): FactContributionSupersessionPlan {
  if (commitment.version !== 1) {
    return fail('memory_fact_contribution_replay_mismatch');
  }
  const sealedCommitment: MemoryFactContributionChildCommitment = {
    version: 1,
    count: commitment.count,
    sha256: commitment.sha256,
  };
  try {
    const plan = loadVerifiedFactContributionSupersessionPlanInTransaction({
      contributionId,
      commitment: sealedCommitment,
    });
    assertFactContributionSupersessionOperation({ parent, plan });
    return plan;
  } catch {
    return fail('memory_fact_contribution_replay_mismatch');
  }
}

function normalizeWriteContext(context: MemoryFactContributionWriteContext): {
  id: string;
  scope: MemoryFactContributionSourceScope;
  producer: MemoryFactContributionProducerIdentity;
  aliases: ReadonlyArray<MemoryFactContributionSourceAlias>;
} {
  const db = getSchemaReadyMemoryDb();
  const scope = normalizeMemoryFactContributionSourceScope({
    memoryOwnerId: getLocalMemoryVaultOwnerId(db),
    memoryConversationId: context.memoryConversationId,
    sourceThreadId: context.sourceThreadId,
    taskId: context.taskId,
  });
  const producer = requireMemoryFactContributionProducerIdentity(context.producer);
  const aliases = normalizeMemoryFactContributionSourceAliases(context.sourceAliases);
  return { id: buildMemoryFactContributionId({ scope, producer }), scope, producer, aliases };
}

function assertNormalizedSourceAliasesAreWritable(
  scope: ReturnType<typeof normalizeMemoryFactContributionSourceScope>,
  aliases: ReadonlyArray<MemoryFactContributionSourceAlias>,
): void {
  assertMemoryPersistenceSourcesAreWritable(
    {
      memoryConversationId: scope.memoryConversationId,
      sourceThreadId: scope.sourceThreadId,
      taskId: scope.taskId === '' ? null : scope.taskId,
    },
    aliases,
  );
}

interface MemoryFactContributionReplayContext {
  memoryConversationId: string;
  sourceThreadId: string;
  taskId?: string | null;
  producer: MemoryFactContributionProducerIdentity;
}

/** Read a prior producer event only when one complete caller-authorized alias set matches. */
export function loadFactContributionReplayFromAliasCandidates(input: {
  context: MemoryFactContributionReplayContext;
  sourceAliasCandidates: ReadonlyArray<ReadonlyArray<MemoryFactContributionSourceAlias>>;
}): MemoryFactContributionReplay | null {
  const db = getSchemaReadyMemoryDb();
  const scope = normalizeMemoryFactContributionSourceScope({
    memoryOwnerId: getLocalMemoryVaultOwnerId(db),
    memoryConversationId: input.context.memoryConversationId,
    sourceThreadId: input.context.sourceThreadId,
    taskId: input.context.taskId,
  });
  const producer = requireMemoryFactContributionProducerIdentity(input.context.producer);
  if (input.sourceAliasCandidates.length < 1 || input.sourceAliasCandidates.length > 4) {
    fail('memory_fact_contribution_source_alias_invalid');
  }
  const expectedAliasSets = input.sourceAliasCandidates.map((aliases) =>
    normalizeMemoryFactContributionSourceAliases(aliases),
  );
  const id = buildMemoryFactContributionId({ scope, producer });
  const row = db.getFirstSync<ContributionRow>(
    'SELECT * FROM memory_fact_contributions WHERE id = ? LIMIT 1',
    id,
  );
  if (!row) {
    if (expectedAliasSets.length === 1) {
      assertNormalizedSourceAliasesAreWritable(scope, expectedAliasSets[0]!);
    }
    return null;
  }
  if (
    row.memory_owner_id !== scope.memoryOwnerId ||
    row.memory_conversation_id !== scope.memoryConversationId ||
    row.source_thread_id !== scope.sourceThreadId ||
    row.task_id !== scope.taskId ||
    row.producer_id !== producer.producerId ||
    row.producer_event_id !== producer.producerEventId
  ) {
    fail('memory_fact_contribution_replay_mismatch');
  }
  const sourceRows = db.getAllSync<ContributionSourceRow>(
    `SELECT contribution_id, memory_owner_id, memory_conversation_id, source_thread_id,
            task_id, source_kind, source_id
       FROM memory_fact_contribution_sources
      WHERE contribution_id = ?
      ORDER BY source_kind ASC, source_id ASC`,
    id,
  );
  const durableAliases = exactSourceAliases(sourceRows, id, scope);
  const durableSourceCommitment = sourceCommitment({
    contributionId: id,
    scope,
    aliases: durableAliases,
  });
  if (
    !commitmentMatches(
      durableSourceCommitment,
      row.source_set_version,
      row.source_set_count,
      row.source_set_sha256,
    )
  ) {
    fail('memory_fact_contribution_replay_mismatch');
  }
  const matchedAliases = expectedAliasSets.find((aliases) =>
    sourceAliasesMatch(durableAliases, aliases),
  );
  if (!matchedAliases) fail('memory_fact_contribution_replay_mismatch');
  const payload = decodeMemoryFactContributionPayload({
    payloadVersion: row.payload_version,
    payloadJson: row.payload_json,
    payloadSha256: row.payload_sha256,
    payloadByteLength: row.payload_byte_length,
  });
  const supersessionPlan = verifiedSupersessionPlan(
    id,
    {
      version: row.supersession_set_version,
      count: row.supersession_set_count,
      sha256: row.supersession_set_sha256,
    },
    {
      contributionId: id,
      factId: row.fact_id,
      memoryOwnerId: row.memory_owner_id,
      contributedAt: row.contributed_at,
      payload,
    },
  );
  assertNormalizedSourceAliasesAreWritable(scope, matchedAliases);
  return {
    id,
    factId: row.fact_id,
    payload,
    sourceAliases: matchedAliases,
    supersessionPlan,
  };
}

/** Read an exact prior producer event without weakening its alias identity. */
export function loadFactContributionReplay(
  context: MemoryFactContributionWriteContext,
): MemoryFactContributionReplay | null {
  return loadFactContributionReplayFromAliasCandidates({
    context,
    sourceAliasCandidates: [context.sourceAliases],
  });
}

/** Persist one complete immutable contribution aggregate while its fact transaction is active. */
export function persistFactContributionInTransaction(input: {
  fact: MemoryFact;
  payload: MemoryFactContributionPayloadV1;
  context: MemoryFactContributionWriteContext;
  supersession: FactContributionSupersessionSemantics;
}): MemoryFactContributionWriteReceipt {
  const db = getSchemaReadyMemoryDb();
  const memoryOwnerId = getLocalMemoryVaultOwnerId(db);
  const { aliases, id, producer, scope } = normalizeWriteContext(input.context);
  assertNormalizedSourceAliasesAreWritable(scope, aliases);
  const encoded = encodeMemoryFactContributionPayload(input.payload);
  const factRow = db.getFirstSync<FactRow>(
    'SELECT * FROM memory_facts WHERE id = ? LIMIT 1',
    input.fact.id,
  );
  assertFactMatchesPayload(factRow, input.fact, input.payload, memoryOwnerId);
  assertSourceScopeMatchesPayload(input.payload, scope);
  assertPayloadSourcesHaveAliases(input.payload, aliases);

  const sourceSet = sourceCommitment({ contributionId: id, scope, aliases });
  const expected = {
    fact_id: input.fact.id,
    memory_owner_id: scope.memoryOwnerId,
    memory_conversation_id: scope.memoryConversationId,
    source_thread_id: scope.sourceThreadId,
    task_id: scope.taskId,
    producer_id: producer.producerId,
    producer_event_id: producer.producerEventId,
    source_set_version: sourceSet.version,
    source_set_count: sourceSet.count,
    source_set_sha256: sourceSet.sha256,
    payload_version: encoded.payloadVersion,
    payload_json: encoded.payloadJson,
    payload_sha256: encoded.payloadSha256,
    payload_byte_length: encoded.payloadByteLength,
    contributed_at: input.payload.input.now,
  };
  const parent = {
    contributionId: id,
    factId: input.fact.id,
    memoryOwnerId: scope.memoryOwnerId,
    contributedAt: input.payload.input.now,
    payload: input.payload,
  };
  const existing = db.getFirstSync<ContributionRow>(
    'SELECT * FROM memory_fact_contributions WHERE id = ? LIMIT 1',
    id,
  );
  if (existing) {
    const sources = db.getAllSync<ContributionSourceRow>(
      `SELECT contribution_id, memory_owner_id, memory_conversation_id, source_thread_id,
              task_id, source_kind, source_id
         FROM memory_fact_contribution_sources
        WHERE contribution_id = ?
        ORDER BY source_kind ASC, source_id ASC`,
      id,
    );
    const durableAliases = exactSourceAliases(sources, id, scope);
    if (!rowMatches(existing, expected) || !sourceAliasesMatch(durableAliases, aliases)) {
      fail('memory_fact_contribution_replay_mismatch');
    }
    const supersessionPlan = verifiedSupersessionPlan(
      id,
      {
        version: existing.supersession_set_version,
        count: existing.supersession_set_count,
        sha256: existing.supersession_set_sha256,
      },
      parent,
    );
    assertFactContributionSupersessionReplayInTransaction({
      parent,
      plan: supersessionPlan,
      semantics: input.supersession,
    });
    return { id, status: 'replayed' };
  }

  const supersessionPlan = prepareFactContributionSupersessionPlanInTransaction({
    parent,
    semantics: input.supersession,
  });
  db.runSync(
    `INSERT INTO memory_fact_contributions(
       id, fact_id, memory_owner_id, memory_conversation_id, source_thread_id, task_id,
       producer_id, producer_event_id, source_set_version, source_set_count, source_set_sha256,
       supersession_set_version, supersession_set_count, supersession_set_sha256,
       payload_version, payload_json, payload_sha256, payload_byte_length, contributed_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    expected.fact_id,
    expected.memory_owner_id,
    expected.memory_conversation_id,
    expected.source_thread_id,
    expected.task_id,
    expected.producer_id,
    expected.producer_event_id,
    expected.source_set_version,
    expected.source_set_count,
    expected.source_set_sha256,
    supersessionPlan.commitment.version,
    supersessionPlan.commitment.count,
    supersessionPlan.commitment.sha256,
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
  persistFactContributionSupersessionPlanInTransaction(supersessionPlan);
  return { id, status: 'created' };
}
