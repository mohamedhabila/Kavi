import type { getMemoryDb } from './database';
import {
  MEMORY_FACT_CONTRIBUTION_LIMITS,
  normalizeMemoryFactContributionSourceAliases,
  type MemoryFactContributionSourceAlias,
  type MemoryFactContributionSourceScope,
} from './factContributionCodec';
import type { FactRow } from './facts/types';
import { isExactMemoryProvenanceId } from './memoryProvenanceIdentity';
import { isExactMemoryScopeId } from './memoryScopeIdentity';

type MemoryDb = ReturnType<typeof getMemoryDb>;

interface EvidenceScopeRow {
  fact_id: string;
  message_id: string | null;
  source_end_message_id: string | null;
  conversation_id: string | null;
  thread_id: string | null;
  task_id: string | null;
}

interface JobSourceRow {
  job_id: string;
  memory_owner_id: string;
  memory_conversation_id: string;
  source_thread_id: string;
  task_id: string;
  source_kind: string;
  source_id: string;
}

interface ReceiptRow {
  job_id: string;
  deterministic_fact_ids_json: string;
  provider_fact_ids_json: string;
  invalidated_fact_ids_json: string;
  bridged_evidence_fact_ids_json: string;
  agent_run_memory_fact_ids_json: string;
}

export type LegacyFactAdmissionProofFailure =
  | 'identity_invalid'
  | 'source_missing'
  | 'source_scope_unproven'
  | 'source_scope_ambiguous'
  | 'limits_exceeded';

export type LegacyFactAdmissionProof =
  | {
      status: 'proven';
      scope: MemoryFactContributionSourceScope;
      aliases: MemoryFactContributionSourceAlias[];
    }
  | { status: 'rejected'; reason: LegacyFactAdmissionProofFailure };

export interface LegacyFactAdmissionProofIndex {
  evidenceByFactId: ReadonlyMap<string, ReadonlyArray<EvidenceScopeRow>>;
  receiptJobIdsByFactId: ReadonlyMap<string, ReadonlySet<string>>;
  jobSourcesByJobId: ReadonlyMap<string, ReadonlyArray<JobSourceRow>>;
  jobSourcesByAlias: ReadonlyMap<string, ReadonlyArray<JobSourceRow>>;
}

const RECEIPT_FACT_ID_COLUMNS = [
  'deterministic_fact_ids_json',
  'provider_fact_ids_json',
  'bridged_evidence_fact_ids_json',
  'agent_run_memory_fact_ids_json',
] as const satisfies readonly (keyof ReceiptRow)[];
const RECEIPT_VALIDATION_COLUMNS = [
  ...RECEIPT_FACT_ID_COLUMNS,
  'invalidated_fact_ids_json',
] as const satisfies readonly (keyof ReceiptRow)[];

function sourceKey(alias: MemoryFactContributionSourceAlias): string {
  return `${alias.sourceKind}\u0000${alias.sourceId}`;
}

function scopeKey(scope: MemoryFactContributionSourceScope): string {
  return JSON.stringify([
    scope.memoryOwnerId,
    scope.memoryConversationId,
    scope.sourceThreadId,
    scope.taskId,
  ]);
}

function exactScope(input: {
  memoryOwnerId: string;
  memoryConversationId: unknown;
  sourceThreadId: unknown;
  taskId: unknown;
}): MemoryFactContributionSourceScope | null {
  if (
    !isExactMemoryScopeId(input.memoryOwnerId) ||
    !isExactMemoryScopeId(input.memoryConversationId) ||
    !isExactMemoryScopeId(input.sourceThreadId) ||
    (input.taskId !== null && input.taskId !== '' && !isExactMemoryScopeId(input.taskId))
  ) {
    return null;
  }
  return {
    memoryOwnerId: input.memoryOwnerId,
    memoryConversationId: input.memoryConversationId,
    sourceThreadId: input.sourceThreadId,
    taskId: input.taskId === null ? '' : input.taskId,
  };
}

function exactFactOriginScope(
  row: FactRow,
  memoryOwnerId: string,
): MemoryFactContributionSourceScope | null {
  if (row.scope !== 'session') return null;
  return exactScope({
    memoryOwnerId,
    memoryConversationId: row.origin_conversation_id,
    sourceThreadId: row.origin_thread_id,
    taskId: row.origin_task_id,
  });
}

interface PartialFactOriginScope {
  memoryOwnerId: string;
  memoryConversationId: string;
  sourceThreadId: string | null;
}

function partialFactOriginScope(
  row: FactRow,
  memoryOwnerId: string,
): PartialFactOriginScope | null {
  if (row.scope !== 'conversation' && row.scope !== 'project') return null;
  if (
    !isExactMemoryScopeId(memoryOwnerId) ||
    !isExactMemoryScopeId(row.origin_conversation_id) ||
    (row.origin_thread_id !== null && !isExactMemoryScopeId(row.origin_thread_id)) ||
    row.origin_task_id !== null
  ) {
    return null;
  }
  return {
    memoryOwnerId,
    memoryConversationId: row.origin_conversation_id,
    sourceThreadId: row.origin_thread_id,
  };
}

function matchesPartialFactOrigin(
  scope: MemoryFactContributionSourceScope,
  partial: PartialFactOriginScope,
): boolean {
  return (
    scope.memoryOwnerId === partial.memoryOwnerId &&
    scope.memoryConversationId === partial.memoryConversationId &&
    (partial.sourceThreadId === null || scope.sourceThreadId === partial.sourceThreadId)
  );
}

function parseReceiptFactIds(raw: string): string[] | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length > 512 || !parsed.every(isExactMemoryProvenanceId)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function groupedPush<T>(map: Map<string, T[]>, key: string, value: T): void {
  const values = map.get(key) ?? [];
  values.push(value);
  map.set(key, values);
}

function groupedSetAdd(map: Map<string, Set<string>>, key: string, value: string): void {
  const values = map.get(key) ?? new Set<string>();
  values.add(value);
  map.set(key, values);
}

function jobAliasKey(memoryOwnerId: string, sourceKind: string, sourceId: string): string {
  return JSON.stringify([memoryOwnerId, sourceKind, sourceId]);
}

/** Build the complete legacy proof graph once so schema admission stays linear. */
export function buildLegacyFactAdmissionProofIndex(db: MemoryDb): LegacyFactAdmissionProofIndex {
  const evidenceByFactId = new Map<string, EvidenceScopeRow[]>();
  for (const evidence of db.getAllSync<EvidenceScopeRow>(
    `SELECT evidence.fact_id, evidence.message_id, episode.conversation_id,
            episode.thread_id, episode.task_id, episode.source_end_message_id
       FROM memory_fact_evidence AS evidence
       LEFT JOIN memory_episodes AS episode
         ON episode.id = evidence.episode_id AND episode.deleted_at IS NULL`,
  )) {
    groupedPush(evidenceByFactId, evidence.fact_id, evidence);
  }

  const receiptJobIdsByFactId = new Map<string, Set<string>>();
  for (const receipt of db.getAllSync<ReceiptRow>(
    `SELECT job_id, deterministic_fact_ids_json, provider_fact_ids_json,
            invalidated_fact_ids_json, bridged_evidence_fact_ids_json,
            agent_run_memory_fact_ids_json
       FROM (
         SELECT job_id, deterministic_fact_ids_json, provider_fact_ids_json,
                invalidated_fact_ids_json, bridged_evidence_fact_ids_json,
                agent_run_memory_fact_ids_json
           FROM memory_ingestion_receipts
         UNION ALL
         SELECT job_id, deterministic_fact_ids_json, provider_fact_ids_json,
                invalidated_fact_ids_json, bridged_evidence_fact_ids_json,
                agent_run_memory_fact_ids_json
           FROM memory_ingestion_structural_receipts
       )`,
  )) {
    const decodedColumns = new Map(
      RECEIPT_VALIDATION_COLUMNS.map((column) => [column, parseReceiptFactIds(receipt[column])]),
    );
    if (Array.from(decodedColumns.values()).some((factIds) => factIds === null)) continue;
    for (const column of RECEIPT_FACT_ID_COLUMNS) {
      const factIds = decodedColumns.get(column)!;
      for (const factId of factIds) {
        groupedSetAdd(receiptJobIdsByFactId, factId, receipt.job_id);
      }
    }
  }

  const jobSourcesByJobId = new Map<string, JobSourceRow[]>();
  const jobSourcesByAlias = new Map<string, JobSourceRow[]>();
  for (const source of db.getAllSync<JobSourceRow>(
    `SELECT job_id, memory_owner_id, memory_conversation_id, source_thread_id,
            task_id, source_kind, source_id
       FROM memory_ingestion_job_sources`,
  )) {
    groupedPush(jobSourcesByJobId, source.job_id, source);
    groupedPush(
      jobSourcesByAlias,
      jobAliasKey(source.memory_owner_id, source.source_kind, source.source_id),
      source,
    );
  }
  return { evidenceByFactId, receiptJobIdsByFactId, jobSourcesByJobId, jobSourcesByAlias };
}

function addAlias(
  aliases: Map<string, MemoryFactContributionSourceAlias>,
  sourceKind: MemoryFactContributionSourceAlias['sourceKind'],
  sourceId: string | null | undefined,
): boolean {
  if (sourceId === null || sourceId === undefined) return true;
  if (!isExactMemoryProvenanceId(sourceId)) return false;
  const alias = { sourceKind, sourceId };
  aliases.set(sourceKey(alias), alias);
  return true;
}

function jobSourceScope(row: JobSourceRow): MemoryFactContributionSourceScope | null {
  return exactScope({
    memoryOwnerId: row.memory_owner_id,
    memoryConversationId: row.memory_conversation_id,
    sourceThreadId: row.source_thread_id,
    taskId: row.task_id,
  });
}

function isSourceKind(value: string): value is MemoryFactContributionSourceAlias['sourceKind'] {
  return value === 'message' || value === 'turn' || value === 'run';
}

export function proveLegacyFactContributionSources(input: {
  row: FactRow;
  memoryOwnerId: string;
  index: LegacyFactAdmissionProofIndex;
}): LegacyFactAdmissionProof {
  const { row, memoryOwnerId, index } = input;
  const aliases = new Map<string, MemoryFactContributionSourceAlias>();
  const directAliases = [
    row.source_message_id === null
      ? null
      : { sourceKind: 'message' as const, sourceId: row.source_message_id },
    row.source_turn_id === null
      ? null
      : { sourceKind: 'turn' as const, sourceId: row.source_turn_id },
    row.source_run_id === null ? null : { sourceKind: 'run' as const, sourceId: row.source_run_id },
  ].filter((alias): alias is MemoryFactContributionSourceAlias => alias !== null);
  if (
    !addAlias(aliases, 'message', row.source_message_id) ||
    !addAlias(aliases, 'turn', row.source_turn_id) ||
    !addAlias(aliases, 'run', row.source_run_id)
  ) {
    return { status: 'rejected', reason: 'identity_invalid' };
  }

  const aliasScopes = new Map<string, Map<string, MemoryFactContributionSourceScope>>();
  const addAliasScope = (
    alias: MemoryFactContributionSourceAlias,
    scope: MemoryFactContributionSourceScope | null,
  ): void => {
    if (!scope) return;
    const key = sourceKey(alias);
    const scopes = aliasScopes.get(key) ?? new Map<string, MemoryFactContributionSourceScope>();
    scopes.set(scopeKey(scope), scope);
    aliasScopes.set(key, scopes);
  };

  const factOriginScope = exactFactOriginScope(row, memoryOwnerId);
  const partialOriginScope = partialFactOriginScope(row, memoryOwnerId);
  if (
    (row.scope === 'session' && factOriginScope === null) ||
    ((row.scope === 'conversation' || row.scope === 'project') && partialOriginScope === null)
  ) {
    return { status: 'rejected', reason: 'identity_invalid' };
  }
  for (const alias of directAliases) addAliasScope(alias, factOriginScope);
  for (const evidence of index.evidenceByFactId.get(row.id) ?? []) {
    if (!addAlias(aliases, 'message', evidence.message_id)) {
      return { status: 'rejected', reason: 'identity_invalid' };
    }
    const scope = exactScope({
      memoryOwnerId,
      memoryConversationId: evidence.conversation_id,
      sourceThreadId: evidence.thread_id,
      taskId: evidence.task_id,
    });
    if (evidence.message_id !== null) {
      addAliasScope({ sourceKind: 'message', sourceId: evidence.message_id }, scope);
    }
    if (row.source_turn_id !== null && evidence.source_end_message_id === row.source_turn_id) {
      addAliasScope({ sourceKind: 'turn', sourceId: row.source_turn_id }, scope);
    }
  }

  for (const jobId of input.index.receiptJobIdsByFactId.get(row.id) ?? []) {
    const jobSources = input.index.jobSourcesByJobId.get(jobId) ?? [];
    for (const source of jobSources) {
      if (!isSourceKind(source.source_kind) || !isExactMemoryProvenanceId(source.source_id)) {
        return { status: 'rejected', reason: 'identity_invalid' };
      }
      const alias = { sourceKind: source.source_kind, sourceId: source.source_id };
      aliases.set(sourceKey(alias), alias);
      const scope = jobSourceScope(source);
      addAliasScope(alias, scope);
    }
  }

  if (aliases.size === 0) return { status: 'rejected', reason: 'source_missing' };
  if (aliases.size > MEMORY_FACT_CONTRIBUTION_LIMITS.sourceAliases) {
    return { status: 'rejected', reason: 'limits_exceeded' };
  }

  for (const alias of aliases.values()) {
    for (const source of input.index.jobSourcesByAlias.get(
      jobAliasKey(memoryOwnerId, alias.sourceKind, alias.sourceId),
    ) ?? []) {
      addAliasScope(alias, jobSourceScope(source));
    }
  }

  const scopedAliases = Array.from(aliases.values()).map((alias) => ({
    alias,
    scopes: aliasScopes.get(sourceKey(alias)),
  }));
  if (scopedAliases.some(({ scopes }) => !scopes || scopes.size === 0)) {
    return { status: 'rejected', reason: 'source_scope_unproven' };
  }
  const commonScopes = new Map(scopedAliases[0]!.scopes!);
  for (const { scopes } of scopedAliases.slice(1)) {
    for (const key of commonScopes.keys()) {
      if (!scopes!.has(key)) commonScopes.delete(key);
    }
  }
  if (commonScopes.size === 0) {
    return { status: 'rejected', reason: 'source_scope_ambiguous' };
  }
  if (partialOriginScope) {
    for (const [key, scope] of commonScopes) {
      if (!matchesPartialFactOrigin(scope, partialOriginScope)) commonScopes.delete(key);
    }
    if (commonScopes.size === 0) {
      return { status: 'rejected', reason: 'source_scope_ambiguous' };
    }
  }
  let scope: MemoryFactContributionSourceScope;
  if (factOriginScope) {
    if (!commonScopes.has(scopeKey(factOriginScope))) {
      return { status: 'rejected', reason: 'source_scope_ambiguous' };
    }
    scope = factOriginScope;
  } else if (commonScopes.size === 1) {
    scope = Array.from(commonScopes.values())[0]!;
  } else {
    return { status: 'rejected', reason: 'source_scope_ambiguous' };
  }

  try {
    return {
      status: 'proven',
      scope,
      aliases: normalizeMemoryFactContributionSourceAliases(Array.from(aliases.values())),
    };
  } catch {
    return { status: 'rejected', reason: 'identity_invalid' };
  }
}
