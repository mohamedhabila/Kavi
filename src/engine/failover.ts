// ---------------------------------------------------------------------------
// Kavi — Model Failover Chain
// ---------------------------------------------------------------------------

import { LlmProviderConfig } from '../types';

export interface FailoverEntry {
  providerId: string;
  model: string;
  priority: number;
}

export interface FailoverState {
  chain: FailoverEntry[];
  currentIndex: number;
  failures: Map<string, { count: number; lastFailure: number; backoffMs: number }>;
}

interface ActiveFailoverSelection {
  providerId?: string | null;
  model?: string | null;
}

function normalizeProviderModels(provider: LlmProviderConfig): string[] {
  const explicit = provider.availableModels || [];
  const legacy = Array.isArray((provider as any).models) ? (provider as any).models : [];
  return Array.from(new Set([provider.model, ...explicit, ...legacy])).filter(
    (model): model is string => typeof model === 'string' && model.trim().length > 0,
  );
}

const MAX_BACKOFF_MS = 60000;
const BASE_BACKOFF_MS = 1000;

export function createFailoverState(
  chain: FailoverEntry[],
  activeSelection?: ActiveFailoverSelection,
): FailoverState {
  const sortedChain = chain.sort((a, b) => a.priority - b.priority);
  const activeProviderId =
    typeof activeSelection?.providerId === 'string' ? activeSelection.providerId.trim() : '';
  const activeModel =
    typeof activeSelection?.model === 'string' ? activeSelection.model.trim() : '';
  const currentIndex =
    activeProviderId && activeModel
      ? Math.max(
          0,
          sortedChain.findIndex(
            (entry) => entry.providerId === activeProviderId && entry.model === activeModel,
          ),
        )
      : 0;

  return {
    chain: sortedChain,
    currentIndex,
    failures: new Map(),
  };
}

export function buildFailoverChain(
  providers: LlmProviderConfig[],
  activeSelection?: ActiveFailoverSelection,
): FailoverEntry[] {
  const activeProviderId =
    typeof activeSelection?.providerId === 'string' ? activeSelection.providerId.trim() : '';
  const activeModel =
    typeof activeSelection?.model === 'string' ? activeSelection.model.trim() : '';

  return providers
    .filter((p) => p.enabled)
    .flatMap((p, i) => {
      if (!activeModel) {
        return [
          {
            providerId: p.id,
            model: p.model,
            priority: i,
          },
        ];
      }

      if (p.id === activeProviderId) {
        return [
          {
            providerId: p.id,
            model: activeModel,
            priority: i,
          },
        ];
      }

      const availableModels = normalizeProviderModels(p);
      if (!availableModels.includes(activeModel)) {
        return [];
      }

      return [
        {
          providerId: p.id,
          model: activeModel,
          priority: i,
        },
      ];
    });
}

export function getNextAvailableModel(state: FailoverState): FailoverEntry | null {
  const now = Date.now();

  for (let i = 0; i < state.chain.length; i++) {
    const idx = (state.currentIndex + i) % state.chain.length;
    const entry = state.chain[idx];
    const key = `${entry.providerId}:${entry.model}`;
    const failure = state.failures.get(key);

    if (failure && now - failure.lastFailure < failure.backoffMs) {
      continue; // Still in backoff
    }

    state.currentIndex = idx;
    return entry;
  }

  return null; // All models in backoff
}

export function recordFailure(state: FailoverState, providerId: string, model: string): void {
  const key = `${providerId}:${model}`;
  const existing = state.failures.get(key);
  const count = (existing?.count ?? 0) + 1;
  const backoffMs = Math.min(BASE_BACKOFF_MS * Math.pow(2, count - 1), MAX_BACKOFF_MS);

  state.failures.set(key, {
    count,
    lastFailure: Date.now(),
    backoffMs,
  });

  // Move to next provider
  state.currentIndex = (state.currentIndex + 1) % state.chain.length;
}

export function recordSuccess(state: FailoverState, providerId: string, model: string): void {
  const key = `${providerId}:${model}`;
  state.failures.delete(key);
}
