import type {
  DirectoryListResult,
  FileEntry,
  FileReadResult,
  FileWriteResult,
} from '../files/contracts';
import { fetchFileOperationJson, fetchFileOperationText } from '../files/operations';
import {
  encodePathForCustomProvider,
  normalizeWorkspaceTargetPath,
  requireTextFileContent,
} from '../files/pathUtils';
import type { WorkspaceTargetConfig } from '../../types/remote';
import { resolveWorkspaceTargetLaunch } from './connector';

function getBaseApiUrl(target: WorkspaceTargetConfig): string {
  return (target.baseUrl || '').trim().replace(/\/+$/g, '');
}

function buildCustomProviderUrl(
  target: WorkspaceTargetConfig,
  fullPath: string,
  query: Record<string, string> = {},
): string {
  const base = new URL(getBaseApiUrl(target));
  base.pathname = `${base.pathname.replace(/\/+$/g, '')}/files${encodePathForCustomProvider(fullPath)}`;
  for (const [key, value] of Object.entries(query)) {
    base.searchParams.set(key, value);
  }
  return base.toString();
}

async function resolveAuthHeaders(target: WorkspaceTargetConfig): Promise<Record<string, string>> {
  const launch = await resolveWorkspaceTargetLaunch(target);
  return launch.headers || {};
}

export async function codeServerReadFile(
  target: WorkspaceTargetConfig,
  remotePath: string,
): Promise<FileReadResult> {
  const base = getBaseApiUrl(target);
  const fullPath = normalizeWorkspaceTargetPath(target.rootPath, remotePath);
  const headers = await resolveAuthHeaders(target);

  const content = await fetchFileOperationText(
    `${base}/api/v1/file?path=${encodeURIComponent(fullPath)}`,
    { method: 'GET' },
    headers,
  );

  return { path: fullPath, content, size: content.length };
}

export async function codeServerWriteFile(
  target: WorkspaceTargetConfig,
  remotePath: string,
  content: string,
): Promise<FileWriteResult> {
  const base = getBaseApiUrl(target);
  const fullPath = normalizeWorkspaceTargetPath(target.rootPath, remotePath);
  const headers = await resolveAuthHeaders(target);
  const normalizedContent = requireTextFileContent(
    content,
    'Workspace file content must be a string',
  );

  await fetchFileOperationText(
    `${base}/api/v1/file?path=${encodeURIComponent(fullPath)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: normalizedContent,
    },
    headers,
  );

  return { path: fullPath, size: normalizedContent.length };
}

export async function codeServerListDirectory(
  target: WorkspaceTargetConfig,
  remotePath: string,
): Promise<DirectoryListResult<FileEntry>> {
  const base = getBaseApiUrl(target);
  const fullPath = normalizeWorkspaceTargetPath(target.rootPath, remotePath);
  const headers = await resolveAuthHeaders(target);

  const raw = await fetchFileOperationJson<Array<{ name: string; isFile: boolean; size?: number }>>(
    `${base}/api/v1/directory?path=${encodeURIComponent(fullPath)}`,
    { method: 'GET' },
    headers,
  );

  const entries: FileEntry[] = (Array.isArray(raw) ? raw : []).map((entry) => ({
    name: entry.name,
    isDirectory: !entry.isFile,
    size: entry.size,
  }));

  return { path: fullPath, entries };
}

export async function codeServerMkdir(
  target: WorkspaceTargetConfig,
  remotePath: string,
): Promise<void> {
  const base = getBaseApiUrl(target);
  const fullPath = normalizeWorkspaceTargetPath(target.rootPath, remotePath);
  const headers = await resolveAuthHeaders(target);

  await fetchFileOperationText(
    `${base}/api/v1/directory?path=${encodeURIComponent(fullPath)}`,
    { method: 'POST' },
    headers,
  );
}

export async function customReadFile(
  target: WorkspaceTargetConfig,
  remotePath: string,
): Promise<FileReadResult> {
  const fullPath = normalizeWorkspaceTargetPath(target.rootPath, remotePath);
  const headers = await resolveAuthHeaders(target);

  const content = await fetchFileOperationText(
    buildCustomProviderUrl(target, fullPath),
    { method: 'GET' },
    headers,
  );

  return { path: fullPath, content, size: content.length };
}

export async function customWriteFile(
  target: WorkspaceTargetConfig,
  remotePath: string,
  content: string,
): Promise<FileWriteResult> {
  const fullPath = normalizeWorkspaceTargetPath(target.rootPath, remotePath);
  const headers = await resolveAuthHeaders(target);
  const normalizedContent = requireTextFileContent(
    content,
    'Workspace file content must be a string',
  );

  await fetchFileOperationText(
    buildCustomProviderUrl(target, fullPath),
    {
      method: 'PUT',
      headers: { 'Content-Type': 'text/plain' },
      body: normalizedContent,
    },
    headers,
  );

  return { path: fullPath, size: normalizedContent.length };
}

export async function customListDirectory(
  target: WorkspaceTargetConfig,
  remotePath: string,
): Promise<DirectoryListResult<FileEntry>> {
  const fullPath = normalizeWorkspaceTargetPath(target.rootPath, remotePath);
  const headers = await resolveAuthHeaders(target);

  const raw = await fetchFileOperationJson<
    Array<{ name: string; isDirectory?: boolean; isFile?: boolean; size?: number }>
  >(buildCustomProviderUrl(target, fullPath, { list: 'true' }), { method: 'GET' }, headers);

  const entries: FileEntry[] = (Array.isArray(raw) ? raw : []).map((entry) => ({
    name: entry.name,
    isDirectory: entry.isDirectory ?? !entry.isFile,
    size: entry.size,
  }));

  return { path: fullPath, entries };
}

export async function customMkdir(
  target: WorkspaceTargetConfig,
  remotePath: string,
): Promise<void> {
  const fullPath = normalizeWorkspaceTargetPath(target.rootPath, remotePath);
  const headers = await resolveAuthHeaders(target);

  await fetchFileOperationText(
    buildCustomProviderUrl(target, fullPath, { mkdir: 'true' }),
    { method: 'PUT' },
    headers,
  );
}

export async function renameWorkspaceFileByMode(
  target: WorkspaceTargetConfig,
  mode: 'native' | 'custom',
  oldPath: string,
  newPath: string,
): Promise<void> {
  const fullOldPath = normalizeWorkspaceTargetPath(target.rootPath, oldPath);
  const fullNewPath = normalizeWorkspaceTargetPath(target.rootPath, newPath);
  const headers = await resolveAuthHeaders(target);

  if (mode === 'native') {
    await fetchFileOperationText(
      `${getBaseApiUrl(target)}/api/v1/file?path=${encodeURIComponent(fullOldPath)}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newPath: fullNewPath }),
      },
      headers,
    );
    return;
  }

  await fetchFileOperationText(
    buildCustomProviderUrl(target, fullOldPath, { rename: fullNewPath }),
    { method: 'POST' },
    headers,
  );
}

export async function deleteWorkspaceFileByMode(
  target: WorkspaceTargetConfig,
  mode: 'native' | 'custom',
  remotePath: string,
): Promise<void> {
  const fullPath = normalizeWorkspaceTargetPath(target.rootPath, remotePath);
  const headers = await resolveAuthHeaders(target);

  if (mode === 'native') {
    await fetchFileOperationText(
      `${getBaseApiUrl(target)}/api/v1/file?path=${encodeURIComponent(fullPath)}`,
      { method: 'DELETE' },
      headers,
    );
    return;
  }

  await fetchFileOperationText(
    buildCustomProviderUrl(target, fullPath),
    { method: 'DELETE' },
    headers,
  );
}
