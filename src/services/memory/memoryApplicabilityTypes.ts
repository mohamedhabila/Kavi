import type { RequiredMemoryAccessScopeIdentity } from './memoryScopeIdentity';
import type { MemoryFactClass, MemorySourceAuthority } from './facts/applicabilityProvenance';

export {
  MEMORY_FACT_CLASSES,
  MEMORY_FACT_REVIEW_STATES,
  MEMORY_FACT_SENSITIVITY_LEVELS,
  MEMORY_SOURCE_AUTHORITIES,
} from './facts/applicabilityProvenance';
export type {
  MemoryFactClass,
  MemoryFactReviewState,
  MemoryFactSensitivity,
  MemorySourceAuthority,
  SealedFactApplicabilityProvenance,
} from './facts/applicabilityProvenance';

export const MEMORY_APPLICABILITY_ACTIONS = ['use', 'ask', 'abstain', 'silent'] as const;
export type MemoryApplicabilityAction = (typeof MEMORY_APPLICABILITY_ACTIONS)[number];

export const MEMORY_APPLICABILITY_REASONS = [
  'eligible',
  'memory_disabled',
  'deleted',
  'not_yet_valid',
  'invalidated',
  'expired',
  'scope_context_missing',
  'owner_binding_missing',
  'owner_mismatch',
  'unknown_scope',
  'scope_mismatch',
  'persona_binding_missing',
  'persona_mismatch',
  'unknown_fact_class',
  'unknown_source_authority',
  'rejected_review',
  'unknown_review_state',
  'restricted_sensitivity',
  'unknown_sensitivity',
  'sensitive_proactive_suppressed',
  'sensitive_confirmation_required',
  'pending_review',
  'stale_memory',
  'low_confidence',
  'stored_conflict',
  'conflicting_current_memories',
  'external_conflict_needs_clarification',
  'objective_stored_conflict',
  'objective_current_conflict',
  'objective_external_conflict',
  'objective_authority_insufficient',
  'subjective_authority_confirmation_required',
  'workflow_authority_confirmation_required',
  'invalid_external_evidence',
  'conflict_observation_read_failed',
] as const;
export type MemoryApplicabilityReason = (typeof MEMORY_APPLICABILITY_REASONS)[number];

export type MemoryApplicabilityUseIntent = 'automatic_prompt' | 'explicit_user_request';

export const MEMORY_EVIDENCE_SOURCE_KINDS = [
  'user_message',
  'tool_run',
  'external_record',
] as const;
export type MemoryEvidenceSourceKind = (typeof MEMORY_EVIDENCE_SOURCE_KINDS)[number];

export interface MemoryExternalEvidenceSignal {
  factId: string;
  relation: 'supports' | 'conflicts';
  factClass: MemoryFactClass;
  sourceAuthority: MemorySourceAuthority;
  sourceKind: MemoryEvidenceSourceKind;
  sourceId: string;
  observedAt: number;
}

export interface MemoryApplicabilityContext {
  enabled: boolean;
  now: number;
  useIntent: MemoryApplicabilityUseIntent;
  /** Fully validated, code-owned access identity. Missing identity fails closed. */
  scope: RequiredMemoryAccessScopeIdentity | null;
  /** Persisted contradiction evidence must be readable before facts can be used. */
  conflictObservationReadState: 'available' | 'failed';
  /** Current structured evidence supplied by trusted caller code, never inferred from text. */
  externalEvidence?: ReadonlyArray<MemoryExternalEvidenceSignal>;
}

export interface MemoryApplicabilityAnnotation {
  action: Exclude<MemoryApplicabilityAction, 'silent'>;
  reason: MemoryApplicabilityReason;
}

export interface MemoryFactApplicabilityDecision {
  factId: string;
  factClass: MemoryFactClass;
  sourceAuthority: MemorySourceAuthority;
  action: MemoryApplicabilityAction;
  reason: MemoryApplicabilityReason;
}

export type MemoryApplicabilityReasonCount = Readonly<{
  reason: MemoryApplicabilityReason;
  count: number;
}>;

export interface MemoryApplicabilitySummary {
  state: 'applied' | 'disabled' | 'degraded';
  candidateFactCount: number;
  promptVisibleFactCount: number;
  promptBudgetDroppedFactCount: number;
  factActions: Readonly<Record<MemoryApplicabilityAction, number>>;
  reasonCounts: ReadonlyArray<MemoryApplicabilityReasonCount>;
}
