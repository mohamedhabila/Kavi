// ---------------------------------------------------------------------------
// Kavi — Memory policy gate
// ---------------------------------------------------------------------------
// One small decision surface for long-term memory access. Runtime prompt code,
// tools, lifecycle work, migration, and background jobs should all ask here
// before reading or writing durable memory.
// ---------------------------------------------------------------------------

import { useSettingsStore } from '../../store/useSettingsStore';
import type { MemoryFactScope } from './facts';

export interface MemoryPolicyContext {
  disableLongTermMemory?: boolean;
  scope?: MemoryFactScope | 'all' | 'daily';
}

export function isLongTermMemoryEnabled(context: MemoryPolicyContext = {}): boolean {
  if (context.disableLongTermMemory === true) return false;
  try {
    return useSettingsStore.getState().disableLongTermMemory !== true;
  } catch {
    return true;
  }
}

export function canReadLongTermMemory(context: MemoryPolicyContext = {}): boolean {
  return isLongTermMemoryEnabled(context);
}

export function canWriteLongTermMemory(context: MemoryPolicyContext = {}): boolean {
  return isLongTermMemoryEnabled(context);
}

export function canUseNetworkMemoryProvider(context: MemoryPolicyContext = {}): boolean {
  return isLongTermMemoryEnabled(context);
}
