import {
  conversationWorkspaceDirectoryExists,
  listConversationWorkspaceDirectory,
  readConversationWorkspaceTextFile,
  writeConversationWorkspaceTextFile,
} from '../conversationWorkspace/files';
import {
  listWorkspaceDirectory,
  readWorkspaceFile,
  writeWorkspaceFile,
  type WorkspaceFileEntry,
} from './files';
import { sanitizeWorkspaceRelativePath } from './paths';
import type { WorkspaceSource } from './source';

export interface WorkspaceSourceDirectoryEntry {
  name: string;
  isDirectory: boolean;
  size?: number;
  modifiedAt?: string;
}

export interface WorkspaceSourceDirectoryResult {
  path: string;
  entries: WorkspaceSourceDirectoryEntry[];
}

export interface WorkspaceSourceReadResult {
  path: string;
  content: string;
  size: number;
}

export interface WorkspaceSourceWriteResult {
  path: string;
  size: number;
}

function normalizeWorkspaceSourcePath(path: string): string {
  return sanitizeWorkspaceRelativePath(path).replace(/\/+$/g, '');
}

function mapWorkspaceEntries(entries: WorkspaceFileEntry[]): WorkspaceSourceDirectoryEntry[] {
  return entries.map((entry) => ({
    name: entry.name,
    isDirectory: entry.isDirectory,
    ...(typeof entry.size === 'number' ? { size: entry.size } : {}),
    ...(entry.modifiedAt ? { modifiedAt: entry.modifiedAt } : {}),
  }));
}

export async function readWorkspaceSourceTextFile(
  source: WorkspaceSource,
  path: string,
): Promise<WorkspaceSourceReadResult> {
  const safePath = normalizeWorkspaceSourcePath(path);
  if (!safePath) {
    throw new Error('workspace path must not be empty');
  }

  if (source.kind === 'conversation') {
    const result = await readConversationWorkspaceTextFile(
      source.conversationId,
      safePath,
      source.fallbackConversationId ? [source.fallbackConversationId] : undefined,
    );
    return {
      path: result.path,
      content: result.content,
      size: result.size,
    };
  }

  const result = await readWorkspaceFile(source.target, safePath);
  return {
    path: result.path,
    content: result.content,
    size: result.size,
  };
}

export async function writeWorkspaceSourceTextFile(
  source: WorkspaceSource,
  path: string,
  content: string,
): Promise<WorkspaceSourceWriteResult> {
  const safePath = normalizeWorkspaceSourcePath(path);
  if (!safePath) {
    throw new Error('workspace path must not be empty');
  }

  if (source.kind === 'conversation') {
    const result = await writeConversationWorkspaceTextFile(source.conversationId, safePath, content);
    return {
      path: result.path,
      size: result.size,
    };
  }

  const result = await writeWorkspaceFile(source.target, safePath, content);
  return {
    path: result.path,
    size: result.size,
  };
}

export async function listWorkspaceSourceDirectory(
  source: WorkspaceSource,
  path = '',
): Promise<WorkspaceSourceDirectoryResult> {
  const safePath = normalizeWorkspaceSourcePath(path);

  if (source.kind === 'conversation') {
    const result = await listConversationWorkspaceDirectory(
      source.conversationId,
      safePath,
      source.fallbackConversationId ? [source.fallbackConversationId] : undefined,
    );
    return {
      path: result.path,
      entries: result.entries.map((entry) => ({
        name: entry.name,
        isDirectory: entry.isDirectory,
        ...(typeof entry.size === 'number' ? { size: entry.size } : {}),
        ...(entry.modifiedAt ? { modifiedAt: entry.modifiedAt } : {}),
      })),
    };
  }

  const result = await listWorkspaceDirectory(source.target, safePath || '.');
  return {
    path: safePath,
    entries: mapWorkspaceEntries(result.entries),
  };
}

export async function workspaceSourceDirectoryExists(
  source: WorkspaceSource,
  path = '',
): Promise<boolean> {
  const safePath = normalizeWorkspaceSourcePath(path);

  if (source.kind === 'conversation') {
    return conversationWorkspaceDirectoryExists(
      source.conversationId,
      safePath,
      source.fallbackConversationId ? [source.fallbackConversationId] : undefined,
    );
  }

  try {
    await listWorkspaceDirectory(source.target, safePath || '.');
    return true;
  } catch {
    return false;
  }
}
