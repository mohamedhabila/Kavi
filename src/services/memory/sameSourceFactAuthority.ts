import { getSchemaReadyMemoryDb } from './access/schemaGuard';
import { MEMORY_REMEMBER_FACT_PRODUCER_ID } from './memoryRememberContributionIdentity';
import { getLocalMemoryVaultOwnerId } from './memoryVaultIdentity';
import { isExactMemoryProvenanceId } from './memoryProvenanceIdentity';

/**
 * An explicit memory tool write owns semantic extraction for its exact user
 * source. Passive enrichment may still summarize the turn, but it must not
 * create a second independently-shaped fact set for the same evidence.
 */
export function hasSameSourceExplicitMemoryAuthority(input: { sourceMessageId: string }): boolean {
  if (!isExactMemoryProvenanceId(input.sourceMessageId)) {
    throw new Error('memory_same_source_authority_message_invalid');
  }

  const db = getSchemaReadyMemoryDb();
  const memoryOwnerId = getLocalMemoryVaultOwnerId(db);
  const row = db.getFirstSync<{ present: number }>(
    `SELECT 1 AS present
      FROM memory_fact_contributions AS contribution
       JOIN memory_fact_contribution_sources AS source
         ON source.contribution_id = contribution.id
      WHERE contribution.memory_owner_id = ?
        AND contribution.producer_id = ?
        AND source.memory_owner_id = contribution.memory_owner_id
        AND source.source_kind = 'message'
        AND source.source_id = ?
      LIMIT 1`,
    memoryOwnerId,
    MEMORY_REMEMBER_FACT_PRODUCER_ID,
    input.sourceMessageId,
  );
  return row?.present === 1;
}
