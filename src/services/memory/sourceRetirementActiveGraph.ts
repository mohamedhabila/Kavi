import type { MemoryDatabase } from './access/schemaGuard';
import { loadVerifiedFactContributionAggregatesInTransaction } from './factContributionAggregateStore';
import type { VerifiedFactContributionAggregate } from './factContributionAggregateTypes';
import { MEMORY_SOURCE_RETIREMENT_PLAN_LIMITS } from './sourceRetirementPlan';
import {
  compareSourceRetirementOrdinal,
  sourceRetirementIdentityKey,
} from './sourceRetirementPlanningGraph';
import type { PersistedExactMemorySourceIdentity } from './exactMemorySourceIdentity';

const ACTIVE_GRAPH_PAGE_SIZE = 128;
const SOURCE_PROBE_PAGE_SIZE = 128;

interface ActiveContributionIdRow {
  id: string;
}

function fail(code: string): never {
  throw new Error(code);
}

/** Discover every active local contribution before loading its committed evidence. */
export function loadCompleteActiveRetirementGraphInTransaction(
  db: MemoryDatabase,
  localOwnerId: string,
): ReadonlyArray<Readonly<VerifiedFactContributionAggregate>> {
  const maximum = MEMORY_SOURCE_RETIREMENT_PLAN_LIMITS.activeAggregates;
  const rows = db.getAllSync<ActiveContributionIdRow>(
    `SELECT contribution.id
       FROM memory_fact_contributions AS contribution
       LEFT JOIN memory_retired_fact_contributions AS retired
         ON retired.contribution_id = contribution.id
      WHERE contribution.memory_owner_id = ?
        AND retired.contribution_id IS NULL
      ORDER BY contribution.id ASC
      LIMIT ${maximum + 1}`,
    localOwnerId,
  );
  if (rows.length > maximum) fail('memory_source_retirement_plan_resource_limit');
  const ids = rows.map((row) => row.id);
  if (new Set(ids).size !== ids.length) {
    fail('memory_source_retirement_active_graph_invalid');
  }
  const aggregates: Readonly<VerifiedFactContributionAggregate>[] = [];
  const factIds = new Set<string>();
  let payloadBytes = 0;
  let sourceAliases = 0;
  let supersessionEdges = 0;
  for (let offset = 0; offset < ids.length; offset += ACTIVE_GRAPH_PAGE_SIZE) {
    const page = ids.slice(offset, offset + ACTIVE_GRAPH_PAGE_SIZE);
    const loaded = loadVerifiedFactContributionAggregatesInTransaction(db, page);
    if (loaded.missingContributionIds.length > 0 || loaded.aggregates.length !== page.length) {
      fail('memory_source_retirement_active_graph_incomplete');
    }
    for (const aggregate of loaded.aggregates) {
      const serializedPayload = JSON.stringify(aggregate.payload);
      if (typeof serializedPayload !== 'string') {
        fail('memory_source_retirement_active_graph_invalid');
      }
      factIds.add(aggregate.factId);
      payloadBytes += new TextEncoder().encode(serializedPayload).byteLength;
      sourceAliases += aggregate.sourceAliases.length;
      supersessionEdges += aggregate.supersessionPlan.edges.length;
      if (
        factIds.size > MEMORY_SOURCE_RETIREMENT_PLAN_LIMITS.facts ||
        payloadBytes > MEMORY_SOURCE_RETIREMENT_PLAN_LIMITS.payloadBytes ||
        sourceAliases > MEMORY_SOURCE_RETIREMENT_PLAN_LIMITS.sourceAliases ||
        supersessionEdges > MEMORY_SOURCE_RETIREMENT_PLAN_LIMITS.supersessionEdges
      ) {
        fail('memory_source_retirement_plan_resource_limit');
      }
    }
    aggregates.push(...loaded.aggregates);
  }
  return Object.freeze(
    aggregates.sort(
      (left, right) =>
        left.contributedAt - right.contributedAt ||
        compareSourceRetirementOrdinal(left.contributionId, right.contributionId),
    ),
  );
}

function closedSourceCte(sources: ReadonlyArray<PersistedExactMemorySourceIdentity>): string {
  return `WITH closed(
    memory_owner_id, memory_conversation_id, source_thread_id,
    task_id, source_kind, source_id
  ) AS (VALUES ${sources.map(() => '(?, ?, ?, ?, ?, ?)').join(', ')})`;
}

/** Prove that the newly sealed closure cannot still reach an active contribution. */
export function assertNoActiveContributionForClosedSourcesInTransaction(
  db: MemoryDatabase,
  sources: ReadonlyArray<Readonly<PersistedExactMemorySourceIdentity>>,
): void {
  const seen = new Set<string>();
  for (const source of sources) {
    const key = sourceRetirementIdentityKey(source);
    if (seen.has(key)) fail('memory_source_retirement_postcondition_invalid');
    seen.add(key);
  }
  for (let offset = 0; offset < sources.length; offset += SOURCE_PROBE_PAGE_SIZE) {
    const page = sources.slice(offset, offset + SOURCE_PROBE_PAGE_SIZE);
    const residual = db.getFirstSync<{ contribution_id: string }>(
      `${closedSourceCte(page)}
       SELECT source.contribution_id
         FROM closed
         JOIN memory_fact_contribution_sources AS source
           ON source.memory_owner_id = closed.memory_owner_id
          AND source.memory_conversation_id = closed.memory_conversation_id
          AND source.source_thread_id = closed.source_thread_id
          AND source.task_id = closed.task_id
          AND source.source_kind = closed.source_kind
          AND source.source_id = closed.source_id
         LEFT JOIN memory_retired_fact_contributions AS retired
           ON retired.contribution_id = source.contribution_id
        WHERE retired.contribution_id IS NULL
        LIMIT 1`,
      ...page.flatMap((source) => [
        source.memoryOwnerId,
        source.memoryConversationId,
        source.sourceThreadId,
        source.taskId,
        source.sourceKind,
        source.sourceId,
      ]),
    );
    if (residual) fail('memory_source_retirement_active_source_residual');
  }
}
