import { SUPER_AGENT_PERSONA_ID } from './personas';

export type ContextAccessMode = 'chat' | 'agentic' | 'pilot';

export interface PersonaContextPolicy {
  hardIdleCutoffMs: number;
  semanticSimilarityThreshold: number;
  minRecentUserTurns: number;
  maxCarryoverUserTurns: number;
  recallLimit: number;
  allowCrossTopicCarryover: boolean;
}

const HOUR_MS = 60 * 60 * 1000;

const BASE_POLICY: PersonaContextPolicy = {
  hardIdleCutoffMs: 5 * HOUR_MS,
  semanticSimilarityThreshold: 0.2,
  minRecentUserTurns: 1,
  maxCarryoverUserTurns: 4,
  recallLimit: 6,
  allowCrossTopicCarryover: false,
};

const POLICY_OVERRIDES: Record<string, Partial<PersonaContextPolicy>> = {
  default: {
    maxCarryoverUserTurns: 4,
    recallLimit: 6,
  },
  coder: {
    semanticSimilarityThreshold: 0.15,
    maxCarryoverUserTurns: 5,
    recallLimit: 8,
  },
  researcher: {
    semanticSimilarityThreshold: 0.12,
    maxCarryoverUserTurns: 6,
    recallLimit: 10,
  },
  writer: {
    semanticSimilarityThreshold: 0.18,
    maxCarryoverUserTurns: 4,
    recallLimit: 6,
  },
  planner: {
    semanticSimilarityThreshold: 0.16,
    maxCarryoverUserTurns: 5,
    recallLimit: 8,
  },
  [SUPER_AGENT_PERSONA_ID]: {
    semanticSimilarityThreshold: 0.15,
    maxCarryoverUserTurns: 5,
    recallLimit: 8,
  },
};

function applyModeAdjustments(
  policy: PersonaContextPolicy,
  mode: ContextAccessMode,
): PersonaContextPolicy {
  if (mode === 'pilot') {
    return {
      ...policy,
      hardIdleCutoffMs: Math.min(policy.hardIdleCutoffMs, 3 * HOUR_MS),
      semanticSimilarityThreshold: Math.max(policy.semanticSimilarityThreshold, 0.2),
      minRecentUserTurns: Math.max(policy.minRecentUserTurns, 1),
      maxCarryoverUserTurns: Math.min(policy.maxCarryoverUserTurns, 4),
      allowCrossTopicCarryover: false,
    };
  }

  if (mode === 'agentic') {
    return {
      ...policy,
      minRecentUserTurns: Math.max(policy.minRecentUserTurns, 2),
      maxCarryoverUserTurns: Math.max(policy.maxCarryoverUserTurns, 5),
    };
  }

  return policy;
}

export function resolvePersonaContextPolicy(
  personaId: string | undefined,
  mode: ContextAccessMode,
): PersonaContextPolicy {
  const normalizedPersonaId = personaId?.trim() || 'default';
  const merged: PersonaContextPolicy = {
    ...BASE_POLICY,
    ...(POLICY_OVERRIDES[normalizedPersonaId] ?? {}),
  };

  return applyModeAdjustments(merged, mode);
}
