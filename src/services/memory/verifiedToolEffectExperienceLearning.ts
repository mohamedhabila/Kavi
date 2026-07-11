import { buildExperienceLearningArtifact, type LearnedExperienceRecord } from './experienceLearningArtifact';
import { getSchemaReadyMemoryDb } from './access/schemaGuard';
import { getLocalMemoryVaultOwnerId } from './memoryVaultIdentity';
import {
  captureMemoryReadEpoch,
  isMemoryReadEpochCurrent,
} from './policy';
import { isCodeOwnedProductExperienceId } from './productExperienceObservationStore';
import {
  resolveVerifiedToolEffectExperienceScopes,
  type VerifiedToolEffectExperienceScope,
} from './verifiedToolEffectExperience';

export const PRODUCT_EXPERIENCE_READ_ROW_LIMIT = 512;
export const PRODUCT_EXPERIENCE_CURRENT_TOOL_LIMIT = 16;
export const PRODUCT_EXPERIENCE_LEARNING_LIMIT = 3;

const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const MAX_PRECONDITION_COUNT = 16;

type ProductExperienceLearningRow = Readonly<{
  source_run_id_hash: string;
  domain_id: string;
  environment_id: string;
  procedure_id: string;
  precondition_ids_json: string;
  outcome: string;
  authority: string;
  observed_at: number;
}>;

export type VerifiedToolEffectExperienceLearning = Readonly<{
  scope: VerifiedToolEffectExperienceScope;
  record: LearnedExperienceRecord;
}>;

export type VerifiedToolEffectExperienceLearningRead = Readonly<{
  readEpoch?: number;
  learnings: ReadonlyArray<VerifiedToolEffectExperienceLearning>;
}>;

const EMPTY_READ: VerifiedToolEffectExperienceLearningRead = Object.freeze({ learnings: [] });

function exactSortedPreconditions(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length > MAX_PRECONDITION_COUNT) return null;
  if (!value.every(isCodeOwnedProductExperienceId)) return null;
  const concrete = value as string[];
  if (
    concrete.some((item, index) => index > 0 && concrete[index - 1]! >= item)
  ) {
    return null;
  }
  return [...concrete];
}

function decodePreconditions(value: unknown): string[] | null {
  if (typeof value !== 'string' || value.length < 2 || value.length > 4_096) return null;
  try {
    return exactSortedPreconditions(JSON.parse(value));
  } catch {
    return null;
  }
}

function scopeKey(scope: Pick<
  VerifiedToolEffectExperienceScope,
  'domainId' | 'environmentId' | 'procedureId' | 'preconditionIds'
>): string {
  return JSON.stringify([
    scope.domainId,
    scope.environmentId,
    scope.procedureId,
    scope.preconditionIds,
  ]);
}

function observationFromRow(
  row: ProductExperienceLearningRow,
  allowedScopeKeys: ReadonlySet<string>,
): Parameters<typeof buildExperienceLearningArtifact>[0][number] | null {
  const preconditionIds = decodePreconditions(row.precondition_ids_json);
  if (
    !SHA256_PATTERN.test(row.source_run_id_hash) ||
    !isCodeOwnedProductExperienceId(row.domain_id) ||
    !isCodeOwnedProductExperienceId(row.environment_id) ||
    !isCodeOwnedProductExperienceId(row.procedure_id) ||
    !preconditionIds ||
    (row.outcome !== 'success' && row.outcome !== 'failure') ||
    (row.authority !== 'tool_observed' && row.authority !== 'verified') ||
    !Number.isSafeInteger(row.observed_at) ||
    row.observed_at < 0
  ) {
    return null;
  }
  const exactScopeKey = scopeKey({
    domainId: row.domain_id,
    environmentId: row.environment_id,
    procedureId: row.procedure_id,
    preconditionIds,
  });
  if (!allowedScopeKeys.has(exactScopeKey)) return null;
  return {
    runId: row.source_run_id_hash,
    domainId: row.domain_id,
    environmentId: row.environment_id,
    procedureId: row.procedure_id,
    preconditionIds,
    outcome: row.outcome,
    authority: row.authority,
    // Confidence is derived only from the code-owned observation authority;
    // no model-authored score or payload content is admitted.
    confidence: row.authority === 'verified' ? 1 : 0.9,
    observedAt: row.observed_at,
  };
}

async function resolveCurrentScopes(
  toolNames: ReadonlyArray<string>,
  readEpoch: number,
): Promise<VerifiedToolEffectExperienceScope[] | null> {
  const uniqueToolNames = Array.from(new Set(toolNames))
    .filter(isCodeOwnedProductExperienceId)
    .sort()
    .slice(0, PRODUCT_EXPERIENCE_CURRENT_TOOL_LIMIT);
  const scopesByKey = new Map<string, VerifiedToolEffectExperienceScope>();
  for (const toolName of uniqueToolNames) {
    if (!isMemoryReadEpochCurrent(readEpoch)) return null;
    const resolved = await resolveVerifiedToolEffectExperienceScopes(toolName);
    if (!isMemoryReadEpochCurrent(readEpoch)) return null;
    for (const scope of resolved) {
      const key = scopeKey(scope);
      const prior = scopesByKey.get(key);
      if (prior && prior.toolName !== scope.toolName) return null;
      scopesByKey.set(key, scope);
    }
  }
  return Array.from(scopesByKey.values());
}

function exactScopeSql(scopes: ReadonlyArray<VerifiedToolEffectExperienceScope>): {
  clause: string;
  values: string[];
} {
  const clauses: string[] = [];
  const values: string[] = [];
  for (const scope of scopes) {
    clauses.push(
      '(domain_id = ? AND environment_id = ? AND procedure_id = ? AND precondition_ids_json = ?)',
    );
    values.push(
      scope.domainId,
      scope.environmentId,
      scope.procedureId,
      JSON.stringify(scope.preconditionIds),
    );
  }
  return { clause: clauses.join(' OR '), values };
}

/**
 * Reads only the bounded, content-free observation columns needed by the
 * existing corroboration policy. Relevance comes from the graph's grounded
 * current tool surface and every returned record must match its exact current
 * platform, tool, effect contract, and recorded precondition set.
 */
export async function readVerifiedToolEffectExperienceLearnings(
  currentToolNames: ReadonlyArray<string>,
): Promise<VerifiedToolEffectExperienceLearningRead> {
  const readEpoch = captureMemoryReadEpoch();
  if (readEpoch === null || !isMemoryReadEpochCurrent(readEpoch)) return EMPTY_READ;

  try {
    const scopes = await resolveCurrentScopes(currentToolNames, readEpoch);
    if (!scopes?.length || !isMemoryReadEpochCurrent(readEpoch)) return EMPTY_READ;

    const allowedScopeKeys = new Set(scopes.map(scopeKey));
    const scopeSql = exactScopeSql(scopes);
    if (!isMemoryReadEpochCurrent(readEpoch)) return EMPTY_READ;
    const db = getSchemaReadyMemoryDb();
    if (!isMemoryReadEpochCurrent(readEpoch)) return EMPTY_READ;
    const memoryOwnerId = getLocalMemoryVaultOwnerId(db);
    if (!isMemoryReadEpochCurrent(readEpoch)) return EMPTY_READ;
    const rows = db.getAllSync<ProductExperienceLearningRow>(
      `SELECT source_run_id_hash, domain_id, environment_id, procedure_id,
              precondition_ids_json, outcome, authority, observed_at
         FROM memory_product_experience_observations
        WHERE memory_owner_id = ?
          AND (${scopeSql.clause})
        ORDER BY observed_at DESC, id DESC
        LIMIT ?`,
      memoryOwnerId,
      ...scopeSql.values,
      PRODUCT_EXPERIENCE_READ_ROW_LIMIT,
    );
    if (!isMemoryReadEpochCurrent(readEpoch)) return EMPTY_READ;

    const observations = rows
      .map((row) => observationFromRow(row, allowedScopeKeys))
      .filter((row): row is NonNullable<typeof row> => row !== null);
    const artifact = buildExperienceLearningArtifact(observations).artifact;
    if (!isMemoryReadEpochCurrent(readEpoch)) return EMPTY_READ;

    const scopesByKey = new Map(scopes.map((scope) => [scopeKey(scope), scope]));
    const learnings = artifact.records
      .map((record) => {
        const scope = scopesByKey.get(scopeKey(record));
        return scope ? { scope, record } : null;
      })
      .filter((value): value is VerifiedToolEffectExperienceLearning => value !== null)
      .sort((left, right) => {
        const supportDelta =
          right.record.evidence.runIds.length - left.record.evidence.runIds.length;
        if (supportDelta !== 0) return supportDelta;
        if (right.record.confidence !== left.record.confidence) {
          return right.record.confidence - left.record.confidence;
        }
        return left.record.id.localeCompare(right.record.id);
      })
      .slice(0, PRODUCT_EXPERIENCE_LEARNING_LIMIT);
    if (!learnings.length || !isMemoryReadEpochCurrent(readEpoch)) return EMPTY_READ;
    return { readEpoch, learnings };
  } catch {
    return EMPTY_READ;
  }
}
