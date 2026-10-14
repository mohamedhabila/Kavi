import { resolveToolEffectPolicy } from '../durability/toolEffectPolicy';
import { normalizeToolName } from '../tools/toolNameNormalization';
import { getCodeOwnedToolEffectContract } from './toolEffectReceiptContracts';

/** A call whose side effects the code-owned contract cannot describe, so it must not run. */
export interface UnsupportedEffectContract {
  toolName: string;
  code: 'effect_contract_unavailable';
}

/**
 * Whether a tool declares effects its code-owned contract cannot account for. Effect-free,
 * operational and unknown-policy tools always run. The call's arguments are not judged
 * here: preflight validates them against the tool's schema and answers a malformed call
 * with what the schema expects.
 */
export function resolveUnsupportedEffectContract(params: {
  toolName: string;
}): UnsupportedEffectContract | null {
  const toolName = normalizeToolName(params.toolName);
  const policy = resolveToolEffectPolicy(toolName);
  if (policy.source === 'unknown' || policy.effects.every((effect) => effect === 'none')) {
    return null;
  }

  const contract = getCodeOwnedToolEffectContract(toolName);
  if (policy.effects.includes('unknown') || !contract) {
    return { toolName, code: 'effect_contract_unavailable' };
  }
  if (contract.completionMode === 'operational' || contract.effectMode === 'effectful') {
    return null;
  }
  return { toolName, code: 'effect_contract_unavailable' };
}

export function buildUnsupportedEffectContractBlock(
  requirement: UnsupportedEffectContract,
): string {
  return JSON.stringify({
    status: 'error',
    code: requirement.code,
    tool: requirement.toolName,
    message:
      'The code-owned effect contract cannot prove this mutation. Do not execute or claim completion.',
  });
}
