import * as Crypto from 'expo-crypto';
import { generateId } from '../utils/id';

const runtimeProcessEpoch =
  typeof Crypto.randomUUID === 'function' ? Crypto.randomUUID() : `runtime-process-${generateId()}`;

/** Exact process-local identity for fencing durable work owned by this runtime. */
export function getRuntimeProcessEpoch(): string {
  return runtimeProcessEpoch;
}
