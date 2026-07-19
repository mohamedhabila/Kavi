import type { ToolDefinition } from '../../types/tool';
import { TOOL_DEFINITIONS } from '../tools/definitions';
import { normalizeToolName } from '../tools/toolNameNormalization';
import type { ToolSideEffect } from '../tools/capabilityRegistry';

export type ToolEffectPolicySource = 'builtin' | 'runtime_external' | 'unknown';

export type ToolIdempotencyContract =
  | 'effect_free'
  | 'declared_idempotent'
  | 'not_declared'
  | 'unknown';

export type ToolRetryPolicy =
  | 'replay_safe'
  | 'reconcile_before_retry'
  | 'never_retry_automatically';

export interface ToolEffectPolicy {
  toolName: string;
  source: ToolEffectPolicySource;
  effects: ReadonlyArray<ToolSideEffect | 'unknown'>;
  idempotency: ToolIdempotencyContract;
  retryPolicy: ToolRetryPolicy;
}

const BUILTIN_TOOL_BY_NAME = new Map(
  TOOL_DEFINITIONS.map((tool) => [normalizeToolName(tool.name), tool] as const),
);

const TOOL_SIDE_EFFECTS = new Set<ToolSideEffect>([
  'none',
  'local_artifact',
  'remote_mutation',
  'external_run',
  'destructive',
]);

function resolveCodeOwnedContract(toolName: string): {
  source: 'builtin';
  contract: NonNullable<ToolDefinition['contract']>;
} | null {
  const builtin = BUILTIN_TOOL_BY_NAME.get(toolName);
  if (builtin?.contract) {
    return { source: 'builtin', contract: builtin.contract };
  }

  return null;
}

function hasMutation(effects: ReadonlyArray<ToolSideEffect>): boolean {
  return effects.some((effect) => effect !== 'none');
}

function resolveContractPolicy(
  toolName: string,
  source: Exclude<ToolEffectPolicySource, 'unknown'>,
  contract: ToolDefinition['contract'],
): ToolEffectPolicy {
  const rawEffects = Array.from(new Set(contract?.sideEffects ?? []));
  const effects = rawEffects.filter((effect): effect is ToolSideEffect =>
    TOOL_SIDE_EFFECTS.has(effect as ToolSideEffect),
  );
  if (
    effects.length === 0 ||
    effects.length !== rawEffects.length ||
    (effects.includes('none') && effects.length > 1)
  ) {
    return {
      toolName,
      source,
      effects: ['unknown'],
      idempotency: 'unknown',
      retryPolicy: 'never_retry_automatically',
    };
  }

  if (!hasMutation(effects)) {
    return {
      toolName,
      source,
      effects,
      idempotency: 'effect_free',
      retryPolicy: 'replay_safe',
    };
  }

  const idempotency = contract?.riskHints?.includes('idempotent')
    ? 'declared_idempotent'
    : 'not_declared';
  const retryPolicy = effects.includes('destructive')
    ? 'never_retry_automatically'
    : 'reconcile_before_retry';

  return { toolName, source, effects, idempotency, retryPolicy };
}

export function resolveRuntimeExternalToolEffectPolicy(
  rawToolName: string,
  declaration: ToolDefinition,
  annotationsTrusted: boolean,
): ToolEffectPolicy | undefined {
  const toolName = normalizeToolName(rawToolName);
  if (
    !annotationsTrusted ||
    normalizeToolName(declaration.name) !== toolName ||
    (!toolName.startsWith('mcp__') && !toolName.startsWith('skill__'))
  ) {
    return undefined;
  }
  return resolveContractPolicy(toolName, 'runtime_external', declaration.contract);
}

export function isEffectFreeToolPolicy(policy: ToolEffectPolicy | undefined): boolean {
  return Boolean(
    policy &&
      policy.source !== 'unknown' &&
      policy.effects.length > 0 &&
      policy.effects.every((effect) => effect === 'none'),
  );
}

/**
 * Resolve the default policy only from contracts shipped with the app.
 * Runtime integrations use the separate explicit-trust resolver at the live
 * binding boundary; every other dynamic tool remains unknown and fails closed.
 */
export function resolveToolEffectPolicy(rawToolName: string): ToolEffectPolicy {
  const toolName = normalizeToolName(rawToolName);
  const resolved = resolveCodeOwnedContract(toolName);
  if (!resolved) {
    return {
      toolName,
      source: 'unknown',
      effects: ['unknown'],
      idempotency: 'unknown',
      retryPolicy: 'never_retry_automatically',
    };
  }

  return resolveContractPolicy(toolName, resolved.source, resolved.contract);
}
