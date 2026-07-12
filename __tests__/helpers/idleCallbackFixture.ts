export function restoreRequestIdleCallback(original: unknown): void {
  if (typeof original === 'function') {
    (global as any).requestIdleCallback = original;
  } else {
    delete (global as any).requestIdleCallback;
  }
}
