export const VERIFIED_PROCEDURE_POLICY_CONTRACT_VERSION = 1 as const;
export const VERIFIED_PROCEDURE_OBSERVATION_RETENTION_MS = 180 * 24 * 60 * 60 * 1_000;
export const VERIFIED_PROCEDURE_MAX_OBSERVATIONS_PER_SCOPE = 64;
export const VERIFIED_PROCEDURE_MAX_OBSERVATIONS_PER_OWNER = 512;
export const VERIFIED_PROCEDURE_PROMOTION_RUN_THRESHOLD = 3;
export const VERIFIED_PROCEDURE_EVIDENCE_MANIFEST_VERSION = 1 as const;
export const VERIFIED_PROCEDURE_MAX_EVIDENCE_MANIFEST_LENGTH = 4_096;

/**
 * Code-owned meaning of one learned procedure generation. Changing any field
 * creates a new descriptor digest, so retained observations cannot silently
 * acquire broader applicability or weaker promotion semantics.
 */
export const VERIFIED_PROCEDURE_POLICY_CONTRACT = Object.freeze({
  version: VERIFIED_PROCEDURE_POLICY_CONTRACT_VERSION,
  applicabilityScope: 'memory-owner-procedure-contract-platform-exact-preconditions' as const,
  provenanceScope: 'memory-conversation-thread-execution-run-source-message-turn-run' as const,
  retentionMs: VERIFIED_PROCEDURE_OBSERVATION_RETENTION_MS,
  maximumObservationsPerScope: VERIFIED_PROCEDURE_MAX_OBSERVATIONS_PER_SCOPE,
  maximumObservationsPerOwner: VERIFIED_PROCEDURE_MAX_OBSERVATIONS_PER_OWNER,
  promotion: Object.freeze({
    requiredDistinctVerifiedRuns: VERIFIED_PROCEDURE_PROMOTION_RUN_THRESHOLD,
    duplicateRunEvidence: 'unchanged' as const,
  }),
  invalidation: Object.freeze({
    authority: 'explicit-code-owned-reconciliation-or-withdrawal-only' as const,
    effect: 'withdraw-derived-observations' as const,
  }),
  evidenceManifestVersion: VERIFIED_PROCEDURE_EVIDENCE_MANIFEST_VERSION,
  maximumEvidenceManifestLength: VERIFIED_PROCEDURE_MAX_EVIDENCE_MANIFEST_LENGTH,
});
