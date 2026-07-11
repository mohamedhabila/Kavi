import type * as SQLite from 'expo-sqlite';
import { getExecutionJournalDb } from './database';
import {
  requestDurableRecoveryCancellation,
  type RequestDurableRecoveryCancellationResult,
} from './durableRecoveryCancellation';
import { queryExecutionRecovery, type ExecutionRecoveryQueryResult } from './recoveryQuery';

const OWNER_RECOVERY_PAGE_SIZE = 25;
const MAX_OWNER_RECOVERY_PAGE_SIZE = 100;
const MAX_GENERATION_RACE_ATTEMPTS = 3;
const MAX_OWNER_RESCAN_PASSES = 3;

interface OwnedRecoveryRow {
  id: string;
}

export interface ListOwnedExternalRecoveryRunsInput {
  conversationId: string;
  ownerRunId: string;
  limit: number;
  after?: string;
}

export type ListOwnedExternalRecoveryRunsResult =
  | { kind: 'runs'; runIds: string[]; nextAfter: string | null }
  | { kind: 'blocked'; reason: 'invalid_request' | 'journal_unavailable' };

export interface OwnedExternalRecoveryCancellationIssue {
  kind: 'blocked' | 'deferred';
  reason: string;
  count: number;
}

export interface CancelOwnedExternalRecoveriesResult {
  cancelledRunCount: number;
  settledRunCount: number;
  issues: OwnedExternalRecoveryCancellationIssue[];
}

export interface CancelOwnedExternalRecoveriesInput {
  conversationId: string;
  ownerRunId: string;
  reason: string;
}

export interface ForegroundExternalRecoveryCancellationDependencies {
  listOwned(input: ListOwnedExternalRecoveryRunsInput): ListOwnedExternalRecoveryRunsResult;
  query(input: { runId: string }): Promise<ExecutionRecoveryQueryResult>;
  cancel(input: {
    runId: string;
    expectedGeneration: Extract<
      ExecutionRecoveryQueryResult,
      { kind: 'recovery_plan' }
    >['generation'];
    occurredAt: number;
    reason: string;
  }): Promise<RequestDurableRecoveryCancellationResult>;
  now(): number;
  yieldToRuntime(): Promise<void>;
}

const DEFAULT_DEPENDENCIES: ForegroundExternalRecoveryCancellationDependencies = {
  listOwned: listOwnedExternalRecoveryRuns,
  query: queryExecutionRecovery,
  cancel: requestDurableRecoveryCancellation,
  now: Date.now,
  yieldToRuntime: () => new Promise((resolve) => setTimeout(resolve, 0)),
};

function validId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value === value.trim() &&
    value.length >= 1 &&
    value.length <= 200 &&
    !/[\u0000-\u001f\u007f]/u.test(value)
  );
}

function validListInput(value: unknown): value is ListOwnedExternalRecoveryRunsInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const input = value as Record<string, unknown>;
  const keys = Object.keys(input).sort().join(',');
  return (
    (keys === 'conversationId,limit,ownerRunId' ||
      keys === 'after,conversationId,limit,ownerRunId') &&
    validId(input.conversationId) &&
    validId(input.ownerRunId) &&
    Number.isSafeInteger(input.limit) &&
    (input.limit as number) >= 1 &&
    (input.limit as number) <= MAX_OWNER_RECOVERY_PAGE_SIZE &&
    (input.after === undefined || validId(input.after))
  );
}

function decodeOwnedRows(rows: unknown[]): OwnedRecoveryRow[] | null {
  const decoded: OwnedRecoveryRow[] = [];
  for (const value of rows) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const row = value as Record<string, unknown>;
    if (Object.keys(row).join(',') !== 'id' || !validId(row.id)) return null;
    decoded.push({ id: row.id });
  }
  return decoded;
}

/** Bounded indexed lookup for nonterminal recovery runs owned by one visible agent run. */
export function listOwnedExternalRecoveryRuns(
  input: ListOwnedExternalRecoveryRunsInput,
  getDatabase: () => SQLite.SQLiteDatabase = getExecutionJournalDb,
): ListOwnedExternalRecoveryRunsResult {
  if (!validListInput(input)) return { kind: 'blocked', reason: 'invalid_request' };
  try {
    const database = getDatabase();
    const selection = `SELECT r.id
       FROM execution_runs r
       JOIN execution_recovery_controls c ON c.run_id = r.id
       WHERE r.conversation_id = ?
         AND r.task_id = ?
         AND r.durability_class = 'external_durable_operation'
         AND r.status NOT IN ('succeeded', 'failed', 'cancelled')
         AND c.cancellation_state = 'active'`;
    const rows = decodeOwnedRows(
      input.after === undefined
        ? database.getAllSync<unknown>(
            `${selection}
             ORDER BY r.id ASC
             LIMIT ?`,
            input.conversationId,
            input.ownerRunId,
            input.limit + 1,
          )
        : database.getAllSync<unknown>(
            `${selection}
               AND r.id > ?
             ORDER BY r.id ASC
             LIMIT ?`,
            input.conversationId,
            input.ownerRunId,
            input.after,
            input.limit + 1,
          ),
    );
    if (!rows) return { kind: 'blocked', reason: 'journal_unavailable' };
    const page = rows.slice(0, input.limit);
    return {
      kind: 'runs',
      runIds: page.map((row) => row.id),
      nextAfter: rows.length > input.limit ? (page.at(-1)?.id ?? null) : null,
    };
  } catch {
    return { kind: 'blocked', reason: 'journal_unavailable' };
  }
}

function cancellationTime(now: number, generationUpdatedAt: number): number | null {
  if (!Number.isSafeInteger(now) || now < 0 || generationUpdatedAt >= Number.MAX_SAFE_INTEGER) {
    return null;
  }
  return Math.max(now, generationUpdatedAt + 1);
}

function addIssue(
  issues: Map<string, Omit<OwnedExternalRecoveryCancellationIssue, 'count'>>,
  identity: string,
  kind: OwnedExternalRecoveryCancellationIssue['kind'],
  reason: string,
): void {
  issues.set(identity, { kind, reason });
}

function summarizeIssues(
  issues: Map<string, Omit<OwnedExternalRecoveryCancellationIssue, 'count'>>,
): OwnedExternalRecoveryCancellationIssue[] {
  const summary = new Map<string, OwnedExternalRecoveryCancellationIssue>();
  for (const issue of issues.values()) {
    const key = `${issue.kind}:${issue.reason}`;
    const current = summary.get(key);
    summary.set(key, { ...issue, count: (current?.count ?? 0) + 1 });
  }
  return [...summary.values()];
}

async function cancelExactOwnedRun(
  runId: string,
  reason: string,
  dependencies: ForegroundExternalRecoveryCancellationDependencies,
): Promise<{ kind: 'cancelled' | 'settled' } | { kind: 'blocked' | 'deferred'; reason: string }> {
  for (let attempt = 0; attempt < MAX_GENERATION_RACE_ATTEMPTS; attempt += 1) {
    let query: ExecutionRecoveryQueryResult;
    try {
      query = await dependencies.query({ runId });
    } catch {
      return { kind: 'deferred', reason: 'journal_unavailable' };
    }
    if (query.kind === 'query_blocked') {
      if (query.reason === 'run_unavailable') return { kind: 'settled' };
      return {
        kind: query.reason === 'journal_unavailable' ? 'deferred' : 'blocked',
        reason: query.reason,
      };
    }
    const occurredAt = cancellationTime(dependencies.now(), query.generation.updatedAt);
    if (occurredAt === null) return { kind: 'blocked', reason: 'timestamp_exhausted' };
    let cancellation: RequestDurableRecoveryCancellationResult;
    try {
      cancellation = await dependencies.cancel({
        runId,
        expectedGeneration: query.generation,
        occurredAt,
        reason,
      });
    } catch {
      return { kind: 'deferred', reason: 'journal_unavailable' };
    }
    if (cancellation.kind === 'requested') {
      if (cancellation.native.kind === 'blocked' || cancellation.native.kind === 'deferred') {
        return { kind: cancellation.native.kind, reason: cancellation.native.reason };
      }
      return { kind: 'cancelled' };
    }
    if (cancellation.reason === 'generation_changed') continue;
    return {
      kind: cancellation.reason === 'journal_unavailable' ? 'deferred' : 'blocked',
      reason: cancellation.reason,
    };
  }
  return { kind: 'blocked', reason: 'generation_race_exhausted' };
}

/**
 * Cancels every persisted recovery owned by one foreground run. Each scan and native operation is
 * bounded; a final rescan catches rows committed while the foreground owner was being aborted.
 */
export async function cancelOwnedExternalRecoveries(
  input: CancelOwnedExternalRecoveriesInput,
  dependencies: ForegroundExternalRecoveryCancellationDependencies = DEFAULT_DEPENDENCIES,
): Promise<CancelOwnedExternalRecoveriesResult> {
  const issues = new Map<string, Omit<OwnedExternalRecoveryCancellationIssue, 'count'>>();
  let cancelledRunCount = 0;
  let settledRunCount = 0;

  if (
    !validId(input.conversationId) ||
    !validId(input.ownerRunId) ||
    typeof input.reason !== 'string' ||
    input.reason.trim().length === 0
  ) {
    addIssue(issues, 'request', 'blocked', 'invalid_request');
    return { cancelledRunCount, settledRunCount, issues: summarizeIssues(issues) };
  }

  for (let pass = 0; pass < MAX_OWNER_RESCAN_PASSES; pass += 1) {
    let after: string | undefined;
    let sawRun = false;
    do {
      const page = dependencies.listOwned({
        conversationId: input.conversationId,
        ownerRunId: input.ownerRunId,
        limit: OWNER_RECOVERY_PAGE_SIZE,
        ...(after === undefined ? {} : { after }),
      });
      if (page.kind === 'blocked') {
        addIssue(
          issues,
          'owner_lookup',
          page.reason === 'journal_unavailable' ? 'deferred' : 'blocked',
          page.reason,
        );
        return { cancelledRunCount, settledRunCount, issues: summarizeIssues(issues) };
      }
      sawRun ||= page.runIds.length > 0;
      for (const runId of page.runIds) {
        const outcome = await cancelExactOwnedRun(runId, input.reason, dependencies);
        switch (outcome.kind) {
          case 'cancelled':
            cancelledRunCount += 1;
            issues.delete(runId);
            break;
          case 'settled':
            settledRunCount += 1;
            issues.delete(runId);
            break;
          case 'blocked':
          case 'deferred':
            addIssue(issues, runId, outcome.kind, outcome.reason);
            break;
        }
      }
      after = page.nextAfter ?? undefined;
      if (after !== undefined) await dependencies.yieldToRuntime();
    } while (after !== undefined);

    if (!sawRun) {
      return { cancelledRunCount, settledRunCount, issues: summarizeIssues(issues) };
    }
    await dependencies.yieldToRuntime();
  }

  const remaining = dependencies.listOwned({
    conversationId: input.conversationId,
    ownerRunId: input.ownerRunId,
    limit: 1,
  });
  if (remaining.kind === 'blocked') {
    addIssue(
      issues,
      'owner_lookup',
      remaining.reason === 'journal_unavailable' ? 'deferred' : 'blocked',
      remaining.reason,
    );
  } else if (remaining.runIds.length > 0) {
    addIssue(issues, 'owner_scan', 'blocked', 'owner_scan_race_exhausted');
  }
  return { cancelledRunCount, settledRunCount, issues: summarizeIssues(issues) };
}
