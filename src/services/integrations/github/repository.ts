import { GitHubApiError, githubApi } from '../../github/api';
import { requireSecret } from '../shared/secrets';
import type { GitHubTargetRef } from './types';
import {
  buildGitHubRefPath,
  normalizeGitHubBranch,
  normalizeGitHubRef,
  readGitHubLimitArg,
  readGitHubNumberArg,
  readGitHubStringArg,
} from './normalize';

async function sleepAsync(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function getGitHubToken(): Promise<string> {
  return requireSecret('GITHUB_TOKEN');
}

export async function getGitHubRepoMetadata(repo: string): Promise<any> {
  return githubApi(`/repos/${repo}`, await getGitHubToken());
}

export async function getGitHubDefaultBranch(repo: string): Promise<string> {
  const metadata = await getGitHubRepoMetadata(repo);
  const defaultBranch = metadata?.default_branch;
  if (!defaultBranch || !String(defaultBranch).trim()) {
    throw new Error(`GitHub repo ${repo} does not have a default branch`);
  }
  return String(defaultBranch).trim();
}

export async function getGitHubCommit(repo: string, ref: string): Promise<any> {
  return githubApi(`/repos/${repo}/commits/${encodeURIComponent(ref)}`, await getGitHubToken());
}

export async function resolveGitHubTargetRef(
  repo: string,
  args: Record<string, unknown>,
): Promise<GitHubTargetRef> {
  const pullNumber = readGitHubNumberArg(args, ['pullNumber', 'prNumber', 'pull_request']);
  if (pullNumber) {
    const pull = await githubApi<any>(`/repos/${repo}/pulls/${pullNumber}`, await getGitHubToken());
    return {
      ref: pull.head?.sha || pull.head?.ref,
      branch: pull.head?.ref,
      sha: pull.head?.sha,
      pullNumber,
      baseBranch: pull.base?.ref,
    };
  }

  const explicitBranchArg = readGitHubStringArg(args, ['branch', 'head']);
  const explicitBranch = explicitBranchArg
    ? normalizeGitHubBranch(explicitBranchArg, 'branch')
    : undefined;
  const explicitRefArg = readGitHubStringArg(args, ['ref', 'sha']);
  const explicitRef = explicitRefArg ? normalizeGitHubRef(explicitRefArg, 'ref') : explicitBranch;
  if (explicitRef) {
    const commit = await getGitHubCommit(repo, explicitRef);
    return {
      ref: explicitRef,
      branch: explicitBranch,
      sha: commit?.sha,
    };
  }

  const defaultBranch = await getGitHubDefaultBranch(repo);
  const commit = await getGitHubCommit(repo, defaultBranch);
  return {
    ref: defaultBranch,
    branch: defaultBranch,
    sha: commit?.sha,
  };
}

export async function getGitHubBranchHeadSha(repo: string, branch: string): Promise<string> {
  const ref = await githubApi<{ object?: { sha?: string } }>(
    `/repos/${repo}/git/ref/${buildGitHubRefPath(`heads/${branch}`)}`,
    await getGitHubToken(),
  );
  const sha = ref.object?.sha;
  if (!sha) {
    throw new Error(`GitHub branch ${branch} does not have a head SHA`);
  }
  return sha;
}

export async function getGitHubBranchHeadShaWithRetry(
  repo: string,
  branch: string,
  options: { attempts?: number; delayMs?: number } = {},
): Promise<string> {
  const attempts = Math.max(1, options.attempts || 4);
  const delayMs = Math.max(50, options.delayMs || 250);
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await getGitHubBranchHeadSha(repo, branch);
    } catch (error) {
      lastError = error;
      if (!(error instanceof GitHubApiError) || error.status !== 404 || attempt === attempts) {
        throw error;
      }
      await sleepAsync(delayMs * attempt);
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error(`GitHub branch ${branch} does not have a head SHA`);
}

async function reconcileGitHubBranchCreation(repo: string, branch: string): Promise<boolean> {
  try {
    await getGitHubBranchHeadShaWithRetry(repo, branch, { attempts: 3, delayMs: 200 });
    return true;
  } catch (error) {
    if (error instanceof GitHubApiError && error.status === 404) {
      return false;
    }
    throw error;
  }
}

export async function ensureGitHubBranch(
  repo: string,
  branch: string,
  fromBranch?: string,
): Promise<{ created: boolean; baseBranch: string; sha?: string }> {
  try {
    const sha = await getGitHubBranchHeadSha(repo, branch);
    return { created: false, baseBranch: fromBranch || (await getGitHubDefaultBranch(repo)), sha };
  } catch (error: unknown) {
    if (!(error instanceof GitHubApiError) || error.status !== 404) {
      throw error;
    }
  }

  const baseBranch = fromBranch || (await getGitHubDefaultBranch(repo));
  const baseSha = await getGitHubBranchHeadSha(
    repo,
    normalizeGitHubBranch(baseBranch, 'base branch'),
  );

  try {
    await githubApi(
      `/repos/${repo}/git/refs`,
      await getGitHubToken(),
      {
        method: 'POST',
        body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: baseSha }),
      },
      { responseType: 'json' },
    );
  } catch (error: unknown) {
    if (error instanceof GitHubApiError && [409, 422].includes(error.status)) {
      const branchExists = await reconcileGitHubBranchCreation(repo, branch);
      if (branchExists) {
        return { created: false, baseBranch };
      }
    }
    if (
      !(error instanceof GitHubApiError) ||
      error.status !== 422 ||
      !/already exists/i.test(error.message)
    ) {
      throw error;
    }
    return { created: false, baseBranch };
  }

  try {
    const sha = await getGitHubBranchHeadShaWithRetry(repo, branch, { attempts: 4, delayMs: 200 });
    return { created: true, baseBranch, sha };
  } catch {
    return { created: true, baseBranch, sha: baseSha };
  }
}

export async function findExistingGitHubPullRequest(
  repo: string,
  head: string,
  base: string,
): Promise<any | null> {
  const [owner] = repo.split('/');
  const query = new URLSearchParams();
  query.set('state', 'open');
  query.set('head', `${owner}:${head}`);
  query.set('base', base);
  query.set('per_page', '1');

  const pulls = await githubApi<any[]>(
    `/repos/${repo}/pulls?${query.toString()}`,
    await getGitHubToken(),
  );
  return pulls[0] || null;
}

export function getGitHubLimit(
  args: Record<string, unknown>,
  defaultValue: number,
  maxValue: number,
): number {
  return readGitHubLimitArg(args, ['limit', 'perPage'], defaultValue, maxValue);
}
