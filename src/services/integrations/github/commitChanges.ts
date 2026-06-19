import type { SkillToolExecutionContext } from '../../skills/types';
import { sanitizeWorkspaceRelativePath } from '../../../engine/tools/fileArgumentUtils';
import type { GitHubCommitChange } from './types';
import { normalizeGitHubCommitMode, normalizeGitHubPath } from './normalize';

function normalizeConversationWorkspaceFilePath(filePath: unknown): string {
  if (typeof filePath !== 'string') {
    throw new Error('GitHub commit filePath must be a string');
  }

  const normalized = sanitizeWorkspaceRelativePath(filePath);
  if (!normalized) {
    throw new Error('GitHub commit filePath must not be empty');
  }

  return normalized;
}

async function resolveGitHubCommitChangeContent(
  path: string,
  item: Record<string, unknown>,
  deleteFlag: boolean,
  executionContext: SkillToolExecutionContext,
): Promise<string | undefined> {
  const hasContent = item.content != null;
  const hasFilePath = item.filePath != null;

  if (deleteFlag) {
    if (hasContent || hasFilePath) {
      throw new Error(
        `GitHub commit change for ${path} cannot include content or filePath when delete=true`,
      );
    }
    return undefined;
  }

  if (hasContent === hasFilePath) {
    throw new Error(
      `GitHub commit change for ${path} must include exactly one of content or filePath unless delete=true`,
    );
  }

  if (hasContent) {
    return String(item.content);
  }

  const filePath = normalizeConversationWorkspaceFilePath(item.filePath);
  if (!executionContext.readConversationFile) {
    throw new Error(
      `GitHub commit change for ${path} uses filePath "${filePath}" but no conversation workspace is available. Use content instead or invoke the tool from an active conversation.`,
    );
  }

  try {
    return await executionContext.readConversationFile(filePath);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `GitHub commit change for ${path} could not read conversation workspace file "${filePath}": ${message}`,
    );
  }
}

export async function normalizeGitHubCommitChanges(
  changes: unknown,
  executionContext: SkillToolExecutionContext = {},
): Promise<GitHubCommitChange[]> {
  if (!Array.isArray(changes) || changes.length === 0) {
    throw new Error('GitHub commit requires a non-empty changes array');
  }

  const seenPaths = new Set<string>();
  return Promise.all(
    changes.map(async (change, index) => {
      const item = change && typeof change === 'object' ? (change as Record<string, unknown>) : {};
      const path = normalizeGitHubPath(item.path);
      if (!path) {
        throw new Error(`GitHub commit change at index ${index} is missing a path`);
      }
      if (seenPaths.has(path)) {
        throw new Error(`GitHub commit contains duplicate path: ${path}`);
      }
      seenPaths.add(path);

      const deleteFlag = Boolean(item.delete);
      const content = await resolveGitHubCommitChangeContent(
        path,
        item,
        deleteFlag,
        executionContext,
      );

      return {
        path,
        content,
        delete: deleteFlag,
        mode: normalizeGitHubCommitMode(item.mode),
      };
    }),
  );
}
