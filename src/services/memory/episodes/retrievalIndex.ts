import { getSchemaReadyMemoryDb, type MemoryDatabase } from '../access/schemaGuard';
import { assertMemoryTransactionActive } from '../access/transaction';
import {
  advanceMemoryProjectionRevision,
  invalidateMemoryProjectionProcessEpoch,
} from '../memoryAuthorityState';
import { getLocalMemoryVaultOwnerId } from '../memoryVaultIdentity';
import { episodeIndexUnits } from './queryScoring';
import type { MemoryEpisode } from './types';

export const EPISODE_RETRIEVAL_INDEX_VERSION = 1;

interface EpisodeIndexSourceRow {
  id: string;
  summary: string;
  entities_json: string;
  tool_names_json: string;
}

function stringArray(raw: string): string[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((value): value is string => typeof value === 'string')
      : [];
  } catch {
    return [];
  }
}

function replaceEpisodeRetrievalTermsUnchecked(
  db: MemoryDatabase,
  episode: Pick<MemoryEpisode, 'id' | 'summary' | 'entities' | 'toolNames'>,
): void {
  db.runSync('DELETE FROM memory_episode_terms WHERE episode_id = ?', episode.id);
  for (const unit of episodeIndexUnits(episode)) {
    db.runSync(
      'INSERT INTO memory_episode_terms(episode_id, unit) VALUES (?, ?)',
      episode.id,
      unit,
    );
  }
}

/** Caller owns the surrounding transaction and its matching authority revision. */
export function replaceEpisodeRetrievalTermsInTransaction(
  db: MemoryDatabase,
  episode: Pick<MemoryEpisode, 'id' | 'summary' | 'entities' | 'toolNames'>,
): void {
  assertMemoryTransactionActive('episode_retrieval_index_transaction_required');
  if (db !== getSchemaReadyMemoryDb()) {
    throw new Error('episode_retrieval_index_database_mismatch');
  }
  replaceEpisodeRetrievalTermsUnchecked(db, episode);
}

export function ensureEpisodeRetrievalIndexSchema(db: MemoryDatabase): void {
  db.execSync(`
    CREATE TABLE IF NOT EXISTS memory_episode_terms (
      episode_id TEXT NOT NULL,
      unit TEXT NOT NULL,
      PRIMARY KEY (episode_id, unit)
    );
    CREATE INDEX IF NOT EXISTS idx_episode_terms_unit_episode
      ON memory_episode_terms(unit, episode_id);
    CREATE TABLE IF NOT EXISTS memory_episode_retrieval_index_meta (
      singleton INTEGER PRIMARY KEY CHECK(singleton = 1),
      version INTEGER NOT NULL CHECK(version > 0)
    );
    CREATE TRIGGER IF NOT EXISTS trg_episode_terms_delete
      AFTER DELETE ON memory_episodes
      BEGIN
        DELETE FROM memory_episode_terms WHERE episode_id = OLD.id;
      END;
  `);
  const version = db.getFirstSync<{ version: number }>(
    'SELECT version FROM memory_episode_retrieval_index_meta WHERE singleton = 1',
  )?.version;
  if (version === EPISODE_RETRIEVAL_INDEX_VERSION) return;

  let promptProjectionChanged = false;
  db.execSync('BEGIN IMMEDIATE TRANSACTION');
  try {
    db.runSync('DELETE FROM memory_episode_terms');
    const episodes = db.getAllSync<EpisodeIndexSourceRow>(
      `SELECT id, summary, entities_json, tool_names_json
         FROM memory_episodes
        WHERE deleted_at IS NULL
        ORDER BY id`,
    );
    promptProjectionChanged = episodes.length > 0;
    for (const episode of episodes) {
      replaceEpisodeRetrievalTermsUnchecked(db, {
        id: episode.id,
        summary: episode.summary,
        entities: stringArray(episode.entities_json),
        toolNames: stringArray(episode.tool_names_json),
      });
    }
    db.runSync(
      `INSERT OR REPLACE INTO memory_episode_retrieval_index_meta(singleton, version)
       VALUES (1, ?)`,
      EPISODE_RETRIEVAL_INDEX_VERSION,
    );
    if (promptProjectionChanged) {
      advanceMemoryProjectionRevision(db, getLocalMemoryVaultOwnerId(db));
    }
    db.execSync('COMMIT');
  } catch (error) {
    db.execSync('ROLLBACK');
    throw error;
  }
  if (promptProjectionChanged) invalidateMemoryProjectionProcessEpoch();
}
