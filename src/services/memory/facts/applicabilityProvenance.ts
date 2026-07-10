import { isExactMemoryScopeId } from '../memoryScopeIdentity';

export const MEMORY_FACT_REVIEW_STATES = [
  'auto',
  'verified',
  'pending_review',
  'stale',
  'conflicted',
  'rejected',
] as const;
export type MemoryFactReviewState = (typeof MEMORY_FACT_REVIEW_STATES)[number];

export const MEMORY_FACT_SENSITIVITY_LEVELS = [
  'normal',
  'personal',
  'sensitive',
  'restricted',
] as const;
export type MemoryFactSensitivity = (typeof MEMORY_FACT_SENSITIVITY_LEVELS)[number];

export const MEMORY_FACT_CLASSES = ['subjective_user', 'objective', 'workflow', 'unknown'] as const;
export type MemoryFactClass = (typeof MEMORY_FACT_CLASSES)[number];

export const MEMORY_SOURCE_AUTHORITIES = [
  'grounded_user',
  'tool_observed',
  'external_source',
  'assistant_inferred',
  'unknown',
] as const;
export type MemorySourceAuthority = (typeof MEMORY_SOURCE_AUTHORITIES)[number];

export interface SealedFactApplicabilityProvenance {
  /** Classification admitted by product code, never copied from model attributes. */
  factClass: MemoryFactClass;
  /** Evidence authority admitted by product code. */
  sourceAuthority: MemorySourceAuthority;
  /** Required only for persona-scoped facts. */
  personaId?: string;
}

const WORKFLOW_MEMORY_KINDS = new Set([
  'episodic_event',
  'goal',
  'tool_result',
  'decision',
  'risk',
  'artifact',
  'summary',
  'evidence_span',
  'agent_run',
  'gotcha',
]);

export function closedMemoryFactReviewState(value: unknown): MemoryFactReviewState | null {
  return typeof value === 'string' &&
    MEMORY_FACT_REVIEW_STATES.includes(value as MemoryFactReviewState)
    ? (value as MemoryFactReviewState)
    : null;
}

export function closedMemoryFactSensitivity(value: unknown): MemoryFactSensitivity | null {
  return typeof value === 'string' &&
    MEMORY_FACT_SENSITIVITY_LEVELS.includes(value as MemoryFactSensitivity)
    ? (value as MemoryFactSensitivity)
    : null;
}

export function closedMemoryFactClass(value: unknown): MemoryFactClass | null {
  return typeof value === 'string' && MEMORY_FACT_CLASSES.includes(value as MemoryFactClass)
    ? (value as MemoryFactClass)
    : null;
}

export function closedMemorySourceAuthority(value: unknown): MemorySourceAuthority | null {
  return typeof value === 'string' &&
    MEMORY_SOURCE_AUTHORITIES.includes(value as MemorySourceAuthority)
    ? (value as MemorySourceAuthority)
    : null;
}

export function requireMemoryFactReviewState(
  value: unknown,
  code = 'memory_fact_review_state_invalid',
): MemoryFactReviewState {
  const closed = closedMemoryFactReviewState(value);
  if (!closed) throw new Error(code);
  return closed;
}

export function requireMemoryFactSensitivity(
  value: unknown,
  code = 'memory_fact_sensitivity_invalid',
): MemoryFactSensitivity {
  const closed = closedMemoryFactSensitivity(value);
  if (!closed) throw new Error(code);
  return closed;
}

export interface ResolvedFactApplicabilityProvenance {
  factClass: MemoryFactClass;
  sourceAuthority: MemorySourceAuthority;
  personaId: string | null;
}

/**
 * Seal provenance at the persistence boundary. Defaults derive only from
 * structural, code-owned fields; arbitrary fact attributes are never read.
 */
export function resolveFactApplicabilityProvenance(input: {
  scope: string;
  memoryKind: string;
  sealed?: SealedFactApplicabilityProvenance;
}): ResolvedFactApplicabilityProvenance {
  const sealedClass = input.sealed ? closedMemoryFactClass(input.sealed.factClass) : null;
  const sealedAuthority = input.sealed
    ? closedMemorySourceAuthority(input.sealed.sourceAuthority)
    : null;
  if (input.sealed && (!sealedClass || !sealedAuthority)) {
    throw new Error('memory_fact_provenance_invalid');
  }

  const personaId = input.sealed?.personaId ?? null;
  if (input.scope === 'persona') {
    if (!isExactMemoryScopeId(personaId)) {
      throw new Error('memory_fact_persona_id_required');
    }
  } else if (personaId !== null && personaId !== undefined) {
    throw new Error('memory_fact_persona_id_out_of_scope');
  }

  return {
    factClass:
      sealedClass ?? (WORKFLOW_MEMORY_KINDS.has(input.memoryKind) ? 'workflow' : 'unknown'),
    sourceAuthority: sealedAuthority ?? 'unknown',
    personaId: personaId ?? null,
  };
}
