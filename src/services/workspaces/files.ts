/**
 * Workspace file operations client for code-server / OpenVSCode Server.
 *
 * Provides file read/write/list/mkdir/rename/delete operations against
 * remote workspace targets that run code-server or OpenVSCode Server.
 * Both expose a REST-like file API at the /api endpoint.
 *
 * code-server API:
 *   GET  /api/v1/file?path=...       → file contents
 *   POST /api/v1/file?path=...       → write file
 *   GET  /api/v1/directory?path=...  → directory listing
 *   POST /api/v1/directory?path=...  → mkdir
 *
 * OpenVSCode Server uses the same RESTful contract through its
 * built-in VS Code Server file routes.
 *
 * For "custom" providers, we fall back to a simple REST convention:
 *   GET  {baseUrl}/files/{path}       → read
 *   PUT  {baseUrl}/files/{path}       → write
 *   GET  {baseUrl}/files/{path}?list  → list directory
 */

import type { WorkspaceTargetConfig } from '../../types';
import { getWorkspaceProviderFileAccessMode, resolveWorkspaceTargetLaunch } from './connector';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface WorkspaceFileEntry {
  name: string;
  isDirectory: boolean;
  size?: number;
  modifiedAt?: string;
}

export interface WorkspaceFileReadResult {
  path: string;
  content: string;
  size: number;
}

export interface WorkspaceFileWriteResult {
  path: string;
  size: number;
}

export interface WorkspaceDirectoryListResult {
  path: string;
  entries: WorkspaceFileEntry[];
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

const DEFAULT_TIMEOUT_MS = 15_000;

function normalizeRemotePath(rootPath: string, remotePath: string): string {
  const normalizedRoot = normalizeWorkspaceRoot(rootPath);
  const decodedPath = decodeWorkspacePath(remotePath);

  if (!decodedPath || decodedPath === '.') {
    return normalizedRoot;
  }

  const isAbsolute = decodedPath.startsWith('/');
  const rootSegments = splitPathSegments(normalizedRoot);
  const workingSegments = isAbsolute ? [] : [...rootSegments];
  const protectedDepth = isAbsolute ? 0 : rootSegments.length;

  for (const segment of splitPathSegments(decodedPath)) {
    if (segment === '..') {
      if (workingSegments.length <= protectedDepth) {
        throw new Error(`Workspace path escapes configured root: ${remotePath}`);
      }
      workingSegments.pop();
      continue;
    }
    workingSegments.push(segment);
  }

  const resolvedPath = '/' + workingSegments.join('/');
  if (resolvedPath !== normalizedRoot && !resolvedPath.startsWith(`${normalizedRoot}/`)) {
    throw new Error(`Workspace path escapes configured root: ${remotePath}`);
  }

  return resolvedPath;
}

function getBaseApiUrl(target: WorkspaceTargetConfig): string {
  return (target.baseUrl || '').trim().replace(/\/+$/g, '');
}

function decodeWorkspacePath(path: string): string {
  if (typeof path !== 'string') {
    throw new Error('Workspace path must be a string');
  }

  const trimmed = path.trim();
  if (!trimmed) {
    return '';
  }

  try {
    return decodeURIComponent(trimmed).replace(/\\/g, '/').replace(/\0/g, '');
  } catch {
    return trimmed.replace(/\\/g, '/').replace(/\0/g, '');
  }
}

function splitPathSegments(path: string): string[] {
  return path.split('/').filter((segment) => segment && segment !== '.');
}

function normalizeWorkspaceRoot(rootPath: string): string {
  const decodedRoot = decodeWorkspacePath(rootPath);
  const segments = splitPathSegments(decodedRoot);
  if (segments.length === 0) {
    throw new Error('Workspace target rootPath must not be empty');
  }
  return `/${segments.join('/')}`;
}

function encodePathForCustomProvider(path: string): string {
  const encodedSegments = splitPathSegments(path).map((segment) => encodeURIComponent(segment));
  return `/${encodedSegments.join('/')}`;
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

function normalizeWorkspaceContent(content: string): string {
  if (typeof content !== 'string') {
    throw new Error('Workspace file content must be a string');
  }
  return content;
}

function getWorkspaceFileAccessMode(
  target: WorkspaceTargetConfig,
): ReturnType<typeof getWorkspaceProviderFileAccessMode> {
  return getWorkspaceProviderFileAccessMode(target.provider);
}

function requireWorkspaceFileAccess(
  target: WorkspaceTargetConfig,
): ReturnType<typeof getWorkspaceProviderFileAccessMode> {
  const mode = getWorkspaceFileAccessMode(target);
  if (mode === 'none') {
    throw new Error('Workspace target does not support file operations');
  }
  return mode;
}

async function fetchWorkspaceJson<T>(
  url: string,
  init: RequestInit,
  headers: Record<string, string> = {},
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
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

async function fetchWorkspaceText(
  url: string,
  init: RequestInit,
  headers: Record<string, string> = {},
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
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

async function resolveAuthHeaders(target: WorkspaceTargetConfig): Promise<Record<string, string>> {
  const launch = await resolveWorkspaceTargetLaunch(target);
  return launch.headers || {};
}

// ---------------------------------------------------------------------------
// code-server API
// ---------------------------------------------------------------------------

async function codeServerReadFile(
  target: WorkspaceTargetConfig,
  remotePath: string,
): Promise<WorkspaceFileReadResult> {
  const base = getBaseApiUrl(target);
  const fullPath = normalizeRemotePath(target.rootPath, remotePath);
  const headers = await resolveAuthHeaders(target);

  const content = await fetchWorkspaceText(
    `${base}/api/v1/file?path=${encodeURIComponent(fullPath)}`,
    { method: 'GET' },
    headers,
  );

  return { path: fullPath, content, size: content.length };
}

async function codeServerWriteFile(
  target: WorkspaceTargetConfig,
  remotePath: string,
  content: string,
): Promise<WorkspaceFileWriteResult> {
  const base = getBaseApiUrl(target);
  const fullPath = normalizeRemotePath(target.rootPath, remotePath);
  const headers = await resolveAuthHeaders(target);
  const normalizedContent = normalizeWorkspaceContent(content);

  await fetchWorkspaceText(
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

async function codeServerListDirectory(
  target: WorkspaceTargetConfig,
  remotePath: string,
): Promise<WorkspaceDirectoryListResult> {
  const base = getBaseApiUrl(target);
  const fullPath = normalizeRemotePath(target.rootPath, remotePath);
  const headers = await resolveAuthHeaders(target);

  const raw = await fetchWorkspaceJson<Array<{ name: string; isFile: boolean; size?: number }>>(
    `${base}/api/v1/directory?path=${encodeURIComponent(fullPath)}`,
    { method: 'GET' },
    headers,
  );

  const entries: WorkspaceFileEntry[] = (Array.isArray(raw) ? raw : []).map((entry) => ({
    name: entry.name,
    isDirectory: !entry.isFile,
    size: entry.size,
  }));

  return { path: fullPath, entries };
}

async function codeServerMkdir(target: WorkspaceTargetConfig, remotePath: string): Promise<void> {
  const base = getBaseApiUrl(target);
  const fullPath = normalizeRemotePath(target.rootPath, remotePath);
  const headers = await resolveAuthHeaders(target);

  await fetchWorkspaceText(
    `${base}/api/v1/directory?path=${encodeURIComponent(fullPath)}`,
    { method: 'POST' },
    headers,
  );
}

// ---------------------------------------------------------------------------
// Custom / fallback REST API
// ---------------------------------------------------------------------------

async function customReadFile(
  target: WorkspaceTargetConfig,
  remotePath: string,
): Promise<WorkspaceFileReadResult> {
  const fullPath = normalizeRemotePath(target.rootPath, remotePath);
  const headers = await resolveAuthHeaders(target);

  const content = await fetchWorkspaceText(
    buildCustomProviderUrl(target, fullPath),
    { method: 'GET' },
    headers,
  );

  return { path: fullPath, content, size: content.length };
}

async function customWriteFile(
  target: WorkspaceTargetConfig,
  remotePath: string,
  content: string,
): Promise<WorkspaceFileWriteResult> {
  const fullPath = normalizeRemotePath(target.rootPath, remotePath);
  const headers = await resolveAuthHeaders(target);
  const normalizedContent = normalizeWorkspaceContent(content);

  await fetchWorkspaceText(
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

async function customListDirectory(
  target: WorkspaceTargetConfig,
  remotePath: string,
): Promise<WorkspaceDirectoryListResult> {
  const fullPath = normalizeRemotePath(target.rootPath, remotePath);
  const headers = await resolveAuthHeaders(target);

  const raw = await fetchWorkspaceJson<
    Array<{ name: string; isDirectory?: boolean; isFile?: boolean; size?: number }>
  >(buildCustomProviderUrl(target, fullPath, { list: 'true' }), { method: 'GET' }, headers);

  const entries: WorkspaceFileEntry[] = (Array.isArray(raw) ? raw : []).map((entry) => ({
    name: entry.name,
    isDirectory: entry.isDirectory ?? !entry.isFile,
    size: entry.size,
  }));

  return { path: fullPath, entries };
}

async function customMkdir(target: WorkspaceTargetConfig, remotePath: string): Promise<void> {
  const fullPath = normalizeRemotePath(target.rootPath, remotePath);
  const headers = await resolveAuthHeaders(target);

  await fetchWorkspaceText(
    buildCustomProviderUrl(target, fullPath, { mkdir: 'true' }),
    { method: 'PUT' },
    headers,
  );
}

// ---------------------------------------------------------------------------
// Public API — dispatches by provider
// ---------------------------------------------------------------------------

function isCodeServerLike(target: WorkspaceTargetConfig): boolean {
  return getWorkspaceFileAccessMode(target) === 'native';
}

export async function readWorkspaceFile(
  target: WorkspaceTargetConfig,
  remotePath: string,
): Promise<WorkspaceFileReadResult> {
  const mode = requireWorkspaceFileAccess(target);
  return mode === 'native'
    ? codeServerReadFile(target, remotePath)
    : customReadFile(target, remotePath);
}

export async function writeWorkspaceFile(
  target: WorkspaceTargetConfig,
  remotePath: string,
  content: string,
): Promise<WorkspaceFileWriteResult> {
  const mode = requireWorkspaceFileAccess(target);
  return mode === 'native'
    ? codeServerWriteFile(target, remotePath, content)
    : customWriteFile(target, remotePath, content);
}

export async function listWorkspaceDirectory(
  target: WorkspaceTargetConfig,
  remotePath: string = '.',
): Promise<WorkspaceDirectoryListResult> {
  const mode = requireWorkspaceFileAccess(target);
  return mode === 'native'
    ? codeServerListDirectory(target, remotePath)
    : customListDirectory(target, remotePath);
}

export async function makeWorkspaceDirectory(
  target: WorkspaceTargetConfig,
  remotePath: string,
): Promise<void> {
  const mode = requireWorkspaceFileAccess(target);
  return mode === 'native' ? codeServerMkdir(target, remotePath) : customMkdir(target, remotePath);
}

export async function renameWorkspaceFile(
  target: WorkspaceTargetConfig,
  oldPath: string,
  newPath: string,
): Promise<void> {
  const mode = requireWorkspaceFileAccess(target);
  const base = getBaseApiUrl(target);
  const fullOldPath = normalizeRemotePath(target.rootPath, oldPath);
  const fullNewPath = normalizeRemotePath(target.rootPath, newPath);
  const headers = await resolveAuthHeaders(target);

  if (mode === 'native') {
    await fetchWorkspaceText(
      `${base}/api/v1/file?path=${encodeURIComponent(fullOldPath)}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newPath: fullNewPath }),
      },
      headers,
    );
  } else {
    await fetchWorkspaceText(
      buildCustomProviderUrl(target, fullOldPath, { rename: fullNewPath }),
      { method: 'POST' },
      headers,
    );
  }
}

export async function deleteWorkspaceFile(
  target: WorkspaceTargetConfig,
  remotePath: string,
): Promise<void> {
  const mode = requireWorkspaceFileAccess(target);
  const base = getBaseApiUrl(target);
  const fullPath = normalizeRemotePath(target.rootPath, remotePath);
  const headers = await resolveAuthHeaders(target);

  if (mode === 'native') {
    await fetchWorkspaceText(
      `${base}/api/v1/file?path=${encodeURIComponent(fullPath)}`,
      { method: 'DELETE' },
      headers,
    );
  } else {
    await fetchWorkspaceText(
      buildCustomProviderUrl(target, fullPath),
      { method: 'DELETE' },
      headers,
    );
  }
}
