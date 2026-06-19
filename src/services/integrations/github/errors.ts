import { GitHubApiError } from '../../github/api';
import { getGitHubRepoMetadata } from './repository';
import type { GitHubRepoAccessState, GitHubToolErrorContext } from './types';

function isGenericGitHubErrorMessage(message: string): boolean {
  const summary = message.replace(/^GitHub API \d+:\s*/i, '').trim();
  return (
    !summary ||
    /^(not found|resource not found|forbidden|unprocessable entity|validation failed|conflict)$/i.test(
      summary,
    )
  );
}

function formatGitHubErrorTarget(context: GitHubToolErrorContext): string {
  const parts = [
    context.repo ? `repo "${context.repo}"` : undefined,
    context.branch ? `branch "${context.branch}"` : undefined,
    context.ref ? `ref "${context.ref}"` : undefined,
    context.path ? `path "${context.path}"` : undefined,
  ].filter(Boolean);

  return parts.join(', ');
}

async function probeGitHubRepoAccess(repo: string): Promise<GitHubRepoAccessState> {
  try {
    await getGitHubRepoMetadata(repo);
    return 'accessible';
  } catch (error) {
    if (error instanceof GitHubApiError && error.status === 404) {
      return 'inaccessible';
    }
    return 'unknown';
  }
}

async function buildGitHubToolError(
  error: unknown,
  context: GitHubToolErrorContext,
): Promise<Error> {
  if (!(error instanceof GitHubApiError)) {
    return error instanceof Error ? error : new Error(String(error));
  }

  const target = formatGitHubErrorTarget(context) || 'the requested resource';
  const phase = context.phase ? ` while ${context.phase}` : '';
  const detail = isGenericGitHubErrorMessage(error.message) ? '' : ` ${error.message}.`;
  const hints: string[] = [];

  if (error.status === 404) {
    if (context.repo && !context.skipRepoProbe) {
      const access = await probeGitHubRepoAccess(context.repo);
      if (access === 'inaccessible') {
        hints.push(
          'The repository may not exist, or the token may not be granted to this private repository. GitHub often returns 404 when a fine-grained token lacks repo access.',
        );
      } else if (access === 'accessible') {
        if (context.path) {
          hints.push(
            'The repository is reachable, so the path or ref is the most likely missing resource.',
          );
        } else if (context.branch || context.ref) {
          hints.push(
            'The repository is reachable, so the branch or ref is the most likely missing resource or not yet visible.',
          );
        } else {
          hints.push(
            'The repository is reachable, so a referenced Git object is the most likely missing resource.',
          );
        }
      }
    }

    if (context.permissionHint) {
      hints.push(`Required permission: ${context.permissionHint}.`);
    }

    return new Error(
      `GitHub ${context.toolName}${phase} returned 404 for ${target}.${detail}${
        hints.length ? ` ${hints.join(' ')}` : ''
      }`.trim(),
    );
  }

  if (error.status === 403) {
    if (context.permissionHint) {
      hints.push(`Required permission: ${context.permissionHint}.`);
    }

    return new Error(
      `GitHub ${context.toolName}${phase} was forbidden for ${target}.${detail}${
        hints.length ? ` ${hints.join(' ')}` : ''
      }`.trim(),
    );
  }

  if (error.status === 409) {
    return new Error(
      `GitHub ${context.toolName}${phase} hit a conflict for ${target}.${detail} Refresh the branch state and retry with the latest refs.`.trim(),
    );
  }

  if (error.status === 422) {
    return new Error(
      `GitHub ${context.toolName}${phase} was rejected for ${target}.${detail} Check the argument values and repo state before retrying.`.trim(),
    );
  }

  return new Error(`GitHub ${context.toolName}${phase} failed for ${target}: ${error.message}`);
}

export async function withGitHubToolErrorHandling<T>(
  context: GitHubToolErrorContext,
  operation: () => Promise<T>,
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    throw await buildGitHubToolError(error, context);
  }
}
