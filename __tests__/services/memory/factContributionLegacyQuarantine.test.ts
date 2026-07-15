import type { getMemoryDb } from '../../../src/services/memory/database';
import { quarantineLegacyFacts } from '../../../src/services/memory/factContributionLegacyQuarantine';
import type { FactRow } from '../../../src/services/memory/facts/types';

type MemoryDb = ReturnType<typeof getMemoryDb>;

describe('legacy fact quarantine scaling', () => {
  it('scans each history surface once and deletes immutable receipt rows', () => {
    const retrievalRows = Array.from({ length: 10_000 }, (_, index) => ({
      id: `retrieval-${index}`,
      selected_fact_ids_json: JSON.stringify([`rejected-fact-${index % 1_000}`]),
    }));
    const reflectionRows = Array.from({ length: 10_000 }, (_, index) => ({
      id: `reflection-${index}`,
      source_fact_ids_json: JSON.stringify([`rejected-fact-${index % 1_000}`]),
    }));
    const receiptRows = Array.from({ length: 10_000 }, (_, index) => ({
      job_id: `job-${index}`,
      attempt_number: 1,
      deterministic_fact_ids_json: JSON.stringify([`rejected-fact-${index % 1_000}`]),
      provider_fact_ids_json: '[]',
      invalidated_fact_ids_json: '[]',
      bridged_evidence_fact_ids_json: '[]',
      agent_run_memory_fact_ids_json: '[]',
    }));
    const getAllSync = jest.fn((sql: string) => {
      if (sql.includes('memory_retrieval_events')) return retrievalRows;
      if (sql.includes('memory_reflections')) return reflectionRows;
      if (sql.includes('memory_ingestion_structural_receipts')) return receiptRows;
      if (sql.includes('memory_ingestion_receipts')) return receiptRows;
      throw new Error(`unexpected query: ${sql}`);
    });
    const runSync = jest.fn();
    const execSync = jest.fn();
    const db = { execSync, getAllSync, runSync } as unknown as MemoryDb;
    const entries = Array.from({ length: 1_000 }, (_, index) => ({
      row: { id: `rejected-fact-${index}` } as FactRow,
      reason: 'source_scope_unproven' as const,
    }));

    quarantineLegacyFacts({ db, entries, quarantinedAt: 500 });

    expect(getAllSync).toHaveBeenCalledTimes(4);
    expect(execSync).toHaveBeenCalledTimes(2);
    expect(runSync.mock.calls.length).toBeLessThan(200);
    const mutationSql = runSync.mock.calls.map(([sql]) => String(sql)).join('\n');
    expect(mutationSql).toContain('DELETE FROM memory_ingestion_receipts');
    expect(mutationSql).toContain('DELETE FROM memory_ingestion_structural_receipts');
    expect(mutationSql).not.toContain('UPDATE memory_ingestion_receipts');
    expect(mutationSql).not.toContain('UPDATE memory_ingestion_structural_receipts');
  });
});
