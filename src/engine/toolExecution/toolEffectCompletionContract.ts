import { resolveToolEffectPolicy } from '../durability/toolEffectPolicy';
import { normalizeToolName } from '../tools/toolNameNormalization';
import { getCodeOwnedToolEffectContract } from './toolEffectReceiptContracts';

/** A call whose side effects the code-owned contract cannot describe, so it must not run. */
export interface UnsupportedEffectContract {
  toolName: string;
  code: 'effect_contract_unavailable' | 'effect_arguments_invalid';
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function argumentsParse(argumentsText: string): boolean {
  try {
    return isPlainRecord(JSON.parse(argumentsText) as unknown);
  } catch {
    return false;
  }
}

/**
 * Whether a call's effects fall outside what its code-owned contract can account for: a
 * tool declaring effects it has no contract for, or an effectful call whose arguments do
 * not parse. Effect-free, operational and unknown-policy tools always run.
 */
export function resolveUnsupportedEffectContract(params: {
  toolName: string;
  argumentsText: string;
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
  if (contract.completionMode === 'operational') {
    return null;
  }
  if (contract.effectMode !== 'effectful') {
    return { toolName, code: 'effect_contract_unavailable' };
  }
  return argumentsParse(params.argumentsText)
    ? null
    : { toolName, code: 'effect_arguments_invalid' };
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
