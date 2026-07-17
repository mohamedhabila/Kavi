// ---------------------------------------------------------------------------
// Kavi — Memory policy gate
// ---------------------------------------------------------------------------
// One small decision surface for long-term memory access. Runtime prompt code,
// tools, lifecycle work, migration, and background jobs should all ask here
// before reading or writing durable memory.
// ---------------------------------------------------------------------------

import { useSettingsStore } from '../../store/useSettingsStore';
import type { MemoryFactScope } from './facts/types';
import { isDurableMemoryPolicyEnabled, setDurableMemoryPolicyEnabled } from './memoryAuthority';

type MemoryOptOutHandler = () => void;

const optOutHandlers = new Set<MemoryOptOutHandler>();
let memoryPolicyEpoch = 0;
let settingsObservationState: 'uninitialized' | 'active' | 'failed' = 'uninitialized';
let unsubscribeSettings: (() => void) | null = null;

function advanceMemoryPolicyEpoch(notifyOptOutHandlers: boolean): void {
  memoryPolicyEpoch += 1;
  if (!notifyOptOutHandlers) return;
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
  if (state.disableLongTermMemory === previousState.disableLongTermMemory) return;
  const disabled = state.disableLongTermMemory === true;
  try {
    setDurableMemoryPolicyEnabled(!disabled);
  } catch {
    settingsObservationState = 'failed';
  }
  advanceMemoryPolicyEpoch(disabled);
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
    const disabled = useSettingsStore.getState().disableLongTermMemory === true;
    if (disabled) {
      setDurableMemoryPolicyEnabled(false);
      advanceMemoryPolicyEpoch(true);
    }
    return true;
  } catch {
    unsubscribeSettings?.();
    unsubscribeSettings = null;
    settingsObservationState = 'failed';
    advanceMemoryPolicyEpoch(true);
    return false;
  }
}

export interface MemoryPolicyContext {
  disableLongTermMemory?: boolean;
  scope?: MemoryFactScope | 'all' | 'daily';
}

function isLocalLongTermMemoryEnabled(context: MemoryPolicyContext = {}): boolean {
  if (context.disableLongTermMemory === true) return false;
  if (settingsObservationState === 'failed') return false;
  try {
    return useSettingsStore.getState().disableLongTermMemory !== true;
  } catch {
    return false;
  }
}

export function isLongTermMemoryEnabled(context: MemoryPolicyContext = {}): boolean {
  return isLocalLongTermMemoryEnabled(context) && isDurableMemoryPolicyEnabled();
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

/** Capture one enabled read generation for a complete prompt-retrieval request. */
export function captureMemoryReadEpoch(): number | null {
  const epoch = memoryPolicyEpoch;
  return canReadLongTermMemory() ? epoch : null;
}

/** A read remains admissible only while its original enabled generation is current. */
export function isMemoryReadEpochCurrent(epoch: number): boolean {
  return (
    Number.isSafeInteger(epoch) &&
    epoch >= 0 &&
    epoch === memoryPolicyEpoch &&
    isLocalLongTermMemoryEnabled()
  );
}

export function isMemoryPolicyEpochCurrent(epoch: number): boolean {
  return (
    epoch === memoryPolicyEpoch && isLocalLongTermMemoryEnabled() && isDurableMemoryPolicyEnabled()
  );
}

export function registerMemoryOptOutHandler(handler: MemoryOptOutHandler): () => void {
  optOutHandlers.add(handler);
  return () => optOutHandlers.delete(handler);
}
