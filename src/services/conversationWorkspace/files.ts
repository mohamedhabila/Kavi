import { Directory, File } from 'expo-file-system';
import type {
  DirectoryListResult,
  FileEntry,
  UriFileReadResult,
  UriFileWriteResult,
} from '../files/contracts';
import { getFileEntryModifiedAt, getFileEntrySize, sortFileEntries } from '../files/operations';
import {
  getWorkspaceSearchConversationIds,
  hasFileExtension,
  normalizeConversationWorkspacePath,
  requireBinaryFileContent,
  requireConversationWorkspacePath,
  requireTextFileContent,
} from '../files/pathUtils';
import {
  getConversationWorkspaceDir,
  writeConversationWorkspaceBinaryContent,
  writeConversationWorkspaceTextContent,
} from './storage';

export type ConversationWorkspaceDirectoryEntry = FileEntry;
export type ConversationWorkspaceDirectoryResult =
  DirectoryListResult<ConversationWorkspaceDirectoryEntry>;

export interface ConversationWorkspaceReadResult extends UriFileReadResult {
  conversationId: string;
}

export type ConversationWorkspaceWriteResult = UriFileWriteResult;

export class ConversationWorkspaceDirectoryReadError extends Error {
  readonly code = 'conversation_workspace_directory_read_failed';
  readonly path: string;

  constructor(path: string, cause: unknown) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    super(`Unable to read files${path ? ` in ${path}` : ''}: ${detail}`);
    this.name = 'ConversationWorkspaceDirectoryReadError';
    this.path = path;
  }
}

export class ConversationWorkspaceFileNotFoundError extends Error {
  readonly code = 'conversation_workspace_file_not_found';
  readonly path: string;

  constructor(path: string) {
    super(`file not found: ${path}`);
    this.name = 'ConversationWorkspaceFileNotFoundError';
    this.path = path;
  }
}

export class ConversationWorkspaceFileReadError extends Error {
  readonly code = 'conversation_workspace_file_read_failed';
  readonly path: string;

  constructor(path: string, cause: unknown) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    super(`Unable to read ${path}: ${detail}`);
    this.name = 'ConversationWorkspaceFileReadError';
    this.path = path;
  }
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

function getConversationWorkspaceTargetDir(conversationId: string, safePath: string): Directory {
  const workspaceDir = getConversationWorkspaceDir(conversationId);
  return safePath ? new Directory(workspaceDir, safePath) : workspaceDir;
}

function conversationWorkspaceFileExists(file: File, safePath: string): boolean {
  try {
    return file.exists;
  } catch (error) {
    throw new ConversationWorkspaceFileReadError(safePath, error);
  }
}

export function isConversationWorkspaceImagePath(path: string): boolean {
  return hasFileExtension(path, IMAGE_FILE_EXTENSIONS);
}

export async function listConversationWorkspaceDirectory(
  conversationId: string,
  path = '',
  fallbackConversationIds?: string[],
): Promise<ConversationWorkspaceDirectoryResult> {
  const safePath = normalizeConversationWorkspacePath(path);
  const entriesByName = new Map<string, ConversationWorkspaceDirectoryEntry>();
  let readError: unknown;

  for (const targetConversationId of getWorkspaceSearchConversationIds(
    conversationId,
    fallbackConversationIds,
  )) {
    const targetDir = getConversationWorkspaceTargetDir(targetConversationId, safePath);
    let directoryExists: boolean;
    try {
      directoryExists = targetDir.exists;
    } catch (error) {
      readError ??= error;
      continue;
    }

    let entries: ReturnType<Directory['list']>;
    try {
      entries = targetDir.list();
    } catch (error) {
      if (directoryExists) {
        readError ??= error;
      }
      continue;
    }

    for (const entry of entries) {
      if (entriesByName.has(entry.name)) {
        continue;
      }

      entriesByName.set(entry.name, {
        name: entry.name,
        isDirectory: !('text' in entry),
        size: getFileEntrySize(entry),
        modifiedAt: getFileEntryModifiedAt(entry),
      });
    }
  }

  if (readError) {
    throw new ConversationWorkspaceDirectoryReadError(safePath, readError);
  }

  return {
    path: safePath,
    entries: sortFileEntries(Array.from(entriesByName.values())),
  };
}

export function conversationWorkspaceDirectoryExists(
  conversationId: string,
  path = '',
  fallbackConversationIds?: string[],
): boolean {
  const safePath = normalizeConversationWorkspacePath(path);
  if (!safePath) {
    return true;
  }

  for (const targetConversationId of getWorkspaceSearchConversationIds(
    conversationId,
    fallbackConversationIds,
  )) {
    const targetDir = getConversationWorkspaceTargetDir(targetConversationId, safePath);
    if (targetDir.exists) {
      return true;
    }
    try {
      if (targetDir.list().length > 0) {
        return true;
      }
    } catch {
      // Keep missing real filesystem directories as missing while allowing
      // file-backed workspace stores to expose inferred parent directories.
    }
  }

  return false;
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
    if (!conversationWorkspaceFileExists(file, safePath)) {
      continue;
    }

    let content: string;
    try {
      content = await file.text();
    } catch (error) {
      throw new ConversationWorkspaceFileReadError(safePath, error);
    }
    return {
      conversationId: sourceConversationId,
      path: safePath,
      content,
      size: content.length,
      uri: file.uri,
    };
  }

  throw new ConversationWorkspaceFileNotFoundError(safePath);
}

export async function writeConversationWorkspaceTextFile(
  conversationId: string,
  path: string,
  content: string,
): Promise<ConversationWorkspaceWriteResult> {
  const normalizedContent = requireTextFileContent(
    content,
    'conversation workspace file content must be a string',
  );
  const safePath = requireConversationWorkspacePath(path);
  return writeConversationWorkspaceTextContent(conversationId, safePath, normalizedContent);
}

export async function writeConversationWorkspaceBinaryFile(
  conversationId: string,
  path: string,
  bytes: Uint8Array,
): Promise<ConversationWorkspaceWriteResult> {
  const normalizedBytes = requireBinaryFileContent(
    bytes,
    'conversation workspace file content must be binary bytes',
  );
  const safePath = requireConversationWorkspacePath(path);
  return writeConversationWorkspaceBinaryContent(conversationId, safePath, normalizedBytes);
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
    if (!conversationWorkspaceFileExists(file, safePath)) {
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
    } catch (textError) {
      try {
        await file.bytes();
      } catch (binaryReadError) {
        throw new ConversationWorkspaceFileReadError(
          safePath,
          binaryReadError instanceof Error ? binaryReadError : textError,
        );
      }

      return {
        conversationId: sourceConversationId,
        kind: 'binary',
        path: safePath,
        uri: file.uri,
      };
    }
  }

  throw new ConversationWorkspaceFileNotFoundError(safePath);
}
