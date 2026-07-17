import type { ToolEffectDigest } from '../../../types/toolEffectReceipt';
import { isExactDurableScopeId } from '../../../utils/durableScopeIdentity';
import {
  VERIFIED_PROCEDURE_EVIDENCE_MANIFEST_VERSION,
  VERIFIED_PROCEDURE_MAX_EVIDENCE_MANIFEST_LENGTH,
} from './policyContract';
import type { VerifiedProcedureLedgerCandidate, VerifiedProcedureStepEvidence } from './runLedger';
import type { VerifiedProcedureMemoryLineageHashes } from './provenanceHash';

const MANIFEST_KEYS = [
  'evidenceId',
  'linkageDigest',
  'orderedSteps',
  'procedureContractDigest',
  'procedureId',
  'sourceLineage',
  'terminalProofDigest',
  'version',
] as const;
const MANIFEST_STEP_KEYS = [
  'contractIdentityDigest',
  'receiptId',
  'requestDigest',
  'resultDigest',
  'stepKey',
] as const;
const SOURCE_LINEAGE_KEYS = [
  'sourceMessageIdHash',
  'sourceRunIdHash',
  'sourceTurnIdHash',
  'taskIdHash',
] as const;
const CODE_OWNED_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/u;
const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const RECEIPT_ID_PATTERN = /^ter_[a-f0-9]{32}$/u;
const VALID_STEP_KEYS = new Set([
  'calendar-list',
  'calendar-create-event',
  'calendar-events',
  'calendar-update-event',
]);

export type VerifiedProcedureEvidenceManifestStep = Readonly<{
  stepKey: VerifiedProcedureStepEvidence['stepKey'];
  receiptId: string;
  contractIdentityDigest: ToolEffectDigest;
  requestDigest: ToolEffectDigest;
  resultDigest: ToolEffectDigest;
}>;

export type VerifiedProcedureEvidenceManifest = Readonly<{
  version: typeof VERIFIED_PROCEDURE_EVIDENCE_MANIFEST_VERSION;
  procedureId: string;
  procedureContractDigest: ToolEffectDigest;
  evidenceId: ToolEffectDigest;
  orderedSteps: readonly [
    VerifiedProcedureEvidenceManifestStep,
    VerifiedProcedureEvidenceManifestStep,
  ];
  linkageDigest: ToolEffectDigest;
  sourceLineage: VerifiedProcedureMemoryLineageHashes;
  terminalProofDigest: ToolEffectDigest;
}>;

function hasExactKeys(value: object, expected: readonly string[]): boolean {
  const keys = Object.keys(value).sort();
  return keys.length === expected.length && keys.every((key, index) => key === expected[index]);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isCodeOwnedId(value: unknown): value is string {
  return (
    typeof value === 'string' && isExactDurableScopeId(value) && CODE_OWNED_ID_PATTERN.test(value)
  );
}

function manifestStep(
  evidence: VerifiedProcedureStepEvidence,
): VerifiedProcedureEvidenceManifestStep {
  return Object.freeze({
    stepKey: evidence.stepKey,
    receiptId: evidence.receiptId,
    contractIdentityDigest: evidence.contractIdentityDigest,
    requestDigest: evidence.requestDigest,
    resultDigest: evidence.resultDigest,
  });
}

export function buildVerifiedProcedureEvidenceManifest(
  candidate: VerifiedProcedureLedgerCandidate,
  terminalProofDigest: ToolEffectDigest,
  sourceLineage: VerifiedProcedureMemoryLineageHashes,
): VerifiedProcedureEvidenceManifest {
  return Object.freeze({
    version: VERIFIED_PROCEDURE_EVIDENCE_MANIFEST_VERSION,
    procedureId: candidate.procedureId,
    procedureContractDigest: candidate.procedureContractDigest,
    evidenceId: candidate.evidenceId,
    orderedSteps: Object.freeze(candidate.steps.map(manifestStep)) as unknown as readonly [
      VerifiedProcedureEvidenceManifestStep,
      VerifiedProcedureEvidenceManifestStep,
    ],
    linkageDigest: candidate.linkageDigest,
    sourceLineage: Object.freeze({ ...sourceLineage }),
    terminalProofDigest,
  });
}

function validSourceLineage(value: unknown): value is VerifiedProcedureMemoryLineageHashes {
  if (!isPlainRecord(value) || !hasExactKeys(value, SOURCE_LINEAGE_KEYS)) return false;
  return (
    typeof value.sourceMessageIdHash === 'string' &&
    /^[a-f0-9]{64}$/u.test(value.sourceMessageIdHash) &&
    (value.sourceRunIdHash === null ||
      (typeof value.sourceRunIdHash === 'string' &&
        /^[a-f0-9]{64}$/u.test(value.sourceRunIdHash))) &&
    typeof value.sourceTurnIdHash === 'string' &&
    /^[a-f0-9]{64}$/u.test(value.sourceTurnIdHash) &&
    (value.taskIdHash === null ||
      (typeof value.taskIdHash === 'string' && /^[a-f0-9]{64}$/u.test(value.taskIdHash)))
  );
}

function validManifestStep(value: unknown): value is VerifiedProcedureEvidenceManifestStep {
  if (!isPlainRecord(value) || !hasExactKeys(value, MANIFEST_STEP_KEYS)) return false;
  return (
    typeof value.stepKey === 'string' &&
    VALID_STEP_KEYS.has(value.stepKey) &&
    typeof value.receiptId === 'string' &&
    RECEIPT_ID_PATTERN.test(value.receiptId) &&
    typeof value.contractIdentityDigest === 'string' &&
    SHA256_PATTERN.test(value.contractIdentityDigest) &&
    typeof value.requestDigest === 'string' &&
    SHA256_PATTERN.test(value.requestDigest) &&
    typeof value.resultDigest === 'string' &&
    SHA256_PATTERN.test(value.resultDigest)
  );
}

function hasRegisteredStepOrder(steps: readonly VerifiedProcedureEvidenceManifestStep[]): boolean {
  return (
    (steps[0]?.stepKey === 'calendar-list' && steps[1]?.stepKey === 'calendar-create-event') ||
    (steps[0]?.stepKey === 'calendar-events' && steps[1]?.stepKey === 'calendar-update-event')
  );
}

export function decodeVerifiedProcedureEvidenceManifest(
  value: string,
): VerifiedProcedureEvidenceManifest | null {
  if (value.length < 2 || value.length > VERIFIED_PROCEDURE_MAX_EVIDENCE_MANIFEST_LENGTH)
    return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(value) as unknown;
  } catch {
    return null;
  }
  if (!isPlainRecord(parsed) || !hasExactKeys(parsed, MANIFEST_KEYS)) return null;
  if (
    parsed.version !== VERIFIED_PROCEDURE_EVIDENCE_MANIFEST_VERSION ||
    !isCodeOwnedId(parsed.procedureId) ||
    typeof parsed.procedureContractDigest !== 'string' ||
    !SHA256_PATTERN.test(parsed.procedureContractDigest) ||
    typeof parsed.evidenceId !== 'string' ||
    !SHA256_PATTERN.test(parsed.evidenceId) ||
    !Array.isArray(parsed.orderedSteps) ||
    parsed.orderedSteps.length !== 2 ||
    !parsed.orderedSteps.every(validManifestStep) ||
    !hasRegisteredStepOrder(parsed.orderedSteps) ||
    typeof parsed.linkageDigest !== 'string' ||
    !SHA256_PATTERN.test(parsed.linkageDigest) ||
    !validSourceLineage(parsed.sourceLineage) ||
    typeof parsed.terminalProofDigest !== 'string' ||
    !SHA256_PATTERN.test(parsed.terminalProofDigest)
  ) {
    return null;
  }
  return parsed as unknown as VerifiedProcedureEvidenceManifest;
}
