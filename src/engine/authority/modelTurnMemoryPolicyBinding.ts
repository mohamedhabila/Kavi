import { isMemoryReadEpochCurrent } from '../../services/memory/policy';
import {
  isRestrictiveVerifiedProcedureAuthorityProcessEpochCurrent,
  isVerifiedProcedureAuthoritySnapshotShape,
  isVerifiedProcedureRestrictiveAuthorityRevisionDurablyCurrent,
  type VerifiedProcedureAuthoritySnapshot,
  type VerifiedProcedureRestrictiveAuthorityRevision,
} from '../../services/memory/verifiedProcedure/observationAuthority';
import {
  isRestrictiveMemoryAuthoritySnapshotCurrent,
  isRestrictiveMemoryAuthoritySnapshotDurablyCurrent,
  type MemoryAuthoritySnapshot,
} from '../../services/memory/memoryAuthority';
import {
  isMemoryValidityDeadlineCurrent,
  isMemoryValidityTimestamp,
} from '../../services/memory/memoryValidityDeadline';

const MEMORY_PROMPT_EPOCH_EXPIRED = 'memory_prompt_epoch_expired';

export type ModelTurnMemoryPolicyBinding =
  | Readonly<{ kind: 'policy_independent' }>
  | Readonly<{
      kind: 'memory_epoch';
      readEpoch: number;
      memoryAuthoritySnapshot: MemoryAuthoritySnapshot;
      validUntil?: number;
      verifiedProcedureRestrictiveAuthority?: Readonly<{
        processEpoch: number;
        revision: VerifiedProcedureRestrictiveAuthorityRevision;
      }>;
    }>;

export type DurableModelEffectAuthority =
  | Readonly<{ kind: 'policy_independent' }>
  | Readonly<{
      kind: 'memory_epoch';
      memoryOwnerId: string;
      restrictiveRevision: number;
      memoryPolicyRevision: number;
      verifiedProcedureRestrictiveRevision: number | null;
      validUntil: number | null;
    }>;

export const POLICY_INDEPENDENT_MODEL_TURN_MEMORY_BINDING: ModelTurnMemoryPolicyBinding =
  Object.freeze({ kind: 'policy_independent' });

const POLICY_INDEPENDENT_DURABLE_MODEL_EFFECT_AUTHORITY: DurableModelEffectAuthority =
  Object.freeze({ kind: 'policy_independent' });

export class MemoryPromptEpochExpiredError extends Error {
  constructor() {
    super(MEMORY_PROMPT_EPOCH_EXPIRED);
    this.name = 'MemoryPromptEpochExpiredError';
  }
}

export function isMemoryPromptEpochExpiredError(error: unknown): boolean {
  return error instanceof MemoryPromptEpochExpiredError;
}

export function buildModelTurnMemoryPolicyBinding(
  fence:
    | {
        readEpoch: number;
        memoryAuthoritySnapshot: MemoryAuthoritySnapshot;
        validUntil?: number;
        verifiedProcedureAuthoritySnapshot?: VerifiedProcedureAuthoritySnapshot;
      }
    | undefined,
): ModelTurnMemoryPolicyBinding {
  if (!fence) return POLICY_INDEPENDENT_MODEL_TURN_MEMORY_BINDING;
  if (fence.validUntil !== undefined && !isMemoryValidityTimestamp(fence.validUntil)) {
    throw new Error('model_turn_memory_validity_deadline_invalid');
  }
  if (
    fence.verifiedProcedureAuthoritySnapshot !== undefined &&
    !isVerifiedProcedureAuthoritySnapshotShape(fence.verifiedProcedureAuthoritySnapshot)
  ) {
    throw new Error('model_turn_verified_procedure_authority_invalid');
  }
  const procedureSnapshot = fence.verifiedProcedureAuthoritySnapshot;
  return Object.freeze({
    kind: 'memory_epoch',
    readEpoch: fence.readEpoch,
    memoryAuthoritySnapshot: Object.freeze({
      processEpochs: Object.freeze({ ...fence.memoryAuthoritySnapshot.processEpochs }),
      restrictiveRevision: Object.freeze({
        ...fence.memoryAuthoritySnapshot.restrictiveRevision,
      }),
      projectionRevision: Object.freeze({ ...fence.memoryAuthoritySnapshot.projectionRevision }),
      policy: Object.freeze({ ...fence.memoryAuthoritySnapshot.policy }),
    }),
    ...(fence.validUntil === undefined ? {} : { validUntil: fence.validUntil }),
    ...(procedureSnapshot === undefined
      ? {}
      : {
          verifiedProcedureRestrictiveAuthority: Object.freeze({
            processEpoch: procedureSnapshot.processEpochs.restrictive,
            revision: Object.freeze({ ...procedureSnapshot.restrictiveRevision }),
          }),
        }),
  });
}

/** Closed durable fields used to authorize one model-derived irreversible effect. */
export function buildDurableModelEffectAuthority(
  binding: ModelTurnMemoryPolicyBinding,
): DurableModelEffectAuthority {
  if (binding.kind === 'policy_independent') {
    return POLICY_INDEPENDENT_DURABLE_MODEL_EFFECT_AUTHORITY;
  }
  const { restrictiveRevision, policy } = binding.memoryAuthoritySnapshot;
  const procedureAuthority = binding.verifiedProcedureRestrictiveAuthority;
  if (
    !restrictiveRevision.memoryOwnerId ||
    !Number.isSafeInteger(restrictiveRevision.value) ||
    restrictiveRevision.value < 0 ||
    policy.enabled !== true ||
    !Number.isSafeInteger(policy.revision) ||
    policy.revision < 0 ||
    (binding.validUntil !== undefined && !isMemoryValidityTimestamp(binding.validUntil)) ||
    (procedureAuthority !== undefined &&
      (procedureAuthority.revision.kind !== 'restrictive' ||
        procedureAuthority.revision.memoryOwnerId !== restrictiveRevision.memoryOwnerId ||
        !Number.isSafeInteger(procedureAuthority.processEpoch) ||
        procedureAuthority.processEpoch < 0 ||
        !Number.isSafeInteger(procedureAuthority.revision.value) ||
        procedureAuthority.revision.value < 0))
  ) {
    throw new Error('model_effect_memory_authority_invalid');
  }
  return Object.freeze({
    kind: 'memory_epoch',
    memoryOwnerId: restrictiveRevision.memoryOwnerId,
    restrictiveRevision: restrictiveRevision.value,
    memoryPolicyRevision: policy.revision,
    verifiedProcedureRestrictiveRevision: procedureAuthority?.revision.value ?? null,
    validUntil: binding.validUntil ?? null,
  });
}

export function serializeDurableModelEffectAuthority(
  authority: DurableModelEffectAuthority,
): string {
  return authority.kind === 'policy_independent'
    ? 'policy_independent'
    : [
        'memory_epoch_v3',
        authority.memoryOwnerId,
        authority.restrictiveRevision,
        authority.memoryPolicyRevision,
        authority.verifiedProcedureRestrictiveRevision ?? '',
        authority.validUntil ?? '',
      ].join('\u0000');
}

export function isModelTurnMemoryPolicyBindingCurrent(
  binding: ModelTurnMemoryPolicyBinding,
  now = Date.now(),
): boolean {
  if (binding.kind === 'policy_independent') return true;
  return (
    isMemoryReadEpochCurrent(binding.readEpoch) &&
    isMemoryValidityDeadlineCurrent(binding.validUntil, now) &&
    isRestrictiveMemoryAuthoritySnapshotCurrent(binding.memoryAuthoritySnapshot) &&
    (binding.verifiedProcedureRestrictiveAuthority === undefined ||
      isRestrictiveVerifiedProcedureAuthorityProcessEpochCurrent(
        binding.verifiedProcedureRestrictiveAuthority.processEpoch,
      ))
  );
}

export function isModelTurnMemoryPolicyBindingDurablyCurrent(
  binding: ModelTurnMemoryPolicyBinding,
  now = Date.now(),
): boolean {
  if (!isModelTurnMemoryPolicyBindingCurrent(binding, now)) return false;
  if (binding.kind === 'policy_independent') return true;
  return (
    isRestrictiveMemoryAuthoritySnapshotDurablyCurrent(binding.memoryAuthoritySnapshot) &&
    (binding.verifiedProcedureRestrictiveAuthority === undefined ||
      isVerifiedProcedureRestrictiveAuthorityRevisionDurablyCurrent(
        binding.verifiedProcedureRestrictiveAuthority.revision,
      ))
  );
}

export function assertModelTurnMemoryPolicyBindingCurrent(
  binding: ModelTurnMemoryPolicyBinding,
  now = Date.now(),
): void {
  if (!isModelTurnMemoryPolicyBindingCurrent(binding, now)) {
    throw new MemoryPromptEpochExpiredError();
  }
}

export function assertModelTurnMemoryPolicyBindingDurablyCurrent(
  binding: ModelTurnMemoryPolicyBinding,
  now = Date.now(),
): void {
  if (!isModelTurnMemoryPolicyBindingDurablyCurrent(binding, now)) {
    throw new MemoryPromptEpochExpiredError();
  }
}

export function buildModelTurnMemoryPolicyExpiredToolResult(): string {
  return JSON.stringify({
    status: 'rejected',
    ok: false,
    code: 'model_turn_memory_epoch_expired',
    retryAllowed: false,
    replanRequired: true,
  });
}
