import {
  buildDurableModelEffectAuthority,
  buildModelTurnMemoryPolicyBinding,
  type DurableModelEffectAuthority,
  type ModelTurnMemoryPolicyBinding,
} from '../../src/engine/authority/modelTurnMemoryPolicyBinding';
import { captureMemoryAuthoritySnapshot } from '../../src/services/memory/memoryAuthority';
import { captureMemoryReadEpoch } from '../../src/services/memory/policy';

export function captureCurrentModelTurnMemoryFence() {
  const readEpoch = captureMemoryReadEpoch();
  const memoryAuthoritySnapshot = captureMemoryAuthoritySnapshot();
  if (readEpoch === null || !memoryAuthoritySnapshot) {
    throw new Error(
      `expected current model-turn memory authority (read=${readEpoch !== null}, authority=${Boolean(memoryAuthoritySnapshot)})`,
    );
  }
  return { readEpoch, memoryAuthoritySnapshot } as const;
}

export function buildCurrentModelTurnMemoryPolicyBinding(): ModelTurnMemoryPolicyBinding {
  return buildModelTurnMemoryPolicyBinding(captureCurrentModelTurnMemoryFence());
}

export function buildCurrentDurableModelEffectAuthority(): DurableModelEffectAuthority {
  return buildDurableModelEffectAuthority(buildCurrentModelTurnMemoryPolicyBinding());
}
