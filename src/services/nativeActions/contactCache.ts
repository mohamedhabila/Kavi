import { NativeActionResult } from './types';

const fullReadCache = new Map<string, NativeActionResult<Record<string, unknown>>>();

export function getCachedContactResult(
  key: string,
): NativeActionResult<Record<string, unknown>> | undefined {
  return fullReadCache.get(key);
}

export function setCachedContactResult(
  key: string,
  result: NativeActionResult<Record<string, unknown>>,
): NativeActionResult<Record<string, unknown>> {
  fullReadCache.set(key, result);
  return result;
}

export function invalidateCachedContactResults(): void {
  fullReadCache.clear();
}
