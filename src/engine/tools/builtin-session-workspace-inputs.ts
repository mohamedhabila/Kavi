import {
  listConversationWorkspaceDirectory,
  type ConversationWorkspaceDirectoryResult,
} from '../../services/conversationWorkspace/files';
import { normalizeConversationWorkspacePath } from '../../services/files/pathUtils';

export type DelegatedWorkspaceInput = Readonly<{
  name: string;
  path: string;
}>;

type ConversationWorkspaceDirectoryLister = (
  conversationId: string,
  path?: string,
  fallbackConversationIds?: string[],
) => Promise<ConversationWorkspaceDirectoryResult>;

const DELEGATED_WORKSPACE_INPUT_ROOT = 'attachments';
const MAX_DELEGATED_WORKSPACE_INPUTS = 20;
const MAX_DELEGATED_WORKSPACE_DIRECTORIES = 40;
const MAX_DELEGATED_WORKSPACE_ENTRIES = 200;
const MAX_DELEGATED_WORKSPACE_DEPTH = 4;

function normalizeDiscoveredPath(parentPath: string, entryName: string): string | undefined {
  if (
    !entryName.trim() ||
    entryName === '.' ||
    entryName === '..' ||
    entryName.includes('/') ||
    entryName.includes('\\') ||
    entryName.includes('\0')
  ) {
    return undefined;
  }
  const normalized = normalizeConversationWorkspacePath(`${parentPath}/${entryName}`);
  return normalized.startsWith(`${DELEGATED_WORKSPACE_INPUT_ROOT}/`) ? normalized : undefined;
}

/**
 * Recover a small, path-only inventory of user-supplied workspace files when
 * their original chat message has already been compacted. Workers already
 * share this workspace; this only preserves exact path discovery and grants no
 * new file authority.
 */
export async function discoverDelegatedWorkspaceInputs(
  params: {
    workspaceConversationId: string;
    workspaceReadFallbackConversationId?: string;
  },
  listDirectory: ConversationWorkspaceDirectoryLister = listConversationWorkspaceDirectory,
): Promise<DelegatedWorkspaceInput[]> {
  const fallbackConversationIds = params.workspaceReadFallbackConversationId
    ? [params.workspaceReadFallbackConversationId]
    : undefined;
  const pendingDirectories: Array<{ path: string; depth: number }> = [
    { path: DELEGATED_WORKSPACE_INPUT_ROOT, depth: 0 },
  ];
  const discovered: DelegatedWorkspaceInput[] = [];
  const seenPaths = new Set<string>();
  let visitedDirectoryCount = 0;
  let visitedEntryCount = 0;

  while (
    pendingDirectories.length > 0 &&
    discovered.length < MAX_DELEGATED_WORKSPACE_INPUTS &&
    visitedDirectoryCount < MAX_DELEGATED_WORKSPACE_DIRECTORIES &&
    visitedEntryCount < MAX_DELEGATED_WORKSPACE_ENTRIES
  ) {
    const current = pendingDirectories.shift();
    if (!current) break;
    visitedDirectoryCount += 1;

    let directory: ConversationWorkspaceDirectoryResult;
    try {
      directory = await listDirectory(
        params.workspaceConversationId,
        current.path,
        fallbackConversationIds,
      );
    } catch {
      continue;
    }

    for (const entry of directory.entries) {
      if (
        discovered.length >= MAX_DELEGATED_WORKSPACE_INPUTS ||
        visitedEntryCount >= MAX_DELEGATED_WORKSPACE_ENTRIES
      ) {
        break;
      }
      visitedEntryCount += 1;
      const path = normalizeDiscoveredPath(current.path, entry.name);
      if (!path) continue;

      if (entry.isDirectory) {
        if (
          current.depth < MAX_DELEGATED_WORKSPACE_DEPTH &&
          visitedDirectoryCount + pendingDirectories.length < MAX_DELEGATED_WORKSPACE_DIRECTORIES
        ) {
          pendingDirectories.push({ path, depth: current.depth + 1 });
        }
        continue;
      }

      if (seenPaths.has(path)) continue;
      seenPaths.add(path);
      discovered.push({
        name: entry.name.trim() || path.split('/').pop() || 'Attached file',
        path,
      });
    }
  }

  return discovered;
}
