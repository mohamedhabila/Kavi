// ---------------------------------------------------------------------------
// Kavi — Memory reflections (structural, background-only)
// ---------------------------------------------------------------------------
// Higher-level summaries from episodes and facts. Generated during ingestion
// drain — no LLM on the chat critical path, no English heuristics.
// ---------------------------------------------------------------------------

import { createLogger } from '../../utils/logger';
import type { MemoryEpisode } from './episodes/types';
import { listEpisodes } from './episodes/queries';
import type { MemoryFact } from './facts/types';
import { listFacts } from './facts/queries';
import { isMainInferenceActive, shouldAbortIngestionDueToMemoryPressure } from './onDeviceGuards';
import { getOne } from './access/crud';
import { getSchemaReadyMemoryDb } from './access/schemaGuard';
import { newId, safeParseArray } from './schema';
import { notifyStructuredMemoryChanged } from './store';

const logger = createLogger('memory.reflections');

const DAY_MS = 86_400_000;
const MAX_REFLECTION_CONTENT_CHARS = 2_400;
const MAX_EPISODE_LINES = 6;
const MAX_FACT_LINES = 8;

export type MemoryReflectionScope = 'thread' | 'task';
export type MemoryReflectionKind = 'daily_focus' | 'task_period';

export interface MemoryReflection {
  id: string;
  scope: MemoryReflectionScope;
  threadId: string | null;
  taskId: string | null;
  periodStart: number;
  periodEnd: number;
  kind: MemoryReflectionKind;
  content: string;
  sourceEpisodeIds: string[];
  sourceFactIds: string[];
  createdAt: number;
  updatedAt: number;
  deletedAt: number | null;
}

interface ReflectionRow {
  id: string;
  scope: string;
  thread_id: string | null;
  task_id: string | null;
  period_start: number;
  period_end: number;
  kind: string;
  content: string;
  source_episode_ids_json: string;
  source_fact_ids_json: string;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
}

function rowToReflection(row: ReflectionRow): MemoryReflection {
  return {
    id: row.id,
    scope: row.scope as MemoryReflectionScope,
    threadId: row.thread_id,
    taskId: row.task_id,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    kind: row.kind as MemoryReflectionKind,
    content: row.content,
    sourceEpisodeIds: safeParseArray<string>(row.source_episode_ids_json),
    sourceFactIds: safeParseArray<string>(row.source_fact_ids_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
  };
}

export function dayPeriodBounds(now: number): { start: number; end: number } {
  const start = Math.floor(now / DAY_MS) * DAY_MS;
  return { start, end: start + DAY_MS };
}

export function buildReflectionContent(params: {
  episodes: ReadonlyArray<MemoryEpisode>;
  facts: ReadonlyArray<MemoryFact>;
}): string | null {
  const lines: string[] = [];

  for (const episode of params.episodes.slice(0, MAX_EPISODE_LINES)) {
    const summary = episode.summary.trim();
    if (!summary) continue;
    lines.push(`episode:${episode.id} ${summary.slice(0, 240)}`);
  }

  const rankedFacts = [...params.facts].sort((left, right) => right.importance - left.importance);
  for (const fact of rankedFacts.slice(0, MAX_FACT_LINES)) {
    const objectText = fact.objectText.trim();
    if (!objectText) continue;
    lines.push(`fact:${fact.id} ${fact.predicate}:${objectText.slice(0, 120)}`);
  }

  if (lines.length === 0) {
    return null;
  }

  const content = lines.join('\n');
  return content.length > MAX_REFLECTION_CONTENT_CHARS
    ? `${content.slice(0, MAX_REFLECTION_CONTENT_CHARS - 3).trimEnd()}...`
    : content;
}

export interface UpsertReflectionInput {
  scope: MemoryReflectionScope;
  threadId: string;
  taskId?: string | null;
  periodStart: number;
  periodEnd: number;
  kind: MemoryReflectionKind;
  content: string;
  sourceEpisodeIds: string[];
  sourceFactIds: string[];
  now?: number;
}

export function upsertReflection(input: UpsertReflectionInput): MemoryReflection | null {
  const db = getSchemaReadyMemoryDb();
  const content = input.content.trim();
  if (!content) return null;

  const now = input.now ?? Date.now();
  const existing = db.getFirstSync<ReflectionRow>(
    `SELECT * FROM memory_reflections
       WHERE thread_id = ?
         AND kind = ?
         AND period_start = ?
         AND deleted_at IS NULL
       LIMIT 1`,
    input.threadId,
    input.kind,
    input.periodStart,
  );

  if (existing) {
    db.runSync(
      `UPDATE memory_reflections
         SET content = ?,
             source_episode_ids_json = ?,
             source_fact_ids_json = ?,
             task_id = ?,
             updated_at = ?
       WHERE id = ?`,
      content,
      JSON.stringify(input.sourceEpisodeIds),
      JSON.stringify(input.sourceFactIds),
      input.taskId ?? null,
      now,
      existing.id,
    );
    notifyStructuredMemoryChanged(input.threadId);
    return rowToReflection({
      ...existing,
      content,
      source_episode_ids_json: JSON.stringify(input.sourceEpisodeIds),
      source_fact_ids_json: JSON.stringify(input.sourceFactIds),
      task_id: input.taskId ?? null,
      updated_at: now,
    });
  }

  const reflection: MemoryReflection = {
    id: newId('reflection'),
    scope: input.scope,
    threadId: input.threadId,
    taskId: input.taskId ?? null,
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    kind: input.kind,
    content,
    sourceEpisodeIds: input.sourceEpisodeIds,
    sourceFactIds: input.sourceFactIds,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  };

  db.runSync(
    `INSERT INTO memory_reflections
       (id, scope, thread_id, task_id, period_start, period_end, kind, content,
        source_episode_ids_json, source_fact_ids_json, created_at, updated_at, deleted_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
    reflection.id,
    reflection.scope,
    reflection.threadId,
    reflection.taskId,
    reflection.periodStart,
    reflection.periodEnd,
    reflection.kind,
    reflection.content,
    JSON.stringify(reflection.sourceEpisodeIds),
    JSON.stringify(reflection.sourceFactIds),
    reflection.createdAt,
    reflection.updatedAt,
  );
  notifyStructuredMemoryChanged(input.threadId);
  return reflection;
}

export function getLatestReflection(params: {
  threadId: string;
  kind?: MemoryReflectionKind;
}): MemoryReflection | null {
  const clauses = ['thread_id = ?', 'deleted_at IS NULL'];
  const queryParams: Array<string | number> = [params.threadId];
  if (params.kind) {
    clauses.push('kind = ?');
    queryParams.push(params.kind);
  }
  const row = getOne<ReflectionRow>(
    `SELECT * FROM memory_reflections
       WHERE ${clauses.join(' AND ')}
       ORDER BY period_start DESC, updated_at DESC
       LIMIT 1`,
    ...queryParams,
  );
  return row ? rowToReflection(row) : null;
}

export function refreshThreadReflection(input: {
  threadId: string;
  taskId?: string | null;
  now?: number;
}): MemoryReflection | null {
  if (shouldAbortIngestionDueToMemoryPressure() || isMainInferenceActive()) {
    return null;
  }

  const threadId = input.threadId.trim();
  if (!threadId) return null;

  try {
    const now = input.now ?? Date.now();
    const { start, end } = dayPeriodBounds(now);
    const episodes = listEpisodes({ threadId, limit: 24 }).filter(
      (episode) => episode.endedAt >= start && episode.endedAt < end,
    );
    const facts = listFacts({ originConversationId: threadId, limit: 24 }).filter(
      (fact) => fact.createdAt >= start && fact.createdAt < end,
    );
    const content = buildReflectionContent({ episodes, facts });
    if (!content) {
      return null;
    }

    return upsertReflection({
      scope: 'thread',
      threadId,
      taskId: input.taskId ?? null,
      periodStart: start,
      periodEnd: end,
      kind: 'daily_focus',
      content,
      sourceEpisodeIds: episodes.map((episode) => episode.id),
      sourceFactIds: facts.map((fact) => fact.id),
      now,
    });
  } catch (error) {
    logger.devWarn(
      'refreshThreadReflection failed:',
      error instanceof Error ? error.message : String(error),
    );
    return null;
  }
}
