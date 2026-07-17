import type { ToolEffectDigest } from '../../../types/toolEffectReceipt';
import { sha256HexUtf8Async } from '../../../utils/sha256Async';
import { getMemoryDb } from '../database';
import { getLocalMemoryVaultOwnerId } from '../memoryVaultIdentity';
import { earliestFutureMemoryValidityDeadline } from '../memoryValidityDeadline';
import { captureMemoryReadEpoch, isMemoryReadEpochCurrent } from '../policy';
import { ensureFactSchema } from '../schema';
import { decodeVerifiedProcedureEvidenceManifest } from './evidenceManifest';
import {
  isValidVerifiedProcedureObservationScope,
  matchesCurrentVerifiedProcedureScope,
  type VerifiedProcedureObservationScope,
} from './observationScope';
import {
  VERIFIED_PROCEDURE_MAX_OBSERVATIONS_PER_SCOPE,
  VERIFIED_PROCEDURE_OBSERVATION_RETENTION_MS,
  VERIFIED_PROCEDURE_PROMOTION_RUN_THRESHOLD,
} from './policyContract';
import {
  captureVerifiedProcedureAuthoritySnapshot,
  isVerifiedProcedureProjectionSnapshotDurablyCurrent,
  type VerifiedProcedureAuthoritySnapshot,
} from './observationAuthority';

const RAW_SHA256_PATTERN = /^[a-f0-9]{64}$/u;

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

export type VerifiedProcedurePromotionState = Readonly<{
  status: 'promoted' | 'insufficient' | 'unavailable';
  successfulRunCount: number;
  readEpoch?: number;
  authoritySnapshot?: VerifiedProcedureAuthoritySnapshot;
  validUntil?: number;
}>;

function projectionReadCurrent(
  readEpoch: number,
  snapshot: VerifiedProcedureAuthoritySnapshot,
): boolean {
  return (
    isMemoryReadEpochCurrent(readEpoch) &&
    isVerifiedProcedureProjectionSnapshotDurablyCurrent(snapshot)
  );
}

async function sha256(domain: string, value: string): Promise<string> {
  const digest = await sha256HexUtf8Async(`kavi.verified-procedure.${domain}.v1\u0000${value}`);
  if (!RAW_SHA256_PATTERN.test(digest)) throw new Error('verified_procedure_hash_invalid');
  return digest;
}

function strippedDigest(value: ToolEffectDigest): string {
  return value.slice('sha256:'.length);
}

async function hashScope(scope: VerifiedProcedureObservationScope): Promise<ScopeHashes> {
  const preconditionIdsJson = JSON.stringify(scope.preconditionIds);
  return {
    preconditionIdsJson,
    preconditionIdsHash: await sha256('preconditions', preconditionIdsJson),
  };
}

function validStoredManifest(
  row: ObservationRow,
  scope: VerifiedProcedureObservationScope,
): boolean {
  const manifest = decodeVerifiedProcedureEvidenceManifest(row.evidence_manifest_json);
  return (
    !!manifest &&
    manifest.procedureId === scope.procedureId &&
    manifest.procedureContractDigest === scope.procedureContractDigest &&
    strippedDigest(manifest.evidenceId) === row.evidence_id_digest &&
    strippedDigest(manifest.linkageDigest) === row.linkage_digest &&
    strippedDigest(manifest.terminalProofDigest) === row.terminal_proof_digest
  );
}

export async function readVerifiedProcedurePromotionState(
  scope: VerifiedProcedureObservationScope,
  now = Date.now(),
): Promise<VerifiedProcedurePromotionState> {
  const readEpoch = captureMemoryReadEpoch();
  if (
    readEpoch === null ||
    !Number.isSafeInteger(now) ||
    now < 0 ||
    !isValidVerifiedProcedureObservationScope(scope)
  ) {
    return { status: 'unavailable', successfulRunCount: 0 };
  }

  try {
    if (!(await matchesCurrentVerifiedProcedureScope(scope))) {
      return { status: 'unavailable', successfulRunCount: 0 };
    }
    if (!isMemoryReadEpochCurrent(readEpoch)) {
      return { status: 'unavailable', successfulRunCount: 0 };
    }
    const hashes = await hashScope(scope);
    if (!isMemoryReadEpochCurrent(readEpoch)) {
      return { status: 'unavailable', successfulRunCount: 0 };
    }
    ensureFactSchema();
    const db = getMemoryDb();
    const memoryOwnerId = getLocalMemoryVaultOwnerId(db);
    const authoritySnapshot = captureVerifiedProcedureAuthoritySnapshot(db, memoryOwnerId);
    if (!authoritySnapshot) return { status: 'unavailable', successfulRunCount: 0 };
    const expiredAtOrBefore = now - VERIFIED_PROCEDURE_OBSERVATION_RETENTION_MS;
    const rows = db.getAllSync<ObservationRow>(
      `SELECT id, memory_owner_id, memory_conversation_id_hash, source_thread_id_hash,
              source_run_id_hash, procedure_id, procedure_contract_digest, platform,
              precondition_ids_json, precondition_ids_hash, evidence_manifest_json,
              evidence_manifest_digest, evidence_id_digest, linkage_digest,
              terminal_proof_digest, contract_version, observed_at, created_at
         FROM memory_verified_procedure_observations
        WHERE memory_owner_id = ?
          AND procedure_id = ?
          AND procedure_contract_digest = ?
          AND platform = ?
          AND precondition_ids_json = ?
          AND precondition_ids_hash = ?
          AND observed_at > ?
          AND observed_at <= ?
        ORDER BY observed_at DESC, id DESC
        LIMIT ?`,
      memoryOwnerId,
      scope.procedureId,
      strippedDigest(scope.procedureContractDigest),
      scope.platform,
      hashes.preconditionIdsJson,
      hashes.preconditionIdsHash,
      expiredAtOrBefore,
      now,
      VERIFIED_PROCEDURE_MAX_OBSERVATIONS_PER_SCOPE + 1,
    );
    if (!projectionReadCurrent(readEpoch, authoritySnapshot)) {
      return { status: 'unavailable', successfulRunCount: 0 };
    }
    if (rows.length > VERIFIED_PROCEDURE_MAX_OBSERVATIONS_PER_SCOPE) {
      return { status: 'unavailable', successfulRunCount: 0 };
    }

    const recomputedManifestDigests = await Promise.all(
      rows.map((row) => sha256('evidence-manifest', row.evidence_manifest_json)),
    );
    if (!projectionReadCurrent(readEpoch, authoritySnapshot)) {
      return { status: 'unavailable', successfulRunCount: 0 };
    }
    const successfulRuns = new Set<string>();
    for (const [index, row] of rows.entries()) {
      if (
        row.memory_owner_id !== memoryOwnerId ||
        !RAW_SHA256_PATTERN.test(row.memory_conversation_id_hash) ||
        !RAW_SHA256_PATTERN.test(row.source_thread_id_hash) ||
        !RAW_SHA256_PATTERN.test(row.source_run_id_hash) ||
        row.procedure_id !== scope.procedureId ||
        row.procedure_contract_digest !== strippedDigest(scope.procedureContractDigest) ||
        row.platform !== scope.platform ||
        row.precondition_ids_json !== hashes.preconditionIdsJson ||
        row.precondition_ids_hash !== hashes.preconditionIdsHash ||
        !RAW_SHA256_PATTERN.test(row.evidence_manifest_digest) ||
        !RAW_SHA256_PATTERN.test(row.evidence_id_digest) ||
        !RAW_SHA256_PATTERN.test(row.linkage_digest) ||
        !RAW_SHA256_PATTERN.test(row.terminal_proof_digest) ||
        row.contract_version !== 1 ||
        !Number.isSafeInteger(row.observed_at) ||
        row.observed_at <= expiredAtOrBefore ||
        row.observed_at > now ||
        !Number.isSafeInteger(row.created_at) ||
        row.created_at < row.observed_at ||
        !validStoredManifest(row, scope) ||
        recomputedManifestDigests[index] !== row.evidence_manifest_digest
      ) {
        return { status: 'unavailable', successfulRunCount: 0 };
      }
      successfulRuns.add(row.source_run_id_hash);
    }
    if (!projectionReadCurrent(readEpoch, authoritySnapshot)) {
      return { status: 'unavailable', successfulRunCount: 0 };
    }
    if (!isVerifiedProcedureProjectionSnapshotDurablyCurrent(authoritySnapshot)) {
      return { status: 'unavailable', successfulRunCount: 0 };
    }
    const validUntil = earliestFutureMemoryValidityDeadline(
      rows.map((row) => row.observed_at + VERIFIED_PROCEDURE_OBSERVATION_RETENTION_MS),
      now,
    );
    const successfulRunCount = successfulRuns.size;
    return {
      status:
        successfulRunCount >= VERIFIED_PROCEDURE_PROMOTION_RUN_THRESHOLD
          ? 'promoted'
          : 'insufficient',
      successfulRunCount,
      readEpoch,
      authoritySnapshot,
      ...(validUntil === undefined ? {} : { validUntil }),
    };
  } catch {
    return { status: 'unavailable', successfulRunCount: 0 };
  }
}
