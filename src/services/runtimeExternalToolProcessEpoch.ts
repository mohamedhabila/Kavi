import * as Crypto from 'expo-crypto';
import { generateId } from '../utils/id';

const runtimeExternalToolProcessEpoch =
  typeof Crypto.randomUUID === 'function' ? Crypto.randomUUID() : `runtime-process-${generateId()}`;

/**
 * A process-local fence for dynamic tool bindings. Persisted dynamic claims
 * from an earlier app process can be inspected, but can never be dispatched
 * under a coincidentally identical reconnect or registration order.
 */
export function getRuntimeExternalToolProcessEpoch(): string {
  return runtimeExternalToolProcessEpoch;
}
