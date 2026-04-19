// ---------------------------------------------------------------------------
// Kavi — Context Engine Registry
// ---------------------------------------------------------------------------
// Uses globalThis singleton pattern for consistent registration across bundles

import type { ContextEngine } from './types';

export type ContextEngineFactory = () => ContextEngine | Promise<ContextEngine>;

const REGISTRY_KEY = Symbol.for('kavi.contextEngineRegistry');

type RegistryState = {
  engines: Map<string, ContextEngineFactory>;
};

function getRegistryState(): RegistryState {
  const g = globalThis as typeof globalThis & { [REGISTRY_KEY]?: RegistryState };
  if (!g[REGISTRY_KEY]) {
    g[REGISTRY_KEY] = { engines: new Map() };
  }
  return g[REGISTRY_KEY];
}

export function registerContextEngine(id: string, factory: ContextEngineFactory): void {
  getRegistryState().engines.set(id, factory);
}

export function getContextEngineFactory(id: string): ContextEngineFactory | undefined {
  return getRegistryState().engines.get(id);
}

export function listContextEngineIds(): string[] {
  return [...getRegistryState().engines.keys()];
}

export async function resolveContextEngine(engineId?: string): Promise<ContextEngine> {
  const id = engineId ?? 'default';
  const factory = getRegistryState().engines.get(id);
  if (!factory) {
    throw new Error(
      `Context engine "${id}" is not registered. Available: ${listContextEngineIds().join(', ') || '(none)'}`,
    );
  }
  return factory();
}
