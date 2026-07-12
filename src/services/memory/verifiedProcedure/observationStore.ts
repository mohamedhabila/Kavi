import * as Crypto from 'expo-crypto';
import { digestToolEffectText } from '../../../engine/toolExecution/toolEffectReceipt';
import type { ToolEffectDigest } from '../../../types/toolEffectReceipt';
import { runMemoryTransaction } from '../access/transaction';
import { getMemoryDb } from '../database';
import { isExactMemoryProvenanceId } from '../memoryProvenanceIdentity';
import { isExactMemoryScopeId } from '../memoryScopeIdentity';
import { getLocalMemoryVaultOwnerId } from '../memoryVaultIdentity';
import { canWriteLongTermMemory, isMemoryPolicyEpochCurrent } from '../policy';
import { ensureFactSchema } from '../schema';
import { isMemoryIngestionSourceWithdrawn } from '../withdrawalFence';
import { buildVerifiedProcedureEvidenceManifest } from './evidenceManifest';
import {
  VERIFIED_PROCEDURE_MAX_EVIDENCE_MANIFEST_LENGTH,
  VERIFIED_PROCEDURE_MAX_OBSERVATIONS_PER_OWNER,
  VERIFIED_PROCEDURE_MAX_OBSERVATIONS_PER_SCOPE,
  VERIFIED_PROCEDURE_OBSERVATION_RETENTION_MS,
} from './policyContract';
import {
  matchesCurrentVerifiedProcedureScope,
  validVerifiedProcedurePreconditions,
  type VerifiedProcedureObservationScope,
} from './observationScope';
import {
  claimVerifiedProcedureLedgerCandidate,
  digestVerifiedProcedureRunId,
  type VerifiedProcedureLedgerCandidate,
} from './runLedger';
import {
  verifiedProcedureProvenanceHashInput,
  type VerifiedProcedureProvenanceHashDomain,
  type VerifiedProcedureMemoryLineage,
  type VerifiedProcedureMemoryLineageHashes,
} from './provenanceHash';
import { advanceVerifiedProcedureObservationRevision } from './observationRevision';

const COMMIT_CONTEXT_KEYS = [
  'candidate',
  'graphProofDigest',
  'memoryConversationId',
  'memoryLineage',
  'platform',
  'preconditionIds',
  'sourceRunId',
  'sourceThreadId',
  'surface',
  'terminalObservedAt',
] as const;
const MEMORY_LINEAGE_KEYS = ['sourceMessageId', 'sourceRunId', 'sourceTurnId', 'taskId'] as const;
const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const RAW_SHA256_PATTERN = /^[a-f0-9]{64}$/u;

declare const verifiedProcedureTerminalCommitAuthorityBrand: unique symbol;

/** Opaque, single-use authority issued only from genuine run-ledger evidence. */
export type VerifiedProcedureTerminalCommitAuthority = Readonly<{
  readonly [verifiedProcedureTerminalCommitAuthorityBrand]: true;
}>;

export type VerifiedProcedureTerminalCommitContext = Readonly<{
  candidate: VerifiedProcedureLedgerCandidate;
  memoryLineage: VerifiedProcedureMemoryLineage;
  memoryConversationId: string;
  sourceThreadId: string;
  sourceRunId: string;
  platform: 'android' | 'ios';
  preconditionIds: readonly string[];
  graphProofDigest: ToolEffectDigest;
  surface: 'foreground' | 'scheduler' | 'subagent';
  terminalObservedAt: number;
}>;

export type IssueVerifiedProcedureTerminalCommitAuthorityResult =
  | { status: 'issued'; authority: VerifiedProcedureTerminalCommitAuthority }
  | { status: 'rejected'; code: 'invalid_candidate' | 'invalid_input' | 'memory_disabled' }
  | { status: 'failed'; code: 'hashing_error' };

export type { VerifiedProcedureObservationScope } from './observationScope';

export type RecordVerifiedProcedureObservationResult =
  | { status: 'recorded' | 'unchanged'; observationId: string; prunedCount: number }
  | {
      status: 'rejected';
      code:
        | 'conflicting_run_evidence'
        | 'invalid_authority'
        | 'execution_run_invalidated'
        | 'memory_disabled'
        | 'outside_retained_window'
        | 'source_withdrawn';
    }
  | { status: 'failed'; code: 'hashing_error' | 'storage_error' };

type PendingObservation = Readonly<{
  policyEpoch: number;
  memoryConversationId: string;
  sourceThreadId: string;
  sourceRunId: string;
  memoryLineage: VerifiedProcedureMemoryLineage;
  procedureId: string;
  procedureContractDigest: ToolEffectDigest;
  platform: 'android' | 'ios';
  preconditionIds: readonly string[];
  evidenceManifestJson: string;
  evidenceManifestDigest: string;
  evidenceIdDigest: string;
  linkageDigest: string;
  terminalProofDigest: string;
  observedAt: number;
}>;

type HashedObservation = Readonly<{
  id: string;
  memoryConversationIdHash: string;
  sourceThreadIdHash: string;
  sourceRunIdHash: string;
  preconditionIdsJson: string;
  preconditionIdsHash: string;
}>;

type ScopeHashes = Readonly<{
  preconditionIdsJson: string;
  preconditionIdsHash: string;
}>;

type ObservationRow = Readonly<{
  id: string;
  memory_owner_id: string;
  memory_conversation_id_hash: string;
  source_thread_id_hash: string;
  source_run_id_hash: string;
  procedure_id: string;
  procedure_contract_digest: string;
  platform: string;
  precondition_ids_json: string;
  precondition_ids_hash: string;
  evidence_manifest_json: string;
  evidence_manifest_digest: string;
  evidence_id_digest: string;
  linkage_digest: string;
  terminal_proof_digest: string;
  contract_version: number;
  observed_at: number;
  created_at: number;
}>;

const issuedObservationCommits = new WeakMap<object, PendingObservation>();

function hasExactKeys(value: object, expected: readonly string[]): boolean {
  const keys = Object.keys(value).sort();
  return keys.length === expected.length && keys.every((key, index) => key === expected[index]);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function validCommitContext(value: unknown): value is VerifiedProcedureTerminalCommitContext {
  if (!isPlainRecord(value) || !hasExactKeys(value, COMMIT_CONTEXT_KEYS)) return false;
  const context = value as Partial<VerifiedProcedureTerminalCommitContext>;
  return (
    !!context.candidate &&
    typeof context.candidate === 'object' &&
    !Array.isArray(context.candidate) &&
    isPlainRecord(context.memoryLineage) &&
    hasExactKeys(context.memoryLineage, MEMORY_LINEAGE_KEYS) &&
    isExactMemoryProvenanceId(context.memoryLineage.sourceMessageId) &&
    (context.memoryLineage.sourceRunId === null ||
      isExactMemoryProvenanceId(context.memoryLineage.sourceRunId)) &&
    isExactMemoryProvenanceId(context.memoryLineage.sourceTurnId) &&
    (context.memoryLineage.taskId === null || isExactMemoryScopeId(context.memoryLineage.taskId)) &&
    isExactMemoryScopeId(context.memoryConversationId) &&
    isExactMemoryScopeId(context.sourceThreadId) &&
    isExactMemoryProvenanceId(context.sourceRunId) &&
    (context.platform === 'android' || context.platform === 'ios') &&
    validVerifiedProcedurePreconditions(context.preconditionIds) &&
    typeof context.graphProofDigest === 'string' &&
    SHA256_PATTERN.test(context.graphProofDigest) &&
    (context.surface === 'foreground' ||
      context.surface === 'scheduler' ||
      context.surface === 'subagent') &&
    Number.isSafeInteger(context.terminalObservedAt) &&
    (context.terminalObservedAt ?? -1) >= 0
  );
}

async function hashMemoryLineage(
  lineage: VerifiedProcedureMemoryLineage,
): Promise<VerifiedProcedureMemoryLineageHashes> {
  const [sourceMessageIdHash, sourceRunIdHash, sourceTurnIdHash, taskIdHash] = await Promise.all([
    hashProvenance('memory-source-message', lineage.sourceMessageId),
    lineage.sourceRunId === null
      ? Promise.resolve(null)
      : hashProvenance('memory-source-run', lineage.sourceRunId),
    hashProvenance('memory-source-turn', lineage.sourceTurnId),
    lineage.taskId === null
      ? Promise.resolve(null)
      : hashProvenance('memory-source-task', lineage.taskId),
  ]);
  return Object.freeze({ sourceMessageIdHash, sourceRunIdHash, sourceTurnIdHash, taskIdHash });
}

function isVerifiedProcedureMemoryLineageWithdrawn(params: {
  memoryConversationId: string;
  sourceThreadId: string;
  memoryLineage: VerifiedProcedureMemoryLineage;
}): boolean {
  return isMemoryIngestionSourceWithdrawn({
    memoryConversationId: params.memoryConversationId,
    sourceThreadId: params.sourceThreadId,
    taskId: params.memoryLineage.taskId,
    sourceStartMessageId: params.memoryLineage.sourceMessageId,
    sourceEndMessageId: params.memoryLineage.sourceTurnId,
    sourceRunId: params.memoryLineage.sourceRunId,
  });
}

async function sha256(domain: string, value: string): Promise<string> {
  const digest = (
    await Crypto.digestStringAsync(
      Crypto.CryptoDigestAlgorithm.SHA256,
      `kavi.verified-procedure.${domain}.v1\u0000${value}`,
    )
  ).toLowerCase();
  if (!RAW_SHA256_PATTERN.test(digest)) throw new Error('verified_procedure_hash_invalid');
  return digest;
}

async function hashProvenance(
  domain: VerifiedProcedureProvenanceHashDomain,
  value: string,
): Promise<string> {
  const digest = (
    await Crypto.digestStringAsync(
      Crypto.CryptoDigestAlgorithm.SHA256,
      verifiedProcedureProvenanceHashInput(domain, value),
    )
  ).toLowerCase();
  if (!RAW_SHA256_PATTERN.test(digest)) throw new Error('verified_procedure_hash_invalid');
  return digest;
}

function strippedDigest(value: ToolEffectDigest): string {
  return value.slice('sha256:'.length);
}

/**
 * Converts verified run evidence into one opaque commit authority. The ledger
 * candidate and resulting authority are both one-shot capabilities.
 */
export async function issueVerifiedProcedureTerminalCommitAuthority(
  context: VerifiedProcedureTerminalCommitContext,
): Promise<IssueVerifiedProcedureTerminalCommitAuthorityResult> {
  if (!canWriteLongTermMemory()) return { status: 'rejected', code: 'memory_disabled' };
  if (!validCommitContext(context)) return { status: 'rejected', code: 'invalid_input' };
  const scope: VerifiedProcedureObservationScope = {
    contractVersion: 1,
    procedureId: context.candidate.procedureId,
    procedureContractDigest: context.candidate.procedureContractDigest,
    platform: context.platform,
    preconditionIds: context.preconditionIds,
  };
  try {
    if (isVerifiedProcedureMemoryLineageWithdrawn(context)) {
      return { status: 'rejected', code: 'invalid_input' };
    }
    if (!(await matchesCurrentVerifiedProcedureScope(scope))) {
      return { status: 'rejected', code: 'invalid_input' };
    }
    const sourceRunIdDigest = await digestVerifiedProcedureRunId(context.sourceRunId);
    const claimed = claimVerifiedProcedureLedgerCandidate(context.candidate);
    if (!claimed) return { status: 'rejected', code: 'invalid_candidate' };
    if (
      claimed.runIdDigest !== sourceRunIdDigest ||
      claimed.candidate !== context.candidate ||
      context.terminalObservedAt < context.candidate.observedAt
    ) {
      return { status: 'rejected', code: 'invalid_candidate' };
    }
    if (!isMemoryPolicyEpochCurrent(claimed.memoryPolicyEpoch)) {
      return { status: 'rejected', code: 'memory_disabled' };
    }

    const [terminalProofDigest, memoryLineageHashes] = await Promise.all([
      digestToolEffectText(
        JSON.stringify({
          domain: 'kavi.verified-procedure.terminal-proof.v1',
          value: {
            candidateEvidenceId: context.candidate.evidenceId,
            graphProofDigest: context.graphProofDigest,
            procedureContractDigest: context.candidate.procedureContractDigest,
            surface: context.surface,
            terminalObservedAt: context.terminalObservedAt,
            terminalState: 'durably_succeeded',
          },
        }),
      ),
      hashMemoryLineage(context.memoryLineage),
    ]);
    const manifest = buildVerifiedProcedureEvidenceManifest(
      context.candidate,
      terminalProofDigest,
      memoryLineageHashes,
    );
    const evidenceManifestJson = JSON.stringify(manifest);
    if (evidenceManifestJson.length > VERIFIED_PROCEDURE_MAX_EVIDENCE_MANIFEST_LENGTH) {
      return { status: 'rejected', code: 'invalid_candidate' };
    }
    const evidenceManifestDigest = await sha256('evidence-manifest', evidenceManifestJson);
    if (!isMemoryPolicyEpochCurrent(claimed.memoryPolicyEpoch)) {
      return { status: 'rejected', code: 'memory_disabled' };
    }

    const authority = Object.freeze({}) as VerifiedProcedureTerminalCommitAuthority;
    issuedObservationCommits.set(
      authority,
      Object.freeze({
        policyEpoch: claimed.memoryPolicyEpoch,
        memoryLineage: Object.freeze({ ...context.memoryLineage }),
        memoryConversationId: context.memoryConversationId,
        sourceThreadId: context.sourceThreadId,
        sourceRunId: context.sourceRunId,
        procedureId: context.candidate.procedureId,
        procedureContractDigest: context.candidate.procedureContractDigest,
        platform: context.platform,
        preconditionIds: Object.freeze([...context.preconditionIds]),
        evidenceManifestJson,
        evidenceManifestDigest,
        evidenceIdDigest: strippedDigest(context.candidate.evidenceId),
        linkageDigest: strippedDigest(context.candidate.linkageDigest),
        terminalProofDigest: strippedDigest(terminalProofDigest),
        observedAt: context.terminalObservedAt,
      }),
    );
    return { status: 'issued', authority };
  } catch {
    return { status: 'failed', code: 'hashing_error' };
  }
}

async function hashScope(scope: VerifiedProcedureObservationScope): Promise<ScopeHashes> {
  const preconditionIdsJson = JSON.stringify(scope.preconditionIds);
  return {
    preconditionIdsJson,
    preconditionIdsHash: await sha256('preconditions', preconditionIdsJson),
  };
}

async function hashObservation(params: {
  pending: PendingObservation;
  scopeHashes: ScopeHashes;
  memoryOwnerId: string;
}): Promise<HashedObservation> {
  const [memoryConversationIdHash, sourceThreadIdHash, sourceRunIdHash] = await Promise.all([
    hashProvenance('memory-conversation', params.pending.memoryConversationId),
    hashProvenance('source-thread', params.pending.sourceThreadId),
    hashProvenance('source-run', params.pending.sourceRunId),
  ]);
  const identityHash = await sha256(
    'observation',
    JSON.stringify([
      params.memoryOwnerId,
      sourceRunIdHash,
      params.pending.procedureId,
      params.pending.procedureContractDigest,
      params.pending.platform,
      params.scopeHashes.preconditionIdsHash,
    ]),
  );
  return {
    id: `verified_procedure_${identityHash}`,
    memoryConversationIdHash,
    sourceThreadIdHash,
    sourceRunIdHash,
    ...params.scopeHashes,
  };
}

function readExisting(
  pending: PendingObservation,
  hashed: HashedObservation,
  memoryOwnerId: string,
): ObservationRow | undefined {
  return (
    getMemoryDb().getFirstSync<ObservationRow>(
      `SELECT id, memory_owner_id, memory_conversation_id_hash, source_thread_id_hash,
              source_run_id_hash, procedure_id, procedure_contract_digest, platform,
              precondition_ids_json, precondition_ids_hash, evidence_manifest_json,
              evidence_manifest_digest, evidence_id_digest, linkage_digest,
              terminal_proof_digest, contract_version, observed_at, created_at
         FROM memory_verified_procedure_observations
        WHERE memory_owner_id = ?
          AND source_run_id_hash = ?
          AND procedure_id = ?
          AND procedure_contract_digest = ?
          AND platform = ?
          AND precondition_ids_json = ?
          AND precondition_ids_hash = ?`,
      memoryOwnerId,
      hashed.sourceRunIdHash,
      pending.procedureId,
      strippedDigest(pending.procedureContractDigest),
      pending.platform,
      hashed.preconditionIdsJson,
      hashed.preconditionIdsHash,
    ) ?? undefined
  );
}

function rowMatches(
  row: ObservationRow,
  pending: PendingObservation,
  hashed: HashedObservation,
  memoryOwnerId: string,
): boolean {
  return (
    row.id === hashed.id &&
    row.memory_owner_id === memoryOwnerId &&
    row.memory_conversation_id_hash === hashed.memoryConversationIdHash &&
    row.source_thread_id_hash === hashed.sourceThreadIdHash &&
    row.source_run_id_hash === hashed.sourceRunIdHash &&
    row.procedure_id === pending.procedureId &&
    row.procedure_contract_digest === strippedDigest(pending.procedureContractDigest) &&
    row.platform === pending.platform &&
    row.precondition_ids_json === hashed.preconditionIdsJson &&
    row.precondition_ids_hash === hashed.preconditionIdsHash &&
    row.evidence_manifest_json === pending.evidenceManifestJson &&
    row.evidence_manifest_digest === pending.evidenceManifestDigest &&
    row.evidence_id_digest === pending.evidenceIdDigest &&
    row.linkage_digest === pending.linkageDigest &&
    row.terminal_proof_digest === pending.terminalProofDigest &&
    row.contract_version === 1 &&
    row.observed_at === pending.observedAt &&
    Number.isSafeInteger(row.created_at) &&
    row.created_at >= row.observed_at
  );
}

function pruneObservations(params: {
  pending: PendingObservation;
  hashed: HashedObservation;
  memoryOwnerId: string;
  recordedAt: number;
}): number {
  const db = getMemoryDb();
  let prunedCount =
    db.runSync(
      `DELETE FROM memory_verified_procedure_observations
        WHERE memory_owner_id = ? AND observed_at < ?`,
      params.memoryOwnerId,
      Math.max(0, params.recordedAt - VERIFIED_PROCEDURE_OBSERVATION_RETENTION_MS),
    ).changes ?? 0;
  prunedCount +=
    db.runSync(
      `DELETE FROM memory_verified_procedure_observations
        WHERE id IN (
          SELECT id
            FROM memory_verified_procedure_observations
           WHERE memory_owner_id = ?
             AND procedure_id = ?
             AND procedure_contract_digest = ?
             AND platform = ?
             AND precondition_ids_json = ?
             AND precondition_ids_hash = ?
           ORDER BY observed_at DESC, id DESC
           LIMIT -1 OFFSET ?
        )`,
      params.memoryOwnerId,
      params.pending.procedureId,
      strippedDigest(params.pending.procedureContractDigest),
      params.pending.platform,
      params.hashed.preconditionIdsJson,
      params.hashed.preconditionIdsHash,
      VERIFIED_PROCEDURE_MAX_OBSERVATIONS_PER_SCOPE,
    ).changes ?? 0;
  prunedCount +=
    db.runSync(
      `DELETE FROM memory_verified_procedure_observations
        WHERE id IN (
          SELECT id
            FROM memory_verified_procedure_observations
           WHERE memory_owner_id = ?
           ORDER BY observed_at DESC, id DESC
           LIMIT -1 OFFSET ?
        )`,
      params.memoryOwnerId,
      VERIFIED_PROCEDURE_MAX_OBSERVATIONS_PER_OWNER,
    ).changes ?? 0;
  return prunedCount;
}

function hasRunInvalidationFence(memoryOwnerId: string, sourceRunIdHash: string): boolean {
  const row = getMemoryDb().getFirstSync<{
    invalidated_at: unknown;
    observation_revision: unknown;
  }>(
    `SELECT invalidated_at, observation_revision
       FROM memory_verified_procedure_run_invalidations
      WHERE memory_owner_id = ? AND source_run_id_hash = ?`,
    memoryOwnerId,
    sourceRunIdHash,
  );
  if (!row) return false;
  if (
    !Number.isSafeInteger(row.invalidated_at) ||
    (row.invalidated_at as number) < 0 ||
    !Number.isSafeInteger(row.observation_revision) ||
    (row.observation_revision as number) < 1
  ) {
    throw new Error('verified_procedure_run_invalidation_invalid');
  }
  return true;
}

export async function recordVerifiedProcedureObservation(
  authority: VerifiedProcedureTerminalCommitAuthority,
  recordedAt = Date.now(),
): Promise<RecordVerifiedProcedureObservationResult> {
  if (!authority || typeof authority !== 'object' || Array.isArray(authority)) {
    return { status: 'rejected', code: 'invalid_authority' };
  }
  const pending = issuedObservationCommits.get(authority);
  if (!pending) return { status: 'rejected', code: 'invalid_authority' };
  issuedObservationCommits.delete(authority);

  if (!isMemoryPolicyEpochCurrent(pending.policyEpoch) || !canWriteLongTermMemory()) {
    return { status: 'rejected', code: 'memory_disabled' };
  }
  if (
    !Number.isSafeInteger(recordedAt) ||
    recordedAt < pending.observedAt ||
    pending.observedAt < Math.max(0, recordedAt - VERIFIED_PROCEDURE_OBSERVATION_RETENTION_MS)
  ) {
    return { status: 'rejected', code: 'outside_retained_window' };
  }

  const scope: VerifiedProcedureObservationScope = {
    contractVersion: 1,
    procedureId: pending.procedureId,
    procedureContractDigest: pending.procedureContractDigest,
    platform: pending.platform,
    preconditionIds: pending.preconditionIds,
  };
  try {
    if (!(await matchesCurrentVerifiedProcedureScope(scope))) {
      return { status: 'rejected', code: 'invalid_authority' };
    }
  } catch {
    return { status: 'failed', code: 'hashing_error' };
  }
  if (!isMemoryPolicyEpochCurrent(pending.policyEpoch)) {
    return { status: 'rejected', code: 'memory_disabled' };
  }

  let scopeHashes: ScopeHashes;
  try {
    scopeHashes = await hashScope(scope);
  } catch {
    return { status: 'failed', code: 'hashing_error' };
  }
  if (!isMemoryPolicyEpochCurrent(pending.policyEpoch)) {
    return { status: 'rejected', code: 'memory_disabled' };
  }

  try {
    ensureFactSchema();
    const memoryOwnerId = getLocalMemoryVaultOwnerId(getMemoryDb());
    const hashed = await hashObservation({ pending, scopeHashes, memoryOwnerId });
    if (!isMemoryPolicyEpochCurrent(pending.policyEpoch)) {
      return { status: 'rejected', code: 'memory_disabled' };
    }

    return runMemoryTransaction(() => {
      if (isVerifiedProcedureMemoryLineageWithdrawn(pending)) {
        return { status: 'rejected', code: 'source_withdrawn' } as const;
      }
      if (hasRunInvalidationFence(memoryOwnerId, hashed.sourceRunIdHash)) {
        return { status: 'rejected', code: 'execution_run_invalidated' } as const;
      }
      const existing = readExisting(pending, hashed, memoryOwnerId);
      if (existing) {
        if (!rowMatches(existing, pending, hashed, memoryOwnerId)) {
          return { status: 'rejected', code: 'conflicting_run_evidence' } as const;
        }
        const prunedCount = pruneObservations({ pending, hashed, memoryOwnerId, recordedAt });
        if (prunedCount > 0) {
          advanceVerifiedProcedureObservationRevision(getMemoryDb(), memoryOwnerId);
        }
        return {
          status: 'unchanged',
          observationId: existing.id,
          prunedCount,
        } as const;
      }

      if (hasRunInvalidationFence(memoryOwnerId, hashed.sourceRunIdHash)) {
        return { status: 'rejected', code: 'execution_run_invalidated' } as const;
      }
      getMemoryDb().runSync(
        `INSERT INTO memory_verified_procedure_observations(
           id, memory_owner_id, memory_conversation_id_hash, source_thread_id_hash,
           source_run_id_hash, procedure_id, procedure_contract_digest, platform,
           precondition_ids_json, precondition_ids_hash, evidence_manifest_json,
           evidence_manifest_digest, evidence_id_digest, linkage_digest,
           terminal_proof_digest, contract_version, observed_at, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
        hashed.id,
        memoryOwnerId,
        hashed.memoryConversationIdHash,
        hashed.sourceThreadIdHash,
        hashed.sourceRunIdHash,
        pending.procedureId,
        strippedDigest(pending.procedureContractDigest),
        pending.platform,
        hashed.preconditionIdsJson,
        hashed.preconditionIdsHash,
        pending.evidenceManifestJson,
        pending.evidenceManifestDigest,
        pending.evidenceIdDigest,
        pending.linkageDigest,
        pending.terminalProofDigest,
        pending.observedAt,
        recordedAt,
      );
      const prunedCount = pruneObservations({ pending, hashed, memoryOwnerId, recordedAt });
      advanceVerifiedProcedureObservationRevision(getMemoryDb(), memoryOwnerId);
      const retained = getMemoryDb().getFirstSync<{ id: string }>(
        'SELECT id FROM memory_verified_procedure_observations WHERE id = ?',
        hashed.id,
      );
      return retained?.id === hashed.id
        ? ({ status: 'recorded', observationId: hashed.id, prunedCount } as const)
        : ({ status: 'rejected', code: 'outside_retained_window' } as const);
    });
  } catch {
    return { status: 'failed', code: 'storage_error' };
  }
}
