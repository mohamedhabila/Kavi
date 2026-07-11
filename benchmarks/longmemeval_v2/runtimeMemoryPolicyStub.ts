import type { MemoryPolicyContext } from '../../src/services/memory/policy';

export function isLongTermMemoryEnabled(_context: MemoryPolicyContext = {}): boolean {
  return true;
}

export function canReadLongTermMemory(_context: MemoryPolicyContext = {}): boolean {
  return true;
}

export function canWriteLongTermMemory(_context: MemoryPolicyContext = {}): boolean {
  return true;
}

export function canUseNetworkMemoryProvider(_context: MemoryPolicyContext = {}): boolean {
  return false;
}

export function initializeMemoryPolicyObservation(): boolean {
  return true;
}

export function getMemoryPolicyEpoch(): number {
  return 0;
}

export function captureMemoryReadEpoch(): number {
  return 0;
}

export function isMemoryReadEpochCurrent(epoch: number): boolean {
  return epoch === 0;
}

export function isMemoryPolicyEpochCurrent(epoch: number): boolean {
  return epoch === 0;
}

export function registerMemoryOptOutHandler(_handler: () => void | Promise<void>): () => void {
  return () => undefined;
}
