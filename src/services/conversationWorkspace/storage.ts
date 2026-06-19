import { Directory, File, Paths } from 'expo-file-system';
import type { UriFileWriteResult } from '../files/contracts';
import { requireConversationId, requireConversationWorkspacePath } from '../files/pathUtils';

export function getConversationWorkspaceDir(conversationId: string): Directory {
  return new Directory(Paths.document, 'workspace', requireConversationId(conversationId));
}

export async function ensureDirectory(dir: Directory): Promise<void> {
  await dir.create({ idempotent: true, intermediates: true });
}

export async function ensureConversationWorkspaceParentDirectory(
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

export async function writeConversationWorkspaceTextContent(
  conversationId: string,
  safePath: string,
  content: string,
): Promise<UriFileWriteResult> {
  const workspaceDir = await ensureConversationWorkspaceParentDirectory(conversationId, safePath);
  const file = new File(workspaceDir, safePath);
  file.write(content);

  return {
    path: safePath,
    size: content.length,
    uri: file.uri,
  };
}

export async function writeConversationWorkspaceBinaryContent(
  conversationId: string,
  safePath: string,
  bytes: Uint8Array,
): Promise<UriFileWriteResult> {
  const workspaceDir = await ensureConversationWorkspaceParentDirectory(conversationId, safePath);
  const file = new File(workspaceDir, safePath);
  file.write(bytes);

  return {
    path: safePath,
    size: bytes.byteLength,
    uri: file.uri,
  };
}

export function getConversationWorkspaceFileUri(conversationId: string, path: string): string {
  const safePath = requireConversationWorkspacePath(path);
  return new File(getConversationWorkspaceDir(conversationId), safePath).uri;
}
