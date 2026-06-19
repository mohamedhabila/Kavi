import { sanitizeWorkspaceRelativePath } from '../workspaces/paths';

export function decodeFilePath(path: string): string {
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

export function splitPathSegments(path: string): string[] {
  return path.split('/').filter((segment) => segment && segment !== '.');
}

export function normalizeAbsoluteWorkspaceRoot(rootPath: string): string {
  const decodedRoot = decodeFilePath(rootPath);
  const segments = splitPathSegments(decodedRoot);
  if (segments.length === 0) {
    throw new Error('Workspace target rootPath must not be empty');
  }
  return `/${segments.join('/')}`;
}

export function normalizeWorkspaceTargetPath(rootPath: string, remotePath: string): string {
  const normalizedRoot = normalizeAbsoluteWorkspaceRoot(rootPath);
  const decodedPath = decodeFilePath(remotePath);

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

  const resolvedPath = `/${workingSegments.join('/')}`;
  if (resolvedPath !== normalizedRoot && !resolvedPath.startsWith(`${normalizedRoot}/`)) {
    throw new Error(`Workspace path escapes configured root: ${remotePath}`);
  }

  return resolvedPath;
}

export function encodePathForCustomProvider(path: string): string {
  const encodedSegments = splitPathSegments(path).map((segment) => encodeURIComponent(segment));
  return `/${encodedSegments.join('/')}`;
}

export function normalizeConversationWorkspacePath(path: string): string {
  return sanitizeWorkspaceRelativePath(path).replace(/\/+$/g, '');
}

export function requireConversationWorkspacePath(path: string): string {
  const normalized = normalizeConversationWorkspacePath(path);
  if (!normalized) {
    throw new Error('conversation workspace path must not be empty');
  }
  return normalized;
}

export function requireConversationId(conversationId: string): string {
  const normalized = typeof conversationId === 'string' ? conversationId.trim() : '';
  if (!normalized) {
    throw new Error('conversationId is required');
  }
  return normalized;
}

export function getWorkspaceSearchConversationIds(
  conversationId: string,
  fallbackConversationIds?: string[],
): string[] {
  const primaryConversationId = requireConversationId(conversationId);
  const orderedIds = [primaryConversationId];

  for (const candidate of fallbackConversationIds ?? []) {
    const normalized = typeof candidate === 'string' ? candidate.trim() : '';
    if (!normalized || orderedIds.includes(normalized)) {
      continue;
    }
    orderedIds.push(normalized);
  }

  return orderedIds;
}

export function requireTextFileContent(content: string, message: string): string {
  if (typeof content !== 'string') {
    throw new Error(message);
  }
  return content;
}

export function requireBinaryFileContent(bytes: Uint8Array, message: string): Uint8Array {
  if (!(bytes instanceof Uint8Array)) {
    throw new Error(message);
  }
  return bytes;
}

export function hasFileExtension(path: string, extensions: ReadonlySet<string>): boolean {
  const extension = normalizeConversationWorkspacePath(path).split('.').pop()?.toLowerCase() || '';
  return extensions.has(extension);
}

export function base64ByteLength(value: string): number {
  const normalized = value.replace(/\s+/g, '');
  if (!normalized) {
    return 0;
  }

  const padding = normalized.endsWith('==') ? 2 : normalized.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor((normalized.length * 3) / 4) - padding);
}
