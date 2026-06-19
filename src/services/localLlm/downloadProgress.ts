import type { InstallLocalLlmModelOptions } from './types';

export function emitLocalLlmInstallProgress(
  modelId: string,
  bytesWritten: number,
  totalBytes: number | null,
  onProgress?: InstallLocalLlmModelOptions['onProgress'],
): void {
  if (!onProgress) {
    return;
  }

  const normalizedTotal =
    typeof totalBytes === 'number' && Number.isFinite(totalBytes) && totalBytes > 0
      ? totalBytes
      : null;
  const fraction = normalizedTotal
    ? Math.max(0, Math.min(1, bytesWritten / normalizedTotal))
    : null;
  onProgress({
    modelId,
    bytesWritten,
    totalBytes: normalizedTotal,
    fraction,
  });
}
