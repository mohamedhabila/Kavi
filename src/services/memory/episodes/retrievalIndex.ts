import type { MemoryDatabase } from '../access/schemaGuard';
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

export function replaceEpisodeRetrievalTerms(
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

  db.execSync('BEGIN IMMEDIATE TRANSACTION');
  try {
    db.runSync('DELETE FROM memory_episode_terms');
    const episodes = db.getAllSync<EpisodeIndexSourceRow>(
      `SELECT id, summary, entities_json, tool_names_json
         FROM memory_episodes
        ORDER BY id`,
    );
    for (const episode of episodes) {
      replaceEpisodeRetrievalTerms(db, {
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
    db.execSync('COMMIT');
  } catch (error) {
    db.execSync('ROLLBACK');
    throw error;
  }
}
