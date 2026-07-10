export type FileLockOptions = {
  timeoutMs?: number;
  staleMs?: number;
};

export const DEFAULT_LOCK_STALE_MS: number;
export const DEFAULT_LOCK_TIMEOUT_MS: number;

export function acquireFileLockSync(lockPath: string, options?: FileLockOptions): () => void;
export function atomicWriteFileSync(
  filePath: string,
  content: string,
  encoding?: BufferEncoding,
): void;
export function removeManagedTransactionResidueSync(parentDir: string, baseName: string): void;
export function replaceDirectoryFromStagingSync(stagingDir: string, targetDir: string): void;
export function uniqueManagedPath(parentDir: string, baseName: string, kind: string): string;
export function withFileLockSync<T>(
  lockPath: string,
  callback: () => T,
  options?: FileLockOptions,
): T;
