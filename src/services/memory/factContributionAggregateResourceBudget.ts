import { MEMORY_FACT_CONTRIBUTION_LIMITS } from './factContributionCodec';
import type { RawContributionEvidenceBudgetRow } from './factContributionAggregateQueries';
import { isExactMemoryProvenanceId } from './memoryProvenanceIdentity';

export const VERIFIED_FACT_CONTRIBUTION_LOAD_LIMITS = Object.freeze({
  parents: 128,
  payloadBytes: 8 * 1024 * 1024,
  evidenceTextBytes: 8 * 1024 * 1024,
  factPredicateBytes: 512,
  factObjectTextBytes: MEMORY_FACT_CONTRIBUTION_LIMITS.textBytes,
  classifierTextBytes: MEMORY_FACT_CONTRIBUTION_LIMITS.textBytes,
  predecessorPredicateBytes: 512,
  sourceChildren: 4_096,
  supersessionChildren: 8_192,
});

function fail(code = 'memory_fact_contribution_aggregate_integrity_invalid'): never {
  throw new Error(code);
}

function requireTimestamp(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) return fail();
  return value as number;
}

/** Reject corrupt or legacy oversized evidence before full text crosses the SQLite bridge. */
export function assertFactContributionEvidenceResourceBudget(
  rows: ReadonlyArray<RawContributionEvidenceBudgetRow>,
  maximumRows: number,
): void {
  if (rows.length > maximumRows) fail('memory_fact_contribution_aggregate_resource_limit');
  const seen = new Set<string>();
  let totalBytes = 0;
  for (const row of rows) {
    const kind = row.evidence_kind;
    if (kind !== 'fact' && kind !== 'predecessor') return fail();
    if (!isExactMemoryProvenanceId(row.evidence_id)) return fail();
    const key = `${kind}\u0000${row.evidence_id}`;
    if (seen.has(key)) return fail();
    seen.add(key);
    const predicateBytes = requireTimestamp(row.predicate_byte_length);
    const objectTextBytes = requireTimestamp(row.object_text_byte_length);
    const subjectNameBytes = requireTimestamp(row.subject_name_byte_length);
    const subjectTypeBytes = requireTimestamp(row.subject_type_byte_length);
    if (
      predicateBytes >
        (kind === 'fact'
          ? VERIFIED_FACT_CONTRIBUTION_LOAD_LIMITS.factPredicateBytes
          : VERIFIED_FACT_CONTRIBUTION_LOAD_LIMITS.predecessorPredicateBytes) ||
      objectTextBytes >
        (kind === 'fact' ? VERIFIED_FACT_CONTRIBUTION_LOAD_LIMITS.factObjectTextBytes : 0) ||
      subjectNameBytes >
        (kind === 'fact' ? VERIFIED_FACT_CONTRIBUTION_LOAD_LIMITS.classifierTextBytes : 0) ||
      subjectTypeBytes >
        (kind === 'fact' ? VERIFIED_FACT_CONTRIBUTION_LOAD_LIMITS.classifierTextBytes : 0)
    ) {
      fail('memory_fact_contribution_aggregate_resource_limit');
    }
    totalBytes += predicateBytes + objectTextBytes + subjectNameBytes + subjectTypeBytes;
    if (totalBytes > VERIFIED_FACT_CONTRIBUTION_LOAD_LIMITS.evidenceTextBytes) {
      fail('memory_fact_contribution_aggregate_resource_limit');
    }
  }
}
