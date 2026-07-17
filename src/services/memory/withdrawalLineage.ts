import type { MemoryDatabase } from './access/schemaGuard';
import type { EpisodeRow, EvidenceRow } from './episodes/types';
import {
  decodeEpisodeSourceIdentityManifest,
  type EpisodeSourceIdentityManifest,
} from './episodes/sourceIdentity';
import { hasExactFactContentIdentity } from './facts/contentIdentity';
import type { FactRow } from './facts/types';
import { isExactMemoryProvenanceId } from './memoryProvenanceIdentity';
import { isExactMemoryScopeId } from './memoryScopeIdentity';

const SELECT_BATCH_SIZE = 200;
const MAX_LINEAGE_IDS = 512;
const REBUILDABLE_SUMMARY_LABELS = ['active_focus', 'open_threads', 'compaction_summary'] as const;

export type MemoryWithdrawalSourceKind = 'message' | 'turn' | 'run';
type SourceSets = Map<MemoryWithdrawalSourceKind, Set<string>>;

export interface MemoryWithdrawalScope {
  memoryConversationId: string;
  sourceThreadId: string;
  taskId: string;
}

export interface ScopedMemoryWithdrawalSource extends MemoryWithdrawalScope {
  sourceKind: MemoryWithdrawalSourceKind;
  sourceId: string;
}

interface ScopedSourceIndex {
  scope: MemoryWithdrawalScope;
  sources: SourceSets;
}

export interface WithdrawalReflectionRow {
  id: string;
  source_episode_ids_json: string;
  source_fact_ids_json: string;
}

export interface WithdrawalWorkingBlockRow {
  label: string;
  scope_key: string;
  conversation_id: string | null;
  thread_id: string | null;
  task_id: string | null;
}

export interface WithdrawalIngestionJobRow {
  id: string;
  memory_conversation_id: string;
  thread_id: string;
  task_id: string | null;
  source_run_id: string | null;
  source_start_message_id: string | null;
  source_end_message_id: string;
}

export interface WithdrawalIngestionReceiptRow {
  job_id: string;
  episode_id: string | null;
  deterministic_fact_ids_json: string;
  provider_fact_ids_json: string;
  invalidated_fact_ids_json: string;
  bridged_evidence_fact_ids_json: string;
  agent_run_memory_fact_ids_json: string;
}

export interface MemoryWithdrawalLineage {
  target: FactRow;
  targetScope: MemoryWithdrawalScope;
  facts: FactRow[];
  factIds: string[];
  evidence: EvidenceRow[];
  episodes: EpisodeRow[];
  episodeIds: string[];
  reflections: WithdrawalReflectionRow[];
  workingBlocks: WithdrawalWorkingBlockRow[];
  receipts: WithdrawalIngestionReceiptRow[];
  jobs: WithdrawalIngestionJobRow[];
  jobIds: string[];
  receiptDeletionJobIds: string[];
  candidateEntityIds: string[];
  scopedSources: ScopedMemoryWithdrawalSource[];
  affectedScopes: MemoryWithdrawalScope[];
}

export interface ExactMemoryRetirementLineageSeed {
  factIds: ReadonlyArray<string>;
  scopedSources: ReadonlyArray<ScopedMemoryWithdrawalSource>;
}

export function normalizeWithdrawalOpaqueId(value: string | null | undefined): string | null {
  return isExactMemoryProvenanceId(value) ? value : null;
}

function sameDurableIdentity(row: FactRow, target: FactRow): boolean {
  return (
    row.content_hash === target.content_hash &&
    hasExactFactContentIdentity(
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
        memoryOwnerId: target.memory_owner_id,
        memoryKind: target.memory_kind,
        scope: target.scope,
        originConversationId: target.origin_conversation_id,
        originThreadId: target.origin_thread_id,
        originTaskId: target.origin_task_id,
        personaId: target.persona_id,
        subjectId: target.subject_id,
        predicate: target.predicate,
        objectText: target.object_text,
        objectEntityId: target.object_entity_id,
      },
    )
  );
}

function addSource(
  sources: SourceSets,
  kind: MemoryWithdrawalSourceKind,
  value: string | null | undefined,
): void {
  const id = normalizeWithdrawalOpaqueId(value);
  if (id) sources.get(kind)!.add(id);
}

function lineageStateSize(
  sourceIndexes: ReadonlyMap<string, ScopedSourceIndex>,
  affectedScopes: ReadonlyMap<string, MemoryWithdrawalScope>,
  episodeCount: number,
): number {
  let sourceCount = 0;
  for (const index of sourceIndexes.values()) {
    for (const sources of index.sources.values()) sourceCount += sources.size;
  }
  return sourceCount + affectedScopes.size + episodeCount;
}

function scopeKey(scope: MemoryWithdrawalScope): string {
  return JSON.stringify([scope.memoryConversationId, scope.sourceThreadId, scope.taskId]);
}

function getScopedSourceIndex(
  indexes: Map<string, ScopedSourceIndex>,
  scope: MemoryWithdrawalScope,
): ScopedSourceIndex {
  const key = scopeKey(scope);
  const existing = indexes.get(key);
  if (existing) return existing;
  const created: ScopedSourceIndex = {
    scope,
    sources: new Map<MemoryWithdrawalSourceKind, Set<string>>([
      ['message', new Set()],
      ['turn', new Set()],
      ['run', new Set()],
    ]),
  };
  indexes.set(key, created);
  return created;
}

function addScopedSource(
  sources: Map<string, ScopedMemoryWithdrawalSource>,
  scope: MemoryWithdrawalScope,
  sourceKind: MemoryWithdrawalSourceKind,
  value: string | null | undefined,
): void {
  const sourceId = normalizeWithdrawalOpaqueId(value);
  if (!sourceId) return;
  const source = { ...scope, sourceKind, sourceId };
  sources.set(
    JSON.stringify([
      scope.memoryConversationId,
      scope.sourceThreadId,
      scope.taskId,
      sourceKind,
      sourceId,
    ]),
    source,
  );
}

function intersects(values: ReadonlyArray<string>, expected: ReadonlySet<string>): boolean {
  return values.some((value) => expected.has(value));
}

function rawJsonArrayContainsId(raw: string, expected: ReadonlySet<string>): boolean {
  for (const id of expected) if (raw.includes(JSON.stringify(id))) return true;
  return false;
}

function parseLineageIds(raw: string): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('withdrawal_lineage_invalid');
  }
  if (
    !Array.isArray(parsed) ||
    parsed.length > MAX_LINEAGE_IDS ||
    !parsed.every(
      (value) => typeof value === 'string' && normalizeWithdrawalOpaqueId(value) === value,
    )
  ) {
    throw new Error('withdrawal_lineage_invalid');
  }
  return parsed;
}

function lineageFieldReferences(raw: string, expected: ReadonlySet<string>): boolean {
  if (!rawJsonArrayContainsId(raw, expected)) return false;
  try {
    return intersects(parseLineageIds(raw), expected);
  } catch {
    return true;
  }
}

function requireEpisodeSourceIdentityManifest(episode: EpisodeRow): EpisodeSourceIdentityManifest {
  const manifest = decodeEpisodeSourceIdentityManifest(episode.source_identity_manifest_json);
  if (!manifest) throw new Error('withdrawal_lineage_invalid');
  return manifest;
}

export function factWithdrawalScope(target: FactRow): MemoryWithdrawalScope {
  const memoryConversationId = target.origin_conversation_id ?? '';
  if (memoryConversationId && !isExactMemoryScopeId(memoryConversationId)) {
    throw new Error('memory_withdrawal_conversation_scope_invalid');
  }
  const sourceThreadId = target.origin_thread_id ?? memoryConversationId;
  if (sourceThreadId && !isExactMemoryScopeId(sourceThreadId)) {
    throw new Error('memory_withdrawal_thread_scope_invalid');
  }
  const taskId = target.origin_task_id ?? '';
  if (taskId && !isExactMemoryScopeId(taskId)) {
    throw new Error('memory_withdrawal_task_scope_invalid');
  }
  return {
    memoryConversationId,
    sourceThreadId,
    taskId,
  };
}

function episodeScope(episode: EpisodeRow): MemoryWithdrawalScope {
  const memoryConversationId = episode.conversation_id ?? '';
  if (memoryConversationId && !isExactMemoryScopeId(memoryConversationId)) {
    throw new Error('memory_withdrawal_conversation_scope_invalid');
  }
  const sourceThreadId = episode.thread_id ?? memoryConversationId;
  if (sourceThreadId && !isExactMemoryScopeId(sourceThreadId)) {
    throw new Error('memory_withdrawal_thread_scope_invalid');
  }
  const taskId = episode.task_id ?? '';
  if (taskId && !isExactMemoryScopeId(taskId)) {
    throw new Error('memory_withdrawal_task_scope_invalid');
  }
  return {
    memoryConversationId,
    sourceThreadId,
    taskId,
  };
}

function ingestionJobScope(job: WithdrawalIngestionJobRow): MemoryWithdrawalScope {
  if (!isExactMemoryScopeId(job.memory_conversation_id)) {
    throw new Error('memory_withdrawal_conversation_scope_invalid');
  }
  if (!isExactMemoryScopeId(job.thread_id)) {
    throw new Error('memory_withdrawal_thread_scope_invalid');
  }
  if (job.task_id !== null && !isExactMemoryScopeId(job.task_id)) {
    throw new Error('memory_withdrawal_task_scope_invalid');
  }
  return {
    memoryConversationId: job.memory_conversation_id,
    sourceThreadId: job.thread_id,
    taskId: job.task_id ?? '',
  };
}

function selectEvidenceRows(
  db: MemoryDatabase,
  factIds: ReadonlySet<string>,
  episodeIds: ReadonlySet<string> = new Set(),
): EvidenceRow[] {
  const rows = new Map<string, EvidenceRow>();
  const load = (column: 'fact_id' | 'episode_id', values: ReadonlyArray<string>) => {
    for (let offset = 0; offset < values.length; offset += SELECT_BATCH_SIZE) {
      const batch = values.slice(offset, offset + SELECT_BATCH_SIZE);
      for (const row of db.getAllSync<EvidenceRow>(
        `SELECT * FROM memory_fact_evidence
          WHERE ${column} IN (${batch.map(() => '?').join(', ')})`,
        ...batch,
      )) {
        rows.set(row.id, row);
      }
    }
  };
  load('fact_id', Array.from(factIds));
  load('episode_id', Array.from(episodeIds));
  return Array.from(rows.values());
}

function selectEpisodeCandidates(
  db: MemoryDatabase,
  scopes: ReadonlyArray<MemoryWithdrawalScope>,
  linkedEpisodeIds: ReadonlySet<string>,
): EpisodeRow[] {
  const rows = new Map<string, EpisodeRow>();
  for (const scope of scopes) {
    for (const row of db.getAllSync<EpisodeRow>(
      `SELECT * FROM memory_episodes
        WHERE COALESCE(conversation_id, '') = ?
          AND COALESCE(thread_id, '') = ?
          AND COALESCE(task_id, '') = ?`,
      scope.memoryConversationId,
      scope.sourceThreadId,
      scope.taskId,
    )) {
      rows.set(row.id, row);
    }
  }
  const linkedIds = Array.from(linkedEpisodeIds);
  for (let offset = 0; offset < linkedIds.length; offset += SELECT_BATCH_SIZE) {
    const batch = linkedIds.slice(offset, offset + SELECT_BATCH_SIZE);
    for (const row of db.getAllSync<EpisodeRow>(
      `SELECT * FROM memory_episodes WHERE id IN (${batch.map(() => '?').join(', ')})`,
      ...batch,
    )) {
      rows.set(row.id, row);
    }
  }
  return Array.from(rows.values());
}

function selectEpisodes(
  rows: ReadonlyArray<EpisodeRow>,
  linkedEpisodeIds: ReadonlySet<string>,
  sourceIndexes: ReadonlyMap<string, ScopedSourceIndex>,
): EpisodeRow[] {
  return rows.filter((row) => {
    if (linkedEpisodeIds.has(row.id)) return true;
    const index = sourceIndexes.get(scopeKey(episodeScope(row)));
    if (!index) return false;
    return requireEpisodeSourceIdentityManifest(row).sources.some((source) =>
      index.sources.get(source.sourceKind)!.has(source.sourceId),
    );
  });
}

function selectWorkingBlocksForScopes(
  db: MemoryDatabase,
  scopes: ReadonlyArray<MemoryWithdrawalScope>,
): WithdrawalWorkingBlockRow[] {
  const rows = new Map<string, WithdrawalWorkingBlockRow>();
  for (const scope of scopes) {
    if (!scope.memoryConversationId && !scope.sourceThreadId && !scope.taskId) continue;
    for (const row of db.getAllSync<WithdrawalWorkingBlockRow>(
      `SELECT label, scope_key, conversation_id, thread_id, task_id
         FROM memory_working_blocks
        WHERE COALESCE(conversation_id, '') = ?
          AND COALESCE(thread_id, '') = ?
          AND COALESCE(task_id, '') = ?
          AND label IN (${REBUILDABLE_SUMMARY_LABELS.map(() => '?').join(', ')})`,
      scope.memoryConversationId,
      scope.sourceThreadId,
      scope.taskId,
      ...REBUILDABLE_SUMMARY_LABELS,
    )) {
      rows.set(`${row.label}\u0000${row.scope_key}`, row);
    }
  }
  return Array.from(rows.values());
}

function selectIngestionJobsForScopes(
  db: MemoryDatabase,
  scopes: ReadonlyArray<MemoryWithdrawalScope>,
): WithdrawalIngestionJobRow[] {
  const rows = new Map<string, WithdrawalIngestionJobRow>();
  for (const scope of scopes) {
    for (const row of db.getAllSync<WithdrawalIngestionJobRow>(
      `SELECT id, memory_conversation_id, thread_id, task_id,
              source_run_id, source_start_message_id, source_end_message_id
         FROM memory_ingestion_jobs
        WHERE memory_conversation_id = ?
          AND thread_id = ?
          AND COALESCE(task_id, '') = ?`,
      scope.memoryConversationId,
      scope.sourceThreadId,
      scope.taskId,
    )) {
      rows.set(row.id, row);
    }
  }
  return Array.from(rows.values());
}

function selectIngestionJobsByIds(
  db: MemoryDatabase,
  ids: ReadonlySet<string>,
): WithdrawalIngestionJobRow[] {
  const rows: WithdrawalIngestionJobRow[] = [];
  const values = Array.from(ids);
  for (let offset = 0; offset < values.length; offset += SELECT_BATCH_SIZE) {
    const batch = values.slice(offset, offset + SELECT_BATCH_SIZE);
    rows.push(
      ...db.getAllSync<WithdrawalIngestionJobRow>(
        `SELECT id, memory_conversation_id, thread_id, task_id,
                source_run_id, source_start_message_id, source_end_message_id
           FROM memory_ingestion_jobs
          WHERE id IN (${batch.map(() => '?').join(', ')})`,
        ...batch,
      ),
    );
  }
  return rows;
}

function receiptReferencesLineage(
  row: WithdrawalIngestionReceiptRow,
  factIds: ReadonlySet<string>,
  episodeIds: ReadonlySet<string>,
): boolean {
  return (
    Boolean(row.episode_id && episodeIds.has(row.episode_id)) ||
    lineageFieldReferences(row.deterministic_fact_ids_json, factIds) ||
    lineageFieldReferences(row.provider_fact_ids_json, factIds) ||
    lineageFieldReferences(row.invalidated_fact_ids_json, factIds) ||
    lineageFieldReferences(row.bridged_evidence_fact_ids_json, factIds) ||
    lineageFieldReferences(row.agent_run_memory_fact_ids_json, factIds)
  );
}

function ingestionJobMatchesSources(
  row: WithdrawalIngestionJobRow,
  sourceIndexes: ReadonlyMap<string, ScopedSourceIndex>,
): boolean {
  const sourceIndex = sourceIndexes.get(scopeKey(ingestionJobScope(row)));
  if (!sourceIndex) return false;
  return (
    sourceIndex.sources.get('turn')!.has(row.source_end_message_id) ||
    Boolean(
      row.source_start_message_id &&
      sourceIndex.sources.get('message')!.has(row.source_start_message_id),
    ) ||
    Boolean(row.source_run_id && sourceIndex.sources.get('run')!.has(row.source_run_id))
  );
}

export function collectMemoryWithdrawalLineage(
  db: MemoryDatabase,
  target: FactRow,
  retirementSeed?: Readonly<ExactMemoryRetirementLineageSeed>,
): MemoryWithdrawalLineage {
  const targetScope = factWithdrawalScope(target);
  let facts: FactRow[];
  if (retirementSeed) {
    if (
      retirementSeed.factIds.length === 0 ||
      retirementSeed.factIds.length > MAX_LINEAGE_IDS ||
      !retirementSeed.factIds.includes(target.id) ||
      retirementSeed.factIds.some((id) => !normalizeWithdrawalOpaqueId(id)) ||
      new Set(retirementSeed.factIds).size !== retirementSeed.factIds.length
    ) {
      throw new Error('withdrawal_lineage_invalid');
    }
    facts = [];
    for (let offset = 0; offset < retirementSeed.factIds.length; offset += SELECT_BATCH_SIZE) {
      const batch = retirementSeed.factIds.slice(offset, offset + SELECT_BATCH_SIZE);
      facts.push(
        ...db.getAllSync<FactRow>(
          `SELECT * FROM memory_facts
            WHERE id IN (${batch.map(() => '?').join(', ')})
            ORDER BY id ASC`,
          ...batch,
        ),
      );
    }
    if (
      facts.length !== retirementSeed.factIds.length ||
      new Set(facts.map((row) => row.id)).size !== retirementSeed.factIds.length
    ) {
      throw new Error('withdrawal_lineage_invalid');
    }
  } else {
    facts = db
      .getAllSync<FactRow>(
        'SELECT * FROM memory_facts WHERE id = ? OR content_hash = ?',
        target.id,
        target.content_hash,
      )
      .filter((row) => row.id === target.id || sameDurableIdentity(row, target));
  }
  const factIds = new Set(facts.map((row) => row.id));
  const sourceIndexes = new Map<string, ScopedSourceIndex>();
  const affectedScopes = new Map<string, MemoryWithdrawalScope>();
  const scopedSources = new Map<string, ScopedMemoryWithdrawalSource>();
  const factScopes = new Map<string, MemoryWithdrawalScope>();
  if ((retirementSeed?.scopedSources.length ?? 0) > MAX_LINEAGE_IDS) {
    throw new Error('withdrawal_lineage_limit');
  }
  for (const source of retirementSeed?.scopedSources ?? []) {
    if (
      !isExactMemoryScopeId(source.memoryConversationId) ||
      !isExactMemoryScopeId(source.sourceThreadId) ||
      (source.taskId !== '' && !isExactMemoryScopeId(source.taskId)) ||
      !normalizeWithdrawalOpaqueId(source.sourceId) ||
      (source.sourceKind !== 'message' &&
        source.sourceKind !== 'turn' &&
        source.sourceKind !== 'run')
    ) {
      throw new Error('withdrawal_lineage_invalid');
    }
    const scope = {
      memoryConversationId: source.memoryConversationId,
      sourceThreadId: source.sourceThreadId,
      taskId: source.taskId,
    };
    const sourceIndex = getScopedSourceIndex(sourceIndexes, scope);
    affectedScopes.set(scopeKey(scope), scope);
    addSource(sourceIndex.sources, source.sourceKind, source.sourceId);
    addScopedSource(scopedSources, scope, source.sourceKind, source.sourceId);
  }
  for (const fact of facts) {
    const factScope = factWithdrawalScope(fact);
    const sourceIndex = getScopedSourceIndex(sourceIndexes, factScope);
    affectedScopes.set(scopeKey(factScope), factScope);
    factScopes.set(fact.id, factScope);
    addSource(sourceIndex.sources, 'message', fact.source_message_id);
    addSource(sourceIndex.sources, 'turn', fact.source_turn_id);
    addSource(sourceIndex.sources, 'run', fact.source_run_id);
    addScopedSource(scopedSources, factScope, 'message', fact.source_message_id);
    addScopedSource(scopedSources, factScope, 'turn', fact.source_turn_id);
    addScopedSource(scopedSources, factScope, 'run', fact.source_run_id);
  }

  const directEvidence = selectEvidenceRows(db, factIds);
  const linkedEpisodeIds = new Set(
    directEvidence.map((row) => row.episode_id).filter((id): id is string => Boolean(id)),
  );
  for (const row of directEvidence) {
    const factScope = factScopes.get(row.fact_id) ?? targetScope;
    addSource(getScopedSourceIndex(sourceIndexes, factScope).sources, 'message', row.message_id);
    addScopedSource(scopedSources, factScope, 'message', row.message_id);
  }

  const episodesById = new Map<string, EpisodeRow>();
  let evidence = directEvidence;
  for (let iteration = 0; iteration <= MAX_LINEAGE_IDS; iteration += 1) {
    const priorStateSize = lineageStateSize(sourceIndexes, affectedScopes, episodesById.size);
    for (const episode of selectEpisodes(
      selectEpisodeCandidates(db, Array.from(affectedScopes.values()), linkedEpisodeIds),
      linkedEpisodeIds,
      sourceIndexes,
    )) {
      episodesById.set(episode.id, episode);
    }
    if (episodesById.size > MAX_LINEAGE_IDS) throw new Error('withdrawal_lineage_limit');
    for (const episode of episodesById.values()) {
      const currentScope = episodeScope(episode);
      const sourceIndex = getScopedSourceIndex(sourceIndexes, currentScope);
      affectedScopes.set(scopeKey(currentScope), currentScope);
      for (const source of requireEpisodeSourceIdentityManifest(episode).sources) {
        addSource(sourceIndex.sources, source.sourceKind, source.sourceId);
        addScopedSource(scopedSources, currentScope, source.sourceKind, source.sourceId);
      }
    }
    const episodeIds = new Set(episodesById.keys());
    evidence = selectEvidenceRows(db, factIds, episodeIds);
    for (const row of evidence) {
      const currentScope =
        factScopes.get(row.fact_id) ??
        (row.episode_id ? episodeScope(episodesById.get(row.episode_id)!) : targetScope);
      addSource(
        getScopedSourceIndex(sourceIndexes, currentScope).sources,
        'message',
        row.message_id,
      );
      addScopedSource(scopedSources, currentScope, 'message', row.message_id);
    }
    const nextStateSize = lineageStateSize(sourceIndexes, affectedScopes, episodesById.size);
    if (nextStateSize === priorStateSize) break;
    if (iteration === MAX_LINEAGE_IDS) throw new Error('withdrawal_lineage_limit');
  }
  const episodes = Array.from(episodesById.values());
  const episodeIds = new Set(episodesById.keys());
  const reflections = db
    .getAllSync<WithdrawalReflectionRow>('SELECT * FROM memory_reflections')
    .filter(
      (row) =>
        lineageFieldReferences(row.source_fact_ids_json, factIds) ||
        lineageFieldReferences(row.source_episode_ids_json, episodeIds),
    );
  const receipts = db
    .getAllSync<WithdrawalIngestionReceiptRow>(
      `SELECT job_id, episode_id, deterministic_fact_ids_json, provider_fact_ids_json,
              invalidated_fact_ids_json, bridged_evidence_fact_ids_json,
              agent_run_memory_fact_ids_json
         FROM memory_ingestion_receipts
       UNION ALL
       SELECT job_id, episode_id, deterministic_fact_ids_json, provider_fact_ids_json,
              invalidated_fact_ids_json, bridged_evidence_fact_ids_json,
              agent_run_memory_fact_ids_json
         FROM memory_ingestion_structural_receipts`,
    )
    .filter((row) => receiptReferencesLineage(row, factIds, episodeIds));
  const receiptJobIds = new Set(receipts.map((row) => row.job_id));
  const jobsById = new Map(selectIngestionJobsByIds(db, receiptJobIds).map((row) => [row.id, row]));
  const expandedJobIds = new Set<string>();
  for (let iteration = 0; iteration <= MAX_LINEAGE_IDS; iteration += 1) {
    if (jobsById.size > MAX_LINEAGE_IDS) throw new Error('withdrawal_lineage_limit');
    for (const job of jobsById.values()) {
      if (expandedJobIds.has(job.id)) continue;
      expandedJobIds.add(job.id);
      const currentScope = ingestionJobScope(job);
      const sourceIndex = getScopedSourceIndex(sourceIndexes, currentScope);
      affectedScopes.set(scopeKey(currentScope), currentScope);
      addSource(sourceIndex.sources, 'message', job.source_start_message_id);
      addSource(sourceIndex.sources, 'turn', job.source_end_message_id);
      addSource(sourceIndex.sources, 'run', job.source_run_id);
      addScopedSource(scopedSources, currentScope, 'message', job.source_start_message_id);
      addScopedSource(scopedSources, currentScope, 'turn', job.source_end_message_id);
      addScopedSource(scopedSources, currentScope, 'run', job.source_run_id);
    }
    let added = 0;
    for (const job of selectIngestionJobsForScopes(db, Array.from(affectedScopes.values()))) {
      if (jobsById.has(job.id) || !ingestionJobMatchesSources(job, sourceIndexes)) continue;
      jobsById.set(job.id, job);
      added += 1;
    }
    if (added === 0) break;
    if (iteration === MAX_LINEAGE_IDS) throw new Error('withdrawal_lineage_limit');
  }
  const jobs = Array.from(jobsById.values());
  const jobIds = new Set(jobs.map((row) => row.id));
  const workingBlocks = selectWorkingBlocksForScopes(db, Array.from(affectedScopes.values()));
  const candidateEntityIds = new Set<string>();
  for (const fact of facts) {
    candidateEntityIds.add(fact.subject_id);
    if (fact.object_entity_id) candidateEntityIds.add(fact.object_entity_id);
  }

  return {
    target,
    targetScope,
    facts,
    factIds: Array.from(factIds),
    evidence,
    episodes,
    episodeIds: Array.from(episodeIds),
    reflections,
    workingBlocks,
    receipts,
    jobs,
    jobIds: Array.from(jobIds),
    receiptDeletionJobIds: Array.from(new Set([...receiptJobIds, ...jobIds])),
    candidateEntityIds: Array.from(candidateEntityIds),
    scopedSources: Array.from(scopedSources.values()),
    affectedScopes: Array.from(affectedScopes.values()),
  };
}
