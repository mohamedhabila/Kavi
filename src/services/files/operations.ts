import type { FileEntry } from './contracts';

export const DEFAULT_FILE_OPERATION_TIMEOUT_MS = 15_000;

export async function fetchFileOperationJson<T>(
  url: string,
  init: RequestInit,
  headers: Record<string, string> = {},
  timeoutMs: number = DEFAULT_FILE_OPERATION_TIMEOUT_MS,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...init,
      headers: {
        Accept: 'application/json',
        ...headers,
        ...((init.headers as Record<string, string>) || {}),
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`Workspace API error (${response.status}): ${text.slice(0, 200)}`);
    }

    const text = await response.text();
    return text.trim() ? (JSON.parse(text) as T) : ({} as T);
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`Workspace API timeout after ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchFileOperationText(
  url: string,
  init: RequestInit,
  headers: Record<string, string> = {},
  timeoutMs: number = DEFAULT_FILE_OPERATION_TIMEOUT_MS,
): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...init,
      headers: {
        ...headers,
        ...((init.headers as Record<string, string>) || {}),
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`Workspace API error (${response.status}): ${text.slice(0, 200)}`);
    }

    return await response.text();
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`Workspace API timeout after ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export function getFileEntrySize(entry: unknown): number | undefined {
  if (entry && typeof entry === 'object' && 'size' in (entry as Record<string, unknown>)) {
    const value = (entry as { size?: unknown }).size;
    return typeof value === 'number' ? value : undefined;
  }
  return undefined;
}

export function getFileEntryModifiedAt(entry: unknown): string | undefined {
  if (
    entry &&
    typeof entry === 'object' &&
    'modificationTime' in (entry as Record<string, unknown>)
  ) {
    const value = (entry as { modificationTime?: unknown }).modificationTime;
    return typeof value === 'number' && Number.isFinite(value)
      ? new Date(value).toISOString()
      : undefined;
  }

  if (entry && typeof entry === 'object' && 'modifiedAt' in (entry as Record<string, unknown>)) {
    const value = (entry as { modifiedAt?: unknown }).modifiedAt;
    return typeof value === 'string' ? value : undefined;
  }

  return undefined;
}

export function sortFileEntries<TEntry extends FileEntry>(entries: TEntry[]): TEntry[] {
  return [...entries].sort((left, right) => {
    if (left.isDirectory !== right.isDirectory) {
      return left.isDirectory ? -1 : 1;
    }
    return left.name.localeCompare(right.name);
  });
}
