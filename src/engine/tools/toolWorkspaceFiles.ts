import { Directory, Paths } from 'expo-file-system';
import {
  listConversationWorkspaceDirectory as listConversationWorkspaceDirectoryResult,
  readConversationWorkspaceTextFile,
} from '../../services/conversationWorkspace/files';
import { normalizeConversationWorkspacePath } from '../../services/files/pathUtils';

export function getWorkspaceDir(conversationId: string): Directory {
  return new Directory(Paths.document, 'workspace', conversationId);
}

export function sanitizeToolWorkspacePath(inputPath: string): string {
  return normalizeConversationWorkspacePath(inputPath);
}

export async function readConversationWorkspaceFile(
  conversationId: string,
  safePath: string,
  fallbackConversationId?: string,
): Promise<string> {
  const result = await readConversationWorkspaceTextFile(
    conversationId,
    safePath,
    fallbackConversationId ? [fallbackConversationId] : undefined,
  );
  return result.content;
}

export async function listConversationWorkspaceDirectory(
  conversationId: string,
  safePath: string,
  fallbackConversationId?: string,
): Promise<Array<{ path: string; kind: 'file' | 'directory' }>> {
  const result = await listConversationWorkspaceDirectoryResult(
    conversationId,
    safePath,
    fallbackConversationId ? [fallbackConversationId] : undefined,
  );
  return result.entries.map((entry) => ({
    path: safePath ? `${safePath}/${entry.name}` : entry.name,
    kind: entry.isDirectory ? 'directory' : 'file',
  }));
}

export function createConversationFileContext(
  conversationId: string,
  fallbackConversationId?: string,
) {
  return {
    conversationId,
    readConversationFile: async (path: string) => {
      const safePath = sanitizeToolWorkspacePath(path);
      if (!safePath) {
        throw new Error('conversation workspace path must not be empty');
      }
      return readConversationWorkspaceFile(conversationId, safePath, fallbackConversationId);
    },
    listConversationDirectory: async (path: string) => {
      const safePath = sanitizeToolWorkspacePath(path);
      return listConversationWorkspaceDirectory(conversationId, safePath, fallbackConversationId);
    },
  };
}

export async function ensureWorkspaceDir(dir: Directory): Promise<void> {
  await dir.create({ idempotent: true, intermediates: true });
}
