// ---------------------------------------------------------------------------
// Kavi — Room on the phone for a model before it downloads
// ---------------------------------------------------------------------------
// A 2-4 GB download that runs out of space fails near the end and leaves the phone full.
// The check counts what is left to download (a resumed download has part of it already)
// plus a reserve, so the phone keeps working and the runtime can write its caches.

import { Paths, type File } from 'expo-file-system';

import { i18n } from '../../i18n/manager';

/** Free space a download must leave behind. */
export const LOCAL_LLM_DOWNLOAD_RESERVE_BYTES = 512 * 1024 * 1024;
const BYTES_PER_GB = 1024 * 1024 * 1024;

function gigabytes(bytes: number): string {
  return (Math.ceil((bytes / BYTES_PER_GB) * 10) / 10).toFixed(1);
}

function availableBytes(): number | undefined {
  try {
    const available = Paths.availableDiskSpace;
    return Number.isFinite(available) && available > 0 ? available : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Throws, in the person's language, when [modelName]'s download would not fit. When the
 * phone cannot say how much space it has, the download goes ahead.
 */
export function assertLocalLlmDownloadFits(params: {
  modelName: string;
  expectedSizeBytes: number;
  partialFile: File;
}): void {
  const available = availableBytes();
  if (available === undefined) return;
  const downloaded = params.partialFile.exists ? (params.partialFile.size ?? 0) : 0;
  const needed =
    Math.max(0, params.expectedSizeBytes - downloaded) + LOCAL_LLM_DOWNLOAD_RESERVE_BYTES;
  if (available >= needed) return;
  throw new Error(
    i18n.t('localModels.notEnoughStorage', {
      model: params.modelName,
      needed: gigabytes(needed),
      available: gigabytes(available),
    }),
  );
}
