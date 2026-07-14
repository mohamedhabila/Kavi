import {
  normalizeMemoryFactContributionSourceAliases,
  type MemoryFactContributionSourceAlias,
} from './factContributionCodec';
import {
  buildFactContributionSourceChildCommitment,
  buildFactContributionSupersessionChildCommitment,
  type FactContributionSupersessionEdgeCommitmentRow,
  type FactContributionSupersessionSnapshotCommitmentRow,
  type MemoryFactContributionChildCommitment,
} from './factContributionChildCommitments';

interface ContributionCommitmentParentRow {
  id: string;
  memory_owner_id: string;
  memory_conversation_id: string;
  source_thread_id: string;
  task_id: string;
  source_set_version: unknown;
  source_set_count: unknown;
  source_set_sha256: unknown;
  supersession_set_version: unknown;
  supersession_set_count: unknown;
  supersession_set_sha256: unknown;
}

export interface FactContributionAdmissionSourceRow {
  contribution_id: string;
  memory_owner_id: string;
  memory_conversation_id: string;
  source_thread_id: string;
  task_id: string;
  source_kind: string;
  source_id: string;
}

export type FactContributionAdmissionSupersessionRow =
  FactContributionSupersessionEdgeCommitmentRow;
export type FactContributionAdmissionSupersessionSnapshotRow =
  FactContributionSupersessionSnapshotCommitmentRow;

function fail(): never {
  throw new Error('memory_fact_contribution_admission_integrity_invalid');
}

function exactSourceRows(
  rows: ReadonlyArray<FactContributionAdmissionSourceRow>,
  contribution: ContributionCommitmentParentRow,
): MemoryFactContributionSourceAlias[] {
  if (
    rows.some(
      (row) =>
        row.memory_owner_id !== contribution.memory_owner_id ||
        row.memory_conversation_id !== contribution.memory_conversation_id ||
        row.source_thread_id !== contribution.source_thread_id ||
        row.task_id !== contribution.task_id ||
        (row.source_kind !== 'message' && row.source_kind !== 'turn' && row.source_kind !== 'run'),
    )
  ) {
    return fail();
  }
  return normalizeMemoryFactContributionSourceAliases(
    rows.map((row) => ({
      sourceKind: row.source_kind as MemoryFactContributionSourceAlias['sourceKind'],
      sourceId: row.source_id,
    })),
  );
}

function assertChildCommitmentMatches(
  actual: { version: unknown; count: unknown; sha256: unknown },
  expected: MemoryFactContributionChildCommitment,
): void {
  if (
    actual.version !== expected.version ||
    actual.count !== expected.count ||
    actual.sha256 !== expected.sha256
  ) {
    fail();
  }
}

export function assertFactContributionSourceChildCommitment(
  contribution: ContributionCommitmentParentRow,
  sourceRows: ReadonlyArray<FactContributionAdmissionSourceRow>,
): MemoryFactContributionSourceAlias[] {
  const aliases = exactSourceRows(sourceRows, contribution);
  const expected = buildFactContributionSourceChildCommitment({
    contributionId: contribution.id,
    scope: {
      memoryOwnerId: contribution.memory_owner_id,
      memoryConversationId: contribution.memory_conversation_id,
      sourceThreadId: contribution.source_thread_id,
      taskId: contribution.task_id,
    },
    sourceAliases: aliases,
  });
  assertChildCommitmentMatches(
    {
      version: contribution.source_set_version,
      count: contribution.source_set_count,
      sha256: contribution.source_set_sha256,
    },
    expected,
  );
  return aliases;
}

export function assertFactContributionSupersessionChildCommitment(
  contribution: ContributionCommitmentParentRow,
  snapshot: FactContributionAdmissionSupersessionSnapshotRow | null,
  edges: ReadonlyArray<FactContributionAdmissionSupersessionRow>,
): void {
  const expected = buildFactContributionSupersessionChildCommitment({
    contributionId: contribution.id,
    snapshot: snapshot ? { ...snapshot } : null,
    edges: edges.map((edge) => ({ ...edge })),
  });
  assertChildCommitmentMatches(
    {
      version: contribution.supersession_set_version,
      count: contribution.supersession_set_count,
      sha256: contribution.supersession_set_sha256,
    },
    expected,
  );
}
