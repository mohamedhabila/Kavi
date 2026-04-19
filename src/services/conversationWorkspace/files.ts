import { Directory, File, Paths } from 'expo-file-system';
import * as LegacyFileSystem from 'expo-file-system/legacy';
import { sanitizeWorkspaceRelativePath } from '../../engine/tools/fileArgumentUtils';
import type { Attachment } from '../../types';
import { readAttachmentBase64 } from '../media/attachmentPayloads';

export interface ConversationWorkspaceDirectoryEntry {
  name: string;
  isDirectory: boolean;
  size?: number;
  modifiedAt?: string;
}

export interface ConversationWorkspaceDirectoryResult {
  path: string;
  entries: ConversationWorkspaceDirectoryEntry[];
}

export interface ConversationWorkspaceReadResult {
  conversationId: string;
  path: string;
  content: string;
  size: number;
  uri: string;
}

export interface ConversationWorkspaceWriteResult {
  path: string;
  size: number;
  uri: string;
}

export interface ConversationWorkspaceImportedAttachmentResult {
  attachment: Attachment;
  imported: boolean;
}

export type ConversationWorkspaceFileInspection =
  | {
      conversationId: string;
      kind: 'text';
      path: string;
      uri: string;
      content: string;
    }
  | {
      conversationId: string;
      kind: 'image' | 'binary';
      path: string;
      uri: string;
    };

const IMAGE_FILE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp']);
const ATTACHMENT_WORKSPACE_ROOT = 'attachments';

function sanitizeAttachmentFileSegment(value: string): string {
  const normalized = value
    .replace(/[/\\]+/g, '-')
    .replace(/\s+/g, '-')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '');

  return normalized || 'file';
}

function getAttachmentExtensionCandidate(value: string | undefined): string | undefined {
  const match = value?.split(/[?#]/, 1)[0].match(/\.([a-zA-Z0-9]+)$/);
  return match?.[1]?.toLowerCase();
}

function inferAttachmentExtension(
  attachment: Pick<Attachment, 'name' | 'uri' | 'mimeType' | 'type'>,
): string | undefined {
  const explicitExtension =
    getAttachmentExtensionCandidate(attachment.name) ||
    getAttachmentExtensionCandidate(attachment.uri);
  if (explicitExtension) {
    return explicitExtension;
  }

  const mimeType = attachment.mimeType?.trim().toLowerCase() || '';
  const fromMime = mimeType.includes('/') ? mimeType.split('/').pop() : '';
  if (fromMime) {
    if (fromMime === 'jpeg') {
      return 'jpg';
    }

    if (fromMime === 'plain') {
      return 'txt';
    }

    if (/^[a-z0-9.+-]+$/i.test(fromMime)) {
      return fromMime;
    }
  }

  switch (attachment.type) {
    case 'image':
      return 'jpg';
    case 'audio':
      return 'm4a';
    default:
      return 'txt';
  }
}

function sanitizeAttachmentFileName(
  attachment: Pick<Attachment, 'id' | 'name' | 'uri' | 'mimeType' | 'type'>,
): string {
  const rawName =
    attachment.name?.trim() || attachment.uri?.split(/[?#]/, 1)[0].split('/').pop()?.trim() || '';
  const extension = inferAttachmentExtension(attachment);
  const stemSource = rawName
    ? rawName.replace(/\.[a-zA-Z0-9]+$/, '')
    : `${attachment.type || 'file'}-${attachment.id || 'attachment'}`;
  const stem = sanitizeAttachmentFileSegment(stemSource);
  const safeExtension = extension ? sanitizeAttachmentFileSegment(extension).toLowerCase() : '';
  return safeExtension ? `${stem}.${safeExtension}` : stem;
}

function getAttachmentWorkspaceDirectory(type: Attachment['type']): string {
  switch (type) {
    case 'image':
      return `${ATTACHMENT_WORKSPACE_ROOT}/images`;
    case 'audio':
      return `${ATTACHMENT_WORKSPACE_ROOT}/audio`;
    default:
      return `${ATTACHMENT_WORKSPACE_ROOT}/files`;
  }
}

function buildImportedAttachmentWorkspacePath(
  attachment: Pick<Attachment, 'id' | 'type' | 'name' | 'uri' | 'mimeType'>,
): string {
  const safeId = sanitizeAttachmentFileSegment(attachment.id || 'attachment');
  const safeName = sanitizeAttachmentFileName(attachment);
  return normalizeConversationWorkspacePath(
    `${getAttachmentWorkspaceDirectory(attachment.type)}/${safeId}-${safeName}`,
  );
}

function base64ByteLength(value: string): number {
  const normalized = value.replace(/\s+/g, '');
  if (!normalized) {
    return 0;
  }

  const padding = normalized.endsWith('==') ? 2 : normalized.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor((normalized.length * 3) / 4) - padding);
}

function requireConversationId(conversationId: string): string {
  const normalized = typeof conversationId === 'string' ? conversationId.trim() : '';
  if (!normalized) {
    throw new Error('conversationId is required');
  }
  return normalized;
}

export function normalizeConversationWorkspacePath(path: string): string {
  return sanitizeWorkspaceRelativePath(path).replace(/\/+$/g, '');
}

function requireConversationWorkspacePath(path: string): string {
  const normalized = normalizeConversationWorkspacePath(path);
  if (!normalized) {
    throw new Error('conversation workspace path must not be empty');
  }
  return normalized;
}

function getConversationWorkspaceDir(conversationId: string): Directory {
  return new Directory(Paths.document, 'workspace', requireConversationId(conversationId));
}

function getWorkspaceSearchConversationIds(
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

async function ensureDirectory(dir: Directory): Promise<void> {
  await dir.create({ idempotent: true, intermediates: true });
}

async function ensureConversationWorkspaceParentDirectory(
  conversationId: string,
  safePath: string,
): Promise<Directory> {
  const workspaceDir = getConversationWorkspaceDir(conversationId);
  const parentPath = safePath.includes('/') ? safePath.split('/').slice(0, -1).join('/') : '';

  await ensureDirectory(workspaceDir);
  if (parentPath) {
    await ensureDirectory(new Directory(workspaceDir, parentPath));
  }

  return workspaceDir;
}

function getEntrySize(entry: unknown): number | undefined {
  if (entry && typeof entry === 'object' && 'size' in (entry as Record<string, unknown>)) {
    const value = (entry as { size?: unknown }).size;
    return typeof value === 'number' ? value : undefined;
  }
  return undefined;
}

function getEntryModifiedAt(entry: unknown): string | undefined {
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

export function isConversationWorkspaceImagePath(path: string): boolean {
  const extension = normalizeConversationWorkspacePath(path).split('.').pop()?.toLowerCase() || '';
  return IMAGE_FILE_EXTENSIONS.has(extension);
}

export async function listConversationWorkspaceDirectory(
  conversationId: string,
  path = '',
  fallbackConversationIds?: string[],
): Promise<ConversationWorkspaceDirectoryResult> {
  const safePath = normalizeConversationWorkspacePath(path);
  const entriesByName = new Map<string, ConversationWorkspaceDirectoryEntry>();

  for (const targetConversationId of getWorkspaceSearchConversationIds(
    conversationId,
    fallbackConversationIds,
  )) {
    const workspaceDir = getConversationWorkspaceDir(targetConversationId);
    const targetDir = safePath ? new Directory(workspaceDir, safePath) : workspaceDir;

    if (!targetDir.exists) {
      continue;
    }

    for (const entry of targetDir.list()) {
      if (entriesByName.has(entry.name)) {
        continue;
      }

      entriesByName.set(entry.name, {
        name: entry.name,
        isDirectory: !('text' in entry),
        size: getEntrySize(entry),
        modifiedAt: getEntryModifiedAt(entry),
      });
    }
  }

  const entries = Array.from(entriesByName.values()).sort((left, right) => {
    if (left.isDirectory !== right.isDirectory) {
      return left.isDirectory ? -1 : 1;
    }
    return left.name.localeCompare(right.name);
  });

  return {
    path: safePath,
    entries,
  };
}

export async function readConversationWorkspaceTextFile(
  conversationId: string,
  path: string,
  fallbackConversationIds?: string[],
): Promise<ConversationWorkspaceReadResult> {
  const safePath = requireConversationWorkspacePath(path);
  for (const sourceConversationId of getWorkspaceSearchConversationIds(
    conversationId,
    fallbackConversationIds,
  )) {
    const file = new File(getConversationWorkspaceDir(sourceConversationId), safePath);

    if (!file.exists) {
      continue;
    }

    const content = await file.text();
    return {
      conversationId: sourceConversationId,
      path: safePath,
      content,
      size: content.length,
      uri: file.uri,
    };
  }

  throw new Error(`file not found: ${safePath}`);
}

export async function writeConversationWorkspaceTextFile(
  conversationId: string,
  path: string,
  content: string,
): Promise<ConversationWorkspaceWriteResult> {
  if (typeof content !== 'string') {
    throw new Error('conversation workspace file content must be a string');
  }

  const safePath = requireConversationWorkspacePath(path);
  const workspaceDir = await ensureConversationWorkspaceParentDirectory(conversationId, safePath);

  const file = new File(workspaceDir, safePath);
  file.write(content);

  return {
    path: safePath,
    size: content.length,
    uri: file.uri,
  };
}

export async function writeConversationWorkspaceBinaryFile(
  conversationId: string,
  path: string,
  bytes: Uint8Array,
): Promise<ConversationWorkspaceWriteResult> {
  if (!(bytes instanceof Uint8Array)) {
    throw new Error('conversation workspace file content must be binary bytes');
  }

  const safePath = requireConversationWorkspacePath(path);
  const workspaceDir = await ensureConversationWorkspaceParentDirectory(conversationId, safePath);
  const file = new File(workspaceDir, safePath);
  file.write(bytes);

  return {
    path: safePath,
    size: bytes.byteLength,
    uri: file.uri,
  };
}

async function copyAttachmentToWorkspace(
  conversationId: string,
  safePath: string,
  attachment: Attachment,
): Promise<ConversationWorkspaceWriteResult> {
  const destinationUri = getConversationWorkspaceFileUri(conversationId, safePath);
  const destinationFile = new File(destinationUri);

  if (attachment.uri && !/^data:/i.test(attachment.uri)) {
    try {
      const sourceFile = new File(attachment.uri);
      sourceFile.copy(destinationFile);
      return {
        path: safePath,
        size: typeof destinationFile.size === 'number' ? destinationFile.size : attachment.size,
        uri: destinationUri,
      };
    } catch {
      // Fall through to byte/base64-based persistence for providers that do not support direct copy.
    }

    try {
      const sourceFile = new File(attachment.uri);
      if (typeof sourceFile.bytes === 'function') {
        const bytes = await sourceFile.bytes();
        return await writeConversationWorkspaceBinaryFile(
          conversationId,
          safePath,
          bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes),
        );
      }

      if (typeof sourceFile.arrayBuffer === 'function') {
        return await writeConversationWorkspaceBinaryFile(
          conversationId,
          safePath,
          new Uint8Array(await sourceFile.arrayBuffer()),
        );
      }
    } catch {
      // Fall through to base64-based persistence.
    }
  }

  const base64 = await readAttachmentBase64(attachment);
  if (base64) {
    const normalizedBase64 = base64.replace(/\s+/g, '');
    await ensureConversationWorkspaceParentDirectory(conversationId, safePath);
    await LegacyFileSystem.writeAsStringAsync(destinationUri, normalizedBase64, {
      encoding: LegacyFileSystem.EncodingType.Base64,
    } as any);
    return {
      path: safePath,
      size: attachment.size > 0 ? attachment.size : base64ByteLength(normalizedBase64),
      uri: destinationUri,
    };
  }

  throw new Error(
    `Unable to copy attachment into the conversation workspace: ${attachment.name || attachment.uri || attachment.id}`,
  );
}

export async function importConversationWorkspaceAttachment(
  conversationId: string,
  attachment: Attachment,
): Promise<ConversationWorkspaceImportedAttachmentResult> {
  const requestedPath = attachment.workspacePath?.trim();
  const safePath = requestedPath
    ? requireConversationWorkspacePath(requestedPath)
    : buildImportedAttachmentWorkspacePath(attachment);
  const workspaceUri = getConversationWorkspaceFileUri(conversationId, safePath);
  const workspaceFile = new File(workspaceUri);

  if (!workspaceFile.exists) {
    await copyAttachmentToWorkspace(conversationId, safePath, attachment);
  }

  return {
    imported: !requestedPath || attachment.uri !== workspaceUri,
    attachment: {
      ...attachment,
      uri: workspaceUri,
      workspacePath: safePath,
      size:
        typeof workspaceFile.size === 'number' && workspaceFile.size > 0
          ? workspaceFile.size
          : attachment.size,
    },
  };
}

export async function inspectConversationWorkspaceFile(
  conversationId: string,
  path: string,
  fallbackConversationIds?: string[],
): Promise<ConversationWorkspaceFileInspection> {
  const safePath = requireConversationWorkspacePath(path);
  for (const sourceConversationId of getWorkspaceSearchConversationIds(
    conversationId,
    fallbackConversationIds,
  )) {
    const file = new File(getConversationWorkspaceDir(sourceConversationId), safePath);

    if (!file.exists) {
      continue;
    }

    if (isConversationWorkspaceImagePath(safePath)) {
      return {
        conversationId: sourceConversationId,
        kind: 'image',
        path: safePath,
        uri: file.uri,
      };
    }

    try {
      const content = await file.text();
      return {
        conversationId: sourceConversationId,
        kind: 'text',
        path: safePath,
        uri: file.uri,
        content,
      };
    } catch {
      return {
        conversationId: sourceConversationId,
        kind: 'binary',
        path: safePath,
        uri: file.uri,
      };
    }
  }

  throw new Error(`file not found: ${safePath}`);
}

export function getConversationWorkspaceFileUri(conversationId: string, path: string): string {
  const safePath = requireConversationWorkspacePath(path);
  return new File(getConversationWorkspaceDir(conversationId), safePath).uri;
}
