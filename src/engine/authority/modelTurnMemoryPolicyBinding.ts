import { isMemoryReadEpochCurrent } from '../../services/memory/policy';
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
    }>;

export type DurableModelEffectAuthority =
  | Readonly<{ kind: 'policy_independent' }>
  | Readonly<{
      kind: 'memory_epoch';
      memoryOwnerId: string;
      restrictiveRevision: number;
      memoryPolicyRevision: number;
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
      }
    | undefined,
): ModelTurnMemoryPolicyBinding {
  if (!fence) return POLICY_INDEPENDENT_MODEL_TURN_MEMORY_BINDING;
  if (fence.validUntil !== undefined && !isMemoryValidityTimestamp(fence.validUntil)) {
    throw new Error('model_turn_memory_validity_deadline_invalid');
  }
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
  if (
    !restrictiveRevision.memoryOwnerId ||
    !Number.isSafeInteger(restrictiveRevision.value) ||
    restrictiveRevision.value < 0 ||
    policy.enabled !== true ||
    !Number.isSafeInteger(policy.revision) ||
    policy.revision < 0 ||
    (binding.validUntil !== undefined && !isMemoryValidityTimestamp(binding.validUntil))
  ) {
    throw new Error('model_effect_memory_authority_invalid');
  }
  return Object.freeze({
    kind: 'memory_epoch',
    memoryOwnerId: restrictiveRevision.memoryOwnerId,
    restrictiveRevision: restrictiveRevision.value,
    memoryPolicyRevision: policy.revision,
    validUntil: binding.validUntil ?? null,
  });
}

export function serializeDurableModelEffectAuthority(
  authority: DurableModelEffectAuthority,
): string {
  return authority.kind === 'policy_independent'
    ? 'policy_independent'
    : [
        'memory_epoch_v4',
        authority.memoryOwnerId,
        authority.restrictiveRevision,
        authority.memoryPolicyRevision,
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
    isRestrictiveMemoryAuthoritySnapshotCurrent(binding.memoryAuthoritySnapshot)
  );
}

export function isModelTurnMemoryPolicyBindingDurablyCurrent(
  binding: ModelTurnMemoryPolicyBinding,
  now = Date.now(),
): boolean {
  if (!isModelTurnMemoryPolicyBindingCurrent(binding, now)) return false;
  if (binding.kind === 'policy_independent') return true;
  return isRestrictiveMemoryAuthoritySnapshotDurablyCurrent(binding.memoryAuthoritySnapshot);
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
