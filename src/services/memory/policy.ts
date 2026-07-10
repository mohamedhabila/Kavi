// ---------------------------------------------------------------------------
// Kavi — Memory policy gate
// ---------------------------------------------------------------------------
// One small decision surface for long-term memory access. Runtime prompt code,
// tools, lifecycle work, migration, and background jobs should all ask here
// before reading or writing durable memory.
// ---------------------------------------------------------------------------

import { useSettingsStore } from '../../store/useSettingsStore';
import type { MemoryFactScope } from './facts/types';

type MemoryOptOutHandler = () => void;

const optOutHandlers = new Set<MemoryOptOutHandler>();
let memoryPolicyEpoch = 0;
let settingsObservationState: 'uninitialized' | 'active' | 'failed' = 'uninitialized';
let unsubscribeSettings: (() => void) | null = null;

function invalidateMemoryPolicy(): void {
  memoryPolicyEpoch += 1;
  for (const handler of optOutHandlers) {
    try {
      handler();
    } catch {
      // Privacy setting changes must not be blocked by cleanup failures.
    }
  }
}

function observeMemoryPolicyChange(
  state: ReturnType<typeof useSettingsStore.getState>,
  previousState: ReturnType<typeof useSettingsStore.getState>,
): void {
  if (state.disableLongTermMemory !== true || previousState.disableLongTermMemory === true) {
    return;
  }
  invalidateMemoryPolicy();
}

/**
 * Start the settings observer explicitly from app startup. Importing memory
 * helpers must remain side-effect free so tools and tests can load policy code
 * without constructing the entire settings runtime.
 */
export function initializeMemoryPolicyObservation(): boolean {
  if (settingsObservationState === 'active') return true;
  if (settingsObservationState === 'failed') return false;

  try {
    const unsubscribe = useSettingsStore.subscribe(observeMemoryPolicyChange);
    if (typeof unsubscribe !== 'function') {
      throw new Error('memory_policy_subscription_invalid');
    }
    unsubscribeSettings = unsubscribe;
    settingsObservationState = 'active';
    if (useSettingsStore.getState().disableLongTermMemory === true) {
      invalidateMemoryPolicy();
    }
    return true;
  } catch {
    unsubscribeSettings?.();
    unsubscribeSettings = null;
    settingsObservationState = 'failed';
    invalidateMemoryPolicy();
    return false;
  }
}

export interface MemoryPolicyContext {
  disableLongTermMemory?: boolean;
  scope?: MemoryFactScope | 'all' | 'daily';
}

export function isLongTermMemoryEnabled(context: MemoryPolicyContext = {}): boolean {
  if (context.disableLongTermMemory === true) return false;
  if (settingsObservationState === 'failed') return false;
  try {
    return useSettingsStore.getState().disableLongTermMemory !== true;
  } catch {
    return false;
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

/** Monotonic cancellation epoch; an opt-out invalidates work started in any earlier epoch. */
export function getMemoryPolicyEpoch(): number {
  return memoryPolicyEpoch;
}

export function isMemoryPolicyEpochCurrent(epoch: number): boolean {
  return epoch === memoryPolicyEpoch && canWriteLongTermMemory();
}

export function registerMemoryOptOutHandler(handler: MemoryOptOutHandler): () => void {
  optOutHandlers.add(handler);
  return () => optOutHandlers.delete(handler);
}
