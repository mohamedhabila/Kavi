import * as Crypto from 'expo-crypto';
import { getOptionalToolStringArg, requireToolStringArg } from './fileArgumentUtils';
import { resolveConversationWorkspaceSource } from '../../services/workspaces/source';
import {
  listWorkspaceSourceDirectory,
  readWorkspaceSourceTextFile,
  writeWorkspaceSourceTextFile,
  workspaceSourceDirectoryExists,
} from '../../services/workspaces/sourceFiles';

export async function executeReadFile(
  args: { path: string },
  conversationId: string,
  fallbackConversationId?: string,
): Promise<string> {
  const pathArg = requireToolStringArg(args as Record<string, unknown>, 'path', 'read_file');
  if (pathArg.error) return pathArg.error;

  const source = resolveConversationWorkspaceSource(conversationId, fallbackConversationId);
  try {
    const result = await readWorkspaceSourceTextFile(source, pathArg.value!);
    return result.content;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return `Error: ${message}`;
  }
}

export async function executeWriteFile(
  args: { path: string; content: string },
  conversationId: string,
  fallbackConversationId?: string,
): Promise<string> {
  const pathArg = requireToolStringArg(args as Record<string, unknown>, 'path', 'write_file', {
    allRequired: ['path', 'content'],
  });
  if (pathArg.error) return pathArg.error;
  const contentArg = requireToolStringArg(
    args as Record<string, unknown>,
    'content',
    'write_file',
    { allowEmpty: true, allRequired: ['path', 'content'] },
  );
  if (contentArg.error) return contentArg.error;

  const source = resolveConversationWorkspaceSource(conversationId, fallbackConversationId);
  let sha256: string;
  let result: Awaited<ReturnType<typeof writeWorkspaceSourceTextFile>>;
  try {
    sha256 = await Crypto.digestStringAsync(
      Crypto.CryptoDigestAlgorithm.SHA256,
      contentArg.value!,
    );
    result = await writeWorkspaceSourceTextFile(source, pathArg.value!, contentArg.value!);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return `Error: ${message}`;
  }

  try {
    const readback = await readWorkspaceSourceTextFile(source, result.path);
    if (readback.path !== result.path || readback.content !== contentArg.value!) {
      return JSON.stringify({
        status: 'written_unverified',
        path: result.path,
        size: result.size,
        sha256,
        verificationError: 'workspace_readback_mismatch',
      });
    }
    return JSON.stringify({
      status: 'written',
      path: readback.path,
      size: readback.size,
      sha256,
      summary: `Wrote and verified ${readback.size} chars at ${readback.path}`,
    });
  } catch {
    return JSON.stringify({
      status: 'written_unverified',
      path: result.path,
      size: result.size,
      sha256,
      verificationError: 'workspace_readback_failed',
    });
  }
}

export async function executeListFiles(
  args: { path?: string },
  conversationId: string,
  fallbackConversationId?: string,
): Promise<string> {
  const pathArg = getOptionalToolStringArg(args as Record<string, unknown>, 'path', 'list_files');
  if (pathArg.error) return pathArg.error;

  const source = resolveConversationWorkspaceSource(conversationId, fallbackConversationId);
  try {
    const requestedPath = pathArg.value || '';
    if (requestedPath && !(await workspaceSourceDirectoryExists(source, requestedPath))) {
      return `Error: directory not found: ${requestedPath.trim() || '/'}`;
    }
    const result = await listWorkspaceSourceDirectory(source, requestedPath);
    const entries = result.entries
      .map((entry) => (entry.isDirectory ? `${entry.name}/` : entry.name))
      .sort();

    return entries.length > 0 ? entries.join('\n') : '(empty directory)';
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return `Error: ${message}`;
  }
}
