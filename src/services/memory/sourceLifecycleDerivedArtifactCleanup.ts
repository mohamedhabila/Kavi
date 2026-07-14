import { sha256HexUtf8 } from '../../utils/sha256';
import type { MemoryDatabase } from './access/schemaGuard';
import type { PersistedExactMemorySourceIdentity } from './exactMemorySourceIdentity';
import { decodeVerifiedProcedureEvidenceManifest } from './verifiedProcedure/evidenceManifest';
import { fenceVerifiedProcedureExecutionRunHashes } from './verifiedProcedure/invalidation';
import { hashVerifiedProcedureProvenanceSync } from './verifiedProcedure/provenanceHash';

const PAGE_SIZE = 128;
const MAX_IDS_PER_DERIVED_ROW = 4_096;

interface ReflectionRow {
  id: string;
  thread_id: string | null;
  source_episode_ids_json: string;
  source_fact_ids_json: string;
}

interface RetrievalEventRow {
  id: string;
  source_thread_id_hash: string | null;
  selected_fact_ids_json: string;
  selected_episode_ids_json: string;
}

interface VerifiedObservationRow {
  id: string;
  source_thread_id_hash: string;
  source_run_id_hash: string;
  evidence_manifest_json: string;
}

export interface SourceLifecycleDerivedArtifactCleanupInput {
  memoryOwnerId: string;
  broadThreadIds: ReadonlySet<string>;
  retiredFactIds: ReadonlySet<string>;
  episodeIds: ReadonlySet<string>;
  closedSources: ReadonlyArray<Readonly<PersistedExactMemorySourceIdentity>>;
  now: number;
}

export interface SourceLifecycleDerivedArtifactCleanupReceipt {
  reflections: number;
  retrievalEvents: number;
}

function fail(code: string): never {
  throw new Error(code);
}

function parseIds(raw: string): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return fail('memory_source_lifecycle_derived_lineage_invalid');
  }
  if (
    !Array.isArray(parsed) ||
    parsed.length > MAX_IDS_PER_DERIVED_ROW ||
    parsed.some((value) => typeof value !== 'string')
  ) {
    return fail('memory_source_lifecycle_derived_lineage_invalid');
  }
  return parsed as string[];
}

function intersects(raw: string, ids: ReadonlySet<string>): boolean {
  if (ids.size === 0) return false;
  return parseIds(raw).some((id) => ids.has(id));
}

function deleteIds(db: MemoryDatabase, table: string, ids: ReadonlyArray<string>): number {
  if (ids.length === 0) return 0;
  const deleted =
    db.runSync(`DELETE FROM ${table} WHERE id IN (${ids.map(() => '?').join(', ')})`, ...ids)
      .changes ?? 0;
  if (deleted !== ids.length) return fail('memory_source_lifecycle_derived_residual');
  return deleted;
}

function cleanupReflections(
  db: MemoryDatabase,
  input: SourceLifecycleDerivedArtifactCleanupInput,
): number {
  let cursor = '';
  let deleted = 0;
  for (;;) {
    const rows = db.getAllSync<ReflectionRow>(
      `SELECT id, thread_id, source_episode_ids_json, source_fact_ids_json
         FROM memory_reflections
        WHERE id > ? ORDER BY id ASC LIMIT ${PAGE_SIZE}`,
      cursor,
    );
    if (rows.length === 0) return deleted;
    cursor = rows[rows.length - 1]!.id;
    const matchingIds = rows
      .filter(
        (row) =>
          Boolean(row.thread_id && input.broadThreadIds.has(row.thread_id)) ||
          intersects(row.source_fact_ids_json, input.retiredFactIds) ||
          intersects(row.source_episode_ids_json, input.episodeIds),
      )
      .map((row) => row.id);
    deleted += deleteIds(db, 'memory_reflections', matchingIds);
  }
}

function cleanupRetrievalEvents(
  db: MemoryDatabase,
  input: SourceLifecycleDerivedArtifactCleanupInput,
  broadThreadHashes: ReadonlySet<string>,
): number {
  let cursor = '';
  let deleted = 0;
  for (;;) {
    const rows = db.getAllSync<RetrievalEventRow>(
      `SELECT id, source_thread_id_hash, selected_fact_ids_json, selected_episode_ids_json
         FROM memory_retrieval_events
        WHERE id > ? ORDER BY id ASC LIMIT ${PAGE_SIZE}`,
      cursor,
    );
    if (rows.length === 0) return deleted;
    cursor = rows[rows.length - 1]!.id;
    const matchingIds = rows
      .filter(
        (row) =>
          Boolean(row.source_thread_id_hash && broadThreadHashes.has(row.source_thread_id_hash)) ||
          intersects(row.selected_fact_ids_json, input.retiredFactIds) ||
          intersects(row.selected_episode_ids_json, input.episodeIds),
      )
      .map((row) => row.id);
    deleted += deleteIds(db, 'memory_retrieval_events', matchingIds);
  }
}

function observationMatchesExactSource(
  row: VerifiedObservationRow,
  sources: ReadonlyArray<Readonly<PersistedExactMemorySourceIdentity>>,
): boolean {
  const manifest = decodeVerifiedProcedureEvidenceManifest(row.evidence_manifest_json);
  if (!manifest) return fail('memory_source_lifecycle_derived_lineage_invalid');
  return sources.some((source) => {
    if (
      manifest.sourceLineage.taskIdHash !==
      (source.taskId
        ? hashVerifiedProcedureProvenanceSync('memory-source-task', source.taskId)
        : null)
    ) {
      return false;
    }
    const domain =
      source.sourceKind === 'message'
        ? 'memory-source-message'
        : source.sourceKind === 'turn'
          ? 'memory-source-turn'
          : 'memory-source-run';
    const hash = hashVerifiedProcedureProvenanceSync(domain, source.sourceId);
    return source.sourceKind === 'message'
      ? manifest.sourceLineage.sourceMessageIdHash === hash
      : source.sourceKind === 'turn'
        ? manifest.sourceLineage.sourceTurnIdHash === hash
        : manifest.sourceLineage.sourceRunIdHash === hash;
  });
}

function cleanupVerifiedProcedureObservations(
  db: MemoryDatabase,
  input: SourceLifecycleDerivedArtifactCleanupInput,
): void {
  const broadThreadHashes = new Set(
    Array.from(input.broadThreadIds, (id) =>
      hashVerifiedProcedureProvenanceSync('source-thread', id),
    ),
  );
  const sourcesByThread = new Map<string, PersistedExactMemorySourceIdentity[]>();
  for (const source of input.closedSources) {
    const threadHash = hashVerifiedProcedureProvenanceSync('source-thread', source.sourceThreadId);
    const sources = sourcesByThread.get(threadHash) ?? [];
    sources.push(source);
    sourcesByThread.set(threadHash, sources);
  }
  for (const threadHash of broadThreadHashes) {
    if (!sourcesByThread.has(threadHash)) sourcesByThread.set(threadHash, []);
  }

  for (const [threadHash, sources] of sourcesByThread) {
    let cursor = '';
    for (;;) {
      const rows = db.getAllSync<VerifiedObservationRow>(
        `SELECT id, source_thread_id_hash, source_run_id_hash, evidence_manifest_json
           FROM memory_verified_procedure_observations
          WHERE source_thread_id_hash = ? AND id > ?
          ORDER BY id ASC LIMIT ${PAGE_SIZE}`,
        threadHash,
        cursor,
      );
      if (rows.length === 0) break;
      cursor = rows[rows.length - 1]!.id;
      const broad = broadThreadHashes.has(threadHash);
      const matches = broad
        ? rows
        : rows.filter((row) => observationMatchesExactSource(row, sources));
      if (matches.length === 0) continue;
      fenceVerifiedProcedureExecutionRunHashes({
        db,
        memoryOwnerId: input.memoryOwnerId,
        sourceRunIdHashes: matches.map((row) => row.source_run_id_hash),
        invalidatedAt: input.now,
      });
      deleteIds(
        db,
        'memory_verified_procedure_observations',
        matches.map((row) => row.id),
      );
    }
  }
}

export function cleanupSourceLifecycleDerivedArtifactsInTransaction(
  db: MemoryDatabase,
  input: Readonly<SourceLifecycleDerivedArtifactCleanupInput>,
): Readonly<SourceLifecycleDerivedArtifactCleanupReceipt> {
  const retrievalThreadHashes = new Set(
    Array.from(input.broadThreadIds, (id) => sha256HexUtf8(`source_thread\u0000${id}`)),
  );
  cleanupVerifiedProcedureObservations(db, input);
  const reflections = cleanupReflections(db, input);
  const retrievalEvents = cleanupRetrievalEvents(db, input, retrievalThreadHashes);
  for (const threadHash of retrievalThreadHashes) {
    db.runSync('DELETE FROM memory_retrieval_outcomes WHERE source_thread_id_hash = ?', threadHash);
    if (
      db.getFirstSync<{ present: number }>(
        'SELECT 1 AS present FROM memory_retrieval_outcomes WHERE source_thread_id_hash = ? LIMIT 1',
        threadHash,
      )
    ) {
      return fail('memory_source_lifecycle_derived_residual');
    }
  }
  return Object.freeze({ reflections, retrievalEvents });
}
