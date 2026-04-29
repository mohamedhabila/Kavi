// ---------------------------------------------------------------------------
// Kavi — Canonical entity registry
// ---------------------------------------------------------------------------
// Case-folded canonical names with alias rollup. Soft-delete only.
// Backed by `memory_entities` (see ./schema.ts).
// ---------------------------------------------------------------------------

import { getMemoryDb } from './sqlite-store';
import {
  ensureFactSchema,
  jsonLikeEscape,
  newId,
  normalizeName,
  safeParseArray,
  safeParseObject,
} from './schema';

export type EntityType =
  | 'person'
  | 'place'
  | 'org'
  | 'project'
  | 'thing'
  | 'concept'
  | 'event'
  | 'self';

export interface MemoryEntity {
  id: string;
  canonicalName: string;
  type: EntityType;
  aliases: string[];
  attributes: Record<string, unknown>;
  firstSeenAt: number;
  lastSeenAt: number;
  deletedAt: number | null;
}

interface EntityRow {
  id: string;
  canonical_name: string;
  type: string;
  aliases: string;
  attributes: string;
  first_seen_at: number;
  last_seen_at: number;
  deleted_at: number | null;
}

function rowToEntity(row: EntityRow): MemoryEntity {
  return {
    id: row.id,
    canonicalName: row.canonical_name,
    type: row.type as EntityType,
    aliases: safeParseArray<string>(row.aliases),
    attributes: safeParseObject(row.attributes),
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at,
    deletedAt: row.deleted_at,
  };
}

function uniqueAliases(input: string[] | undefined, canonical: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of input ?? []) {
    const norm = normalizeName(raw);
    if (!norm || norm === canonical) continue;
    if (seen.has(norm)) continue;
    seen.add(norm);
    out.push(norm);
  }
  return out;
}

export interface UpsertEntityInput {
  name: string;
  type: EntityType;
  aliases?: string[];
  attributes?: Record<string, unknown>;
  now?: number;
}

/**
 * Look up by canonical name OR alias. Returns the existing entity (rolling up
 * the alias and bumping `last_seen_at`) or creates a new one.
 */
export function upsertEntity(input: UpsertEntityInput): MemoryEntity {
  ensureFactSchema();
  const db = getMemoryDb();
  const now = input.now ?? Date.now();
  const canonical = normalizeName(input.name);
  if (!canonical) {
    throw new Error('upsertEntity: name is required');
  }

  const exact = db.getFirstSync<EntityRow>(
    `SELECT * FROM memory_entities
       WHERE canonical_name = ? AND deleted_at IS NULL
       LIMIT 1`,
    canonical,
  );
  if (exact) return mergeAndPersist(exact, input, now);

  const candidates = db.getAllSync<EntityRow>(
    `SELECT * FROM memory_entities
       WHERE deleted_at IS NULL
         AND type = ?
         AND aliases LIKE ?
       LIMIT 32`,
    input.type,
    `%${jsonLikeEscape(canonical)}%`,
  );
  for (const row of candidates) {
    const aliases = safeParseArray<string>(row.aliases).map(normalizeName);
    if (aliases.includes(canonical)) {
      return mergeAndPersist(row, input, now);
    }
  }

  const id = newId('ent');
  const aliasesArr = uniqueAliases(input.aliases, canonical);
  db.runSync(
    `INSERT INTO memory_entities
       (id, canonical_name, type, aliases, attributes, first_seen_at, last_seen_at, deleted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, NULL)`,
    id,
    canonical,
    input.type,
    JSON.stringify(aliasesArr),
    JSON.stringify(input.attributes ?? {}),
    now,
    now,
  );
  return {
    id,
    canonicalName: canonical,
    type: input.type,
    aliases: aliasesArr,
    attributes: input.attributes ?? {},
    firstSeenAt: now,
    lastSeenAt: now,
    deletedAt: null,
  };
}

function mergeAndPersist(
  existing: EntityRow,
  input: UpsertEntityInput,
  now: number,
): MemoryEntity {
  const db = getMemoryDb();
  const prevAliases = safeParseArray<string>(existing.aliases);
  const prevAttrs = safeParseObject(existing.attributes);
  const mergedAliases = uniqueAliases(
    [...prevAliases, ...(input.aliases ?? []), normalizeName(input.name)],
    existing.canonical_name,
  );
  const mergedAttrs = { ...prevAttrs, ...(input.attributes ?? {}) };
  db.runSync(
    `UPDATE memory_entities
       SET aliases = ?, attributes = ?, last_seen_at = ?
       WHERE id = ?`,
    JSON.stringify(mergedAliases),
    JSON.stringify(mergedAttrs),
    now,
    existing.id,
  );
  return {
    id: existing.id,
    canonicalName: existing.canonical_name,
    type: existing.type as EntityType,
    aliases: mergedAliases,
    attributes: mergedAttrs,
    firstSeenAt: existing.first_seen_at,
    lastSeenAt: now,
    deletedAt: null,
  };
}

export function getEntityById(id: string): MemoryEntity | null {
  ensureFactSchema();
  const row = getMemoryDb().getFirstSync<EntityRow>(
    `SELECT * FROM memory_entities WHERE id = ? LIMIT 1`,
    id,
  );
  return row ? rowToEntity(row) : null;
}

export function findEntityByName(name: string, type?: EntityType): MemoryEntity | null {
  ensureFactSchema();
  const canonical = normalizeName(name);
  const db = getMemoryDb();
  const row = type
    ? db.getFirstSync<EntityRow>(
        `SELECT * FROM memory_entities
           WHERE canonical_name = ? AND type = ? AND deleted_at IS NULL
           LIMIT 1`,
        canonical,
        type,
      )
    : db.getFirstSync<EntityRow>(
        `SELECT * FROM memory_entities
           WHERE canonical_name = ? AND deleted_at IS NULL
           LIMIT 1`,
        canonical,
      );
  return row ? rowToEntity(row) : null;
}

export function softDeleteEntity(id: string, now = Date.now()): boolean {
  ensureFactSchema();
  const result = getMemoryDb().runSync(
    `UPDATE memory_entities SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL`,
    now,
    id,
  );
  return (result.changes ?? 0) > 0;
}
