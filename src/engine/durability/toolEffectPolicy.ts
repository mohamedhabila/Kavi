import type { ToolDefinition } from '../../types/tool';
import { getGitHubToolContract } from '../../services/integrations/github/toolContracts';
import { TOOL_DEFINITIONS } from '../tools/definitions';
import { normalizeToolName } from '../tools/toolNameNormalization';
import type { ToolSideEffect } from '../tools/capabilityRegistry';

export type ToolEffectPolicySource = 'builtin' | 'github_skill' | 'unknown';

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
  source: Exclude<ToolEffectPolicySource, 'unknown'>;
  contract: NonNullable<ToolDefinition['contract']>;
} | null {
  const builtin = BUILTIN_TOOL_BY_NAME.get(toolName);
  if (builtin?.contract) {
    return { source: 'builtin', contract: builtin.contract };
  }

  const [source, namespace, leafName, ...remainder] = toolName.split('__');
  if (source !== 'skill' || namespace !== 'github' || !leafName || remainder.length > 0) {
    return null;
  }

  const contract = getGitHubToolContract(leafName);
  return contract ? { source: 'github_skill', contract } : null;
}

function hasMutation(effects: ReadonlyArray<ToolSideEffect>): boolean {
  return effects.some((effect) => effect !== 'none');
}

/**
 * Resolve retry semantics only from contracts shipped with the app. Dynamic
 * MCP and third-party skill metadata is deliberately not trusted for retries:
 * an unknown tool must be reconciled by a future journal or fail closed.
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

  const rawEffects = Array.from(new Set(resolved.contract.sideEffects ?? []));
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
      source: resolved.source,
      effects: ['unknown'],
      idempotency: 'unknown',
      retryPolicy: 'never_retry_automatically',
    };
  }

  if (!hasMutation(effects)) {
    return {
      toolName,
      source: resolved.source,
      effects,
      idempotency: 'effect_free',
      retryPolicy: 'replay_safe',
    };
  }

  const idempotency = resolved.contract.riskHints?.includes('idempotent')
    ? 'declared_idempotent'
    : 'not_declared';
  const retryPolicy = effects.includes('destructive')
    ? 'never_retry_automatically'
    : 'reconcile_before_retry';

  return {
    toolName,
    source: resolved.source,
    effects,
    idempotency,
    retryPolicy,
  };
}
