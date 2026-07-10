import * as Crypto from 'expo-crypto';
import { isExactDurableScopeId } from '../../utils/durableScopeIdentity';
import { runMemoryTransaction } from './access/transaction';
import { getLocalMemoryVaultOwnerId } from './memoryVaultIdentity';
import { isExactMemoryProvenanceId } from './memoryProvenanceIdentity';
import { isExactMemoryScopeId } from './memoryScopeIdentity';
import {
  canWriteLongTermMemory,
  getMemoryPolicyEpoch,
  isMemoryPolicyEpochCurrent,
} from './policy';
import { ensureFactSchema } from './schema';
import { getMemoryDb } from './sqlite-store';

const PRODUCT_EXPERIENCE_CONTRACT_KEYS = [
  'authority',
  'contractVersion',
  'domainId',
  'environmentId',
  'evidenceId',
  'evidenceKind',
  'memoryConversationId',
  'observedAt',
  'outcome',
  'preconditionIds',
  'procedureId',
  'sourceRunId',
  'sourceThreadId',
] as const;
const CODE_OWNED_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/u;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const MAX_PRECONDITION_COUNT = 16;
const OBSERVATION_RETENTION_MS = 180 * 24 * 60 * 60 * 1_000;
const MAX_OBSERVATIONS_PER_EXACT_SCOPE = 64;
const MAX_OBSERVATIONS_PER_OWNER = 512;

export type ProductExperienceOutcome = 'success' | 'failure';
export type ProductExperienceAuthority = 'tool_observed' | 'verified';
export type ProductExperienceEvidenceKind =
  | 'tool_result'
  | 'effect_receipt'
  | 'runtime_verifier';

/**
 * Collection-only contract for a code-owned execution boundary. It deliberately
 * contains no user text, tool arguments, result text, or assistant summaries.
 * No prompt or planner may consume these observations until a real producer
 * supplies stable procedure and environment identities.
 */
export type ProductExperienceObservationInput = Readonly<{
  contractVersion: 1;
  memoryConversationId: string;
  sourceThreadId: string;
  sourceRunId: string;
  domainId: string;
  environmentId: string;
  procedureId: string;
  preconditionIds: ReadonlyArray<string>;
  outcome: ProductExperienceOutcome;
  authority: ProductExperienceAuthority;
  evidenceKind: ProductExperienceEvidenceKind;
  evidenceId: string;
  observedAt: number;
}>;

export type RecordProductExperienceObservationResult =
  | {
      status: 'recorded' | 'unchanged';
      observationId: string;
      prunedCount: number;
    }
  | {
      status: 'rejected';
      code: 'invalid_input' | 'conflicting_run_evidence' | 'memory_disabled';
    }
  | { status: 'failed'; code: 'hashing_error' | 'storage_error' };

type HashedObservation = Readonly<{
  id: string;
  memoryConversationIdHash: string;
  sourceThreadIdHash: string;
  sourceRunIdHash: string;
  preconditionIdsJson: string;
  preconditionIdsHash: string;
  evidenceIdHash: string;
}>;

type ProductExperienceObservationRow = {
  id: string;
  memory_owner_id: string;
  memory_conversation_id_hash: string;
  source_thread_id_hash: string;
  source_run_id_hash: string;
  domain_id: string;
  environment_id: string;
  procedure_id: string;
  precondition_ids_json: string;
  precondition_ids_hash: string;
  outcome: string;
  authority: string;
  evidence_kind: string;
  evidence_id_hash: string;
  contract_version: number;
  observed_at: number;
  created_at: number;
};

function hasExactKeys(value: object): boolean {
  const keys = Object.keys(value).sort();
  return (
    keys.length === PRODUCT_EXPERIENCE_CONTRACT_KEYS.length &&
    keys.every((key, index) => key === PRODUCT_EXPERIENCE_CONTRACT_KEYS[index])
  );
}

function isCodeOwnedId(value: unknown): value is string {
  return isExactDurableScopeId(value) && CODE_OWNED_ID_PATTERN.test(value);
}

function hasValidEvidencePair(
  authority: unknown,
  evidenceKind: unknown,
): authority is ProductExperienceAuthority {
  if (authority === 'tool_observed') {
    return evidenceKind === 'tool_result' || evidenceKind === 'effect_receipt';
  }
  if (authority === 'verified') {
    return evidenceKind === 'effect_receipt' || evidenceKind === 'runtime_verifier';
  }
  return false;
}

function isSortedUnique(values: ReadonlyArray<string>): boolean {
  return values.every((value, index) => index === 0 || values[index - 1]! < value);
}

function validInput(value: unknown, recordedAt: number): value is ProductExperienceObservationInput {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !hasExactKeys(value)) {
    return false;
  }
  const input = value as Partial<ProductExperienceObservationInput>;
  return (
    input.contractVersion === 1 &&
    isExactMemoryScopeId(input.memoryConversationId) &&
    isExactMemoryScopeId(input.sourceThreadId) &&
    isExactMemoryProvenanceId(input.sourceRunId) &&
    isCodeOwnedId(input.domainId) &&
    isCodeOwnedId(input.environmentId) &&
    isCodeOwnedId(input.procedureId) &&
    Array.isArray(input.preconditionIds) &&
    input.preconditionIds.length <= MAX_PRECONDITION_COUNT &&
    input.preconditionIds.every(isCodeOwnedId) &&
    isSortedUnique(input.preconditionIds) &&
    (input.outcome === 'success' || input.outcome === 'failure') &&
    hasValidEvidencePair(input.authority, input.evidenceKind) &&
    isExactMemoryProvenanceId(input.evidenceId) &&
    Number.isSafeInteger(input.observedAt) &&
    (input.observedAt ?? -1) >= 0 &&
    (input.observedAt ?? recordedAt + 1) <= recordedAt &&
    (input.observedAt ?? 0) >= Math.max(0, recordedAt - OBSERVATION_RETENTION_MS)
  );
}

async function sha256(domain: string, value: string): Promise<string> {
  const hash = (
    await Crypto.digestStringAsync(
      Crypto.CryptoDigestAlgorithm.SHA256,
      `${domain}\u0000${value}`,
    )
  ).toLowerCase();
  if (!SHA256_PATTERN.test(hash)) throw new Error('product_experience_hash_invalid');
  return hash;
}

async function hashObservation(
  input: ProductExperienceObservationInput,
): Promise<HashedObservation> {
  const preconditionIdsJson = JSON.stringify(input.preconditionIds);
  const [memoryConversationIdHash, sourceThreadIdHash, sourceRunIdHash, preconditionIdsHash, evidenceIdHash] =
    await Promise.all([
      sha256('product_experience_memory_conversation', input.memoryConversationId),
      sha256('product_experience_source_thread', input.sourceThreadId),
      sha256('product_experience_source_run', input.sourceRunId),
      sha256('product_experience_preconditions', preconditionIdsJson),
      sha256('product_experience_evidence', input.evidenceId),
    ]);
  const identityHash = await sha256(
    'product_experience_observation',
    JSON.stringify([
      memoryConversationIdHash,
      sourceThreadIdHash,
      sourceRunIdHash,
      input.domainId,
      input.environmentId,
      input.procedureId,
      preconditionIdsHash,
    ]),
  );
  return {
    id: `product_experience_${identityHash}`,
    memoryConversationIdHash,
    sourceThreadIdHash,
    sourceRunIdHash,
    preconditionIdsJson,
    preconditionIdsHash,
    evidenceIdHash,
  };
}

function readExisting(
  input: ProductExperienceObservationInput,
  hashed: HashedObservation,
  memoryOwnerId: string,
): ProductExperienceObservationRow | undefined {
  return (
    getMemoryDb().getFirstSync<ProductExperienceObservationRow>(
      `SELECT id, memory_owner_id, memory_conversation_id_hash, source_thread_id_hash,
              source_run_id_hash, domain_id, environment_id, procedure_id,
              precondition_ids_json, precondition_ids_hash, outcome, authority,
              evidence_kind, evidence_id_hash, contract_version, observed_at, created_at
         FROM memory_product_experience_observations
        WHERE memory_owner_id = ?
          AND memory_conversation_id_hash = ?
          AND source_thread_id_hash = ?
          AND source_run_id_hash = ?
          AND domain_id = ?
          AND environment_id = ?
          AND procedure_id = ?
          AND precondition_ids_hash = ?`,
      memoryOwnerId,
      hashed.memoryConversationIdHash,
      hashed.sourceThreadIdHash,
      hashed.sourceRunIdHash,
      input.domainId,
      input.environmentId,
      input.procedureId,
      hashed.preconditionIdsHash,
    ) ?? undefined
  );
}

function rowMatches(
  row: ProductExperienceObservationRow,
  input: ProductExperienceObservationInput,
  hashed: HashedObservation,
  memoryOwnerId: string,
): boolean {
  return (
    row.id === hashed.id &&
    row.memory_owner_id === memoryOwnerId &&
    row.memory_conversation_id_hash === hashed.memoryConversationIdHash &&
    row.source_thread_id_hash === hashed.sourceThreadIdHash &&
    row.source_run_id_hash === hashed.sourceRunIdHash &&
    row.domain_id === input.domainId &&
    row.environment_id === input.environmentId &&
    row.procedure_id === input.procedureId &&
    row.precondition_ids_json === hashed.preconditionIdsJson &&
    row.precondition_ids_hash === hashed.preconditionIdsHash &&
    row.outcome === input.outcome &&
    row.authority === input.authority &&
    row.evidence_kind === input.evidenceKind &&
    row.evidence_id_hash === hashed.evidenceIdHash &&
    row.contract_version === 1 &&
    row.observed_at === input.observedAt &&
    Number.isSafeInteger(row.created_at) &&
    row.created_at >= row.observed_at
  );
}

function pruneObservations(params: {
  input: ProductExperienceObservationInput;
  hashed: HashedObservation;
  memoryOwnerId: string;
  recordedAt: number;
}): number {
  const db = getMemoryDb();
  let prunedCount =
    db.runSync(
      `DELETE FROM memory_product_experience_observations
        WHERE memory_owner_id = ? AND observed_at < ?`,
      params.memoryOwnerId,
      Math.max(0, params.recordedAt - OBSERVATION_RETENTION_MS),
    ).changes ?? 0;
  prunedCount +=
    db.runSync(
      `DELETE FROM memory_product_experience_observations
        WHERE id IN (
          SELECT id
            FROM memory_product_experience_observations
           WHERE memory_owner_id = ?
             AND memory_conversation_id_hash = ?
             AND source_thread_id_hash = ?
             AND domain_id = ?
             AND environment_id = ?
             AND procedure_id = ?
             AND precondition_ids_hash = ?
           ORDER BY observed_at DESC, id DESC
           LIMIT -1 OFFSET ?
        )`,
      params.memoryOwnerId,
      params.hashed.memoryConversationIdHash,
      params.hashed.sourceThreadIdHash,
      params.input.domainId,
      params.input.environmentId,
      params.input.procedureId,
      params.hashed.preconditionIdsHash,
      MAX_OBSERVATIONS_PER_EXACT_SCOPE,
    ).changes ?? 0;
  prunedCount +=
    db.runSync(
      `DELETE FROM memory_product_experience_observations
        WHERE id IN (
          SELECT id
            FROM memory_product_experience_observations
           WHERE memory_owner_id = ?
           ORDER BY observed_at DESC, id DESC
           LIMIT -1 OFFSET ?
        )`,
      params.memoryOwnerId,
      MAX_OBSERVATIONS_PER_OWNER,
    ).changes ?? 0;
  return prunedCount;
}

export async function recordProductExperienceObservation(
  input: ProductExperienceObservationInput,
  recordedAt = Date.now(),
): Promise<RecordProductExperienceObservationResult> {
  if (!canWriteLongTermMemory()) {
    return { status: 'rejected', code: 'memory_disabled' };
  }
  const memoryPolicyEpoch = getMemoryPolicyEpoch();
  if (!Number.isSafeInteger(recordedAt) || recordedAt < 0 || !validInput(input, recordedAt)) {
    return { status: 'rejected', code: 'invalid_input' };
  }

  let hashed: HashedObservation;
  try {
    hashed = await hashObservation(input);
  } catch {
    return { status: 'failed', code: 'hashing_error' };
  }
  if (!isMemoryPolicyEpochCurrent(memoryPolicyEpoch)) {
    return { status: 'rejected', code: 'memory_disabled' };
  }

  try {
    ensureFactSchema();
    return runMemoryTransaction(() => {
      const memoryOwnerId = getLocalMemoryVaultOwnerId(getMemoryDb());
      const existing = readExisting(input, hashed, memoryOwnerId);
      if (existing) {
        if (!rowMatches(existing, input, hashed, memoryOwnerId)) {
          return { status: 'rejected', code: 'conflicting_run_evidence' } as const;
        }
        return {
          status: 'unchanged',
          observationId: existing.id,
          prunedCount: pruneObservations({ input, hashed, memoryOwnerId, recordedAt }),
        } as const;
      }

      getMemoryDb().runSync(
        `INSERT INTO memory_product_experience_observations(
           id, memory_owner_id, memory_conversation_id_hash, source_thread_id_hash,
           source_run_id_hash, domain_id, environment_id, procedure_id,
           precondition_ids_json, precondition_ids_hash, outcome, authority,
           evidence_kind, evidence_id_hash, contract_version, observed_at, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
        hashed.id,
        memoryOwnerId,
        hashed.memoryConversationIdHash,
        hashed.sourceThreadIdHash,
        hashed.sourceRunIdHash,
        input.domainId,
        input.environmentId,
        input.procedureId,
        hashed.preconditionIdsJson,
        hashed.preconditionIdsHash,
        input.outcome,
        input.authority,
        input.evidenceKind,
        hashed.evidenceIdHash,
        input.observedAt,
        recordedAt,
      );
      const prunedCount = pruneObservations({ input, hashed, memoryOwnerId, recordedAt });
      const retained = getMemoryDb().getFirstSync<{ id: string }>(
        'SELECT id FROM memory_product_experience_observations WHERE id = ?',
        hashed.id,
      );
      if (retained?.id !== hashed.id) {
        throw new Error('product_experience_insert_pruned');
      }
      return { status: 'recorded', observationId: hashed.id, prunedCount } as const;
    });
  } catch {
    return { status: 'failed', code: 'storage_error' };
  }
}
