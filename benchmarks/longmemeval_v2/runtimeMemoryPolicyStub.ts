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
