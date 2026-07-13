import type { getMemoryDb } from '../database';
import { buildFactContentHash } from '../facts/contentIdentity';
import { getLocalMemoryVaultOwnerId } from '../memoryVaultIdentity';

type MemoryDb = ReturnType<typeof getMemoryDb>;

interface FactContentIdentityRow {
  id: string;
  memory_owner_id: string | null;
  memory_kind: string | null;
  scope: string | null;
  origin_conversation_id: string | null;
  origin_thread_id: string | null;
  origin_task_id: string | null;
  persona_id: string | null;
  subject_id: string;
  predicate: string;
  object_text: string;
  object_entity_id: string | null;
}

/** Upgrade pre-v3 fact identities without changing user-visible fact text. */
export function ensureFactContentIdentityV3(db: MemoryDb): void {
  db.execSync('BEGIN IMMEDIATE TRANSACTION');
  try {
    db.runSync(
      `UPDATE memory_facts
          SET memory_owner_id = ?
        WHERE memory_owner_id IS NULL
          AND scope IN ('global', 'project', 'conversation', 'session')`,
      getLocalMemoryVaultOwnerId(db),
    );
    db.runSync(
      `UPDATE memory_facts
          SET fact_class = 'subjective_user',
              source_authority = 'assistant_inferred'
        WHERE fact_class = 'unknown'
          AND source_authority = 'unknown'
          AND memory_owner_id IS NOT NULL
          AND scope != 'persona'
          AND EXISTS (
            SELECT 1
              FROM memory_entities AS subject
             WHERE subject.id = memory_facts.subject_id
               AND subject.type = 'self'
          )`,
    );
    db.runSync(
      `UPDATE memory_facts
          SET fact_class = 'workflow',
              source_authority = 'assistant_inferred'
        WHERE fact_class = 'unknown'
          AND source_authority = 'unknown'
          AND memory_owner_id IS NOT NULL
          AND scope != 'persona'
          AND memory_kind IN (
            'episodic_event', 'goal', 'tool_result', 'decision', 'risk', 'artifact',
            'summary', 'evidence_span', 'agent_run', 'gotcha'
          )`,
    );
    const rows = db.getAllSync<FactContentIdentityRow>(
      `SELECT id, memory_owner_id, memory_kind, scope, origin_conversation_id, origin_thread_id,
              origin_task_id, persona_id, subject_id, predicate, object_text, object_entity_id
         FROM memory_facts
        WHERE SUBSTR(content_hash, 1, 3) != 'v3_'`,
    );
    for (const row of rows) {
      if (typeof row.scope !== 'string') {
        throw new Error('memory_fact_content_identity_scope_invalid');
      }
      const contentHash = buildFactContentHash({
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
      });
      db.runSync('UPDATE memory_facts SET content_hash = ? WHERE id = ?', contentHash, row.id);
    }
    db.execSync('COMMIT');
  } catch (error) {
    db.execSync('ROLLBACK');
    throw error;
  }
}
