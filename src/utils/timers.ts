export function unrefTimerIfSupported(
  handle: { unref?: () => void } | number | null | undefined,
): void {
  if (handle && typeof handle === 'object' && typeof handle.unref === 'function') {
    handle.unref();
  }
}
