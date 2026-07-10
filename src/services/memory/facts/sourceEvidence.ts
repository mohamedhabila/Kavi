import { getSchemaReadyMemoryDb } from '../access/schemaGuard';

export function hasPersistedSourceEvidence(
  factId: string,
  sourceMessageId: string | null | undefined,
): boolean {
  const messageId = sourceMessageId?.trim();
  if (!messageId) return false;
  return Boolean(
    getSchemaReadyMemoryDb().getFirstSync<{ present: number }>(
      `SELECT 1 AS present
         FROM memory_fact_evidence
        WHERE fact_id = ? AND message_id = ?
        LIMIT 1`,
      factId,
      messageId,
    ),
  );
}
