import { countRows, getMany } from '../access/crud';
import {
  rowToEpisode,
  rowToEvidence,
  type EpisodeRow,
  type EvidenceRow,
  type ListEpisodesOptions,
  type MemoryEpisode,
  type MemoryFactEvidence,
} from './types';

export function listEpisodes(options: ListEpisodesOptions = {}): MemoryEpisode[] {
  const clauses: string[] = [];
  const params: Array<string | number> = [];
  if (options.conversationId) {
    clauses.push('conversation_id = ?');
    params.push(options.conversationId);
  }
  if (options.threadId) {
    clauses.push('thread_id = ?');
    params.push(options.threadId);
  }
  if (options.taskId) {
    clauses.push('task_id = ?');
    params.push(options.taskId);
  }
  if (!options.includeDeleted) clauses.push('deleted_at IS NULL');
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const limit = Math.max(1, Math.min(options.limit ?? 50, 200));
  const rows = getMany<EpisodeRow>(
    `SELECT * FROM memory_episodes ${where} ORDER BY ended_at DESC LIMIT ${limit}`,
    ...params,
  );
  return rows.map(rowToEpisode);
}

export function countEpisodes(
  options: { conversationId?: string; threadId?: string; taskId?: string } = {},
): number {
  const clauses: string[] = ['deleted_at IS NULL'];
  const params: Array<string | number> = [];
  if (options.conversationId) {
    clauses.push('conversation_id = ?');
    params.push(options.conversationId);
  }
  if (options.threadId) {
    clauses.push('thread_id = ?');
    params.push(options.threadId);
  }
  if (options.taskId) {
    clauses.push('task_id = ?');
    params.push(options.taskId);
  }
  const where = clauses.join(' AND ');
  return countRows(`SELECT COUNT(*) as count FROM memory_episodes WHERE ${where}`, ...params);
}

export function listFactEvidence(factId: string): MemoryFactEvidence[] {
  const rows = getMany<EvidenceRow>(
    `SELECT * FROM memory_fact_evidence WHERE fact_id = ? ORDER BY created_at DESC`,
    factId,
  );
  return rows.map(rowToEvidence);
}
