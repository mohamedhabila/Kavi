import { GitHubApiError, githubApi } from '../../github/api';
import type { SkillToolDefinition } from '../../skills/types';
import { normalizeGitHubCommitChanges } from './commitChanges';
import {
  GITHUB_BASE_BRANCH_DESCRIPTION,
  GITHUB_BRANCH_DESCRIPTION,
  GITHUB_PATH_DESCRIPTION,
  GITHUB_REF_DESCRIPTION,
  GITHUB_REPO_DESCRIPTION,
} from './constants';
import { listGitHubFiles, readGitHubFile } from './contents';
import { withGitHubToolErrorHandling } from './errors';
import {
  buildGitHubRefPath,
  normalizeGitHubBranch,
  normalizeGitHubPath,
  normalizeGitHubRepo,
  normalizeGitHubRef,
} from './normalize';
import {
  ensureGitHubBranch,
  getGitHubBranchHeadShaWithRetry,
  getGitHubToken,
} from './repository';
import { createGitHubApiTool } from './skillToolFactory';

export function createGitHubRepositoryTools(): SkillToolDefinition[] {
  return [
    createGitHubApiTool(
      'repos',
      'List repositories that the configured GitHub token can access. Use this first when the repository is unknown.',
      {
        sort: {
          type: 'string',
          enum: ['updated', 'stars', 'name'],
          description: 'Sort order for the repository list.',
        },
        limit: { type: 'number', description: 'Max results (default: 10)' },
      },
      [],
      async (args) => {
        const limit = Math.max(1, Math.min(Number(args.limit || 10), 100));
        const data = await githubApi<any[]>(
          `/user/repos?sort=${args.sort || 'updated'}&per_page=${limit}`,
          await getGitHubToken(),
        );
        return JSON.stringify(
          data.map((repo: any) => ({
            name: repo.full_name,
            description: repo.description,
            stars: repo.stargazers_count,
            language: repo.language,
            updated: repo.updated_at,
            url: repo.html_url,
            defaultBranch: repo.default_branch,
            private: repo.private,
          })),
        );
      },
    ),
    createGitHubApiTool(
      'branches',
      'List branches for a GitHub repository.',
      {
        repo: { type: 'string', description: GITHUB_REPO_DESCRIPTION },
        limit: { type: 'number', description: 'Max results (default: 20)' },
      },
      ['repo'],
      async (args) => {
        const repo = normalizeGitHubRepo(args.repo);
        return withGitHubToolErrorHandling(
          {
            toolName: 'branches',
            repo,
            permissionHint: 'Contents: read',
          },
          async () => {
            const limit = Math.max(1, Math.min(Number(args.limit || 20), 100));
            const data = await githubApi<any[]>(
              `/repos/${repo}/branches?per_page=${limit}`,
              await getGitHubToken(),
            );
            return JSON.stringify(
              data.map((branch: any) => ({
                name: branch.name,
                protected: branch.protected,
                sha: branch.commit?.sha,
                url: branch.commit?.url,
              })),
            );
          },
        );
      },
    ),
    createGitHubApiTool(
      'list_files',
      'List files in a GitHub repository directory.',
      {
        repo: { type: 'string', description: GITHUB_REPO_DESCRIPTION },
        path: {
          type: 'string',
          description: `${GITHUB_PATH_DESCRIPTION} Leave empty or null to list the repository root.`,
        },
        ref: { type: 'string', description: GITHUB_REF_DESCRIPTION },
      },
      ['repo'],
      async (args) => {
        const repo = normalizeGitHubRepo(args.repo);
        const path = normalizeGitHubPath(args.path);
        const ref = args.ref ? normalizeGitHubRef(args.ref, 'ref') : undefined;
        return withGitHubToolErrorHandling(
          {
            toolName: 'list_files',
            repo,
            path: path || undefined,
            ref,
            permissionHint: 'Contents: read',
          },
          async () => JSON.stringify(await listGitHubFiles(repo, path, ref)),
        );
      },
      { strict: true },
    ),
    createGitHubApiTool(
      'read_file',
      'Read a text file from a GitHub repository.',
      {
        repo: { type: 'string', description: GITHUB_REPO_DESCRIPTION },
        path: { type: 'string', description: GITHUB_PATH_DESCRIPTION },
        ref: { type: 'string', description: GITHUB_REF_DESCRIPTION },
      },
      ['repo', 'path'],
      async (args) => {
        const repo = normalizeGitHubRepo(args.repo);
        const path = normalizeGitHubPath(args.path);
        const ref = args.ref ? normalizeGitHubRef(args.ref, 'ref') : undefined;
        return withGitHubToolErrorHandling(
          {
            toolName: 'read_file',
            repo,
            path,
            ref,
            permissionHint: 'Contents: read',
          },
          async () => JSON.stringify(await readGitHubFile(repo, path, ref)),
        );
      },
      { strict: true },
    ),
    createGitHubApiTool(
      'create_branch',
      'Create a branch in a GitHub repository.',
      {
        repo: { type: 'string', description: GITHUB_REPO_DESCRIPTION },
        branch: { type: 'string', description: GITHUB_BRANCH_DESCRIPTION },
        baseBranch: {
          type: 'string',
          description: `${GITHUB_BASE_BRANCH_DESCRIPTION} Leave null to start from the repository default branch.`,
        },
      },
      ['repo', 'branch'],
      async (args) => {
        const repo = normalizeGitHubRepo(args.repo);
        const branch = normalizeGitHubBranch(args.branch);
        const baseBranch = args.baseBranch
          ? normalizeGitHubBranch(args.baseBranch, 'base branch')
          : undefined;
        const context = {
          toolName: 'create_branch',
          repo,
          branch,
          permissionHint: 'Contents: write',
          phase: 'resolving the target branch',
        };
        return withGitHubToolErrorHandling(context, async () => {
          context.phase = 'creating or locating the target branch';
          const result = await ensureGitHubBranch(repo, branch, baseBranch);
          context.phase = 'verifying the new branch head';
          const sha =
            result.sha ||
            (await getGitHubBranchHeadShaWithRetry(repo, branch, {
              attempts: 5,
              delayMs: 300,
            }).catch(() => 'pending'));
          return JSON.stringify({
            repo,
            branch,
            baseBranch: result.baseBranch,
            created: result.created,
            sha,
          });
        });
      },
      { strict: true },
    ),
    createGitHubApiTool(
      'commit_files',
      'Create a single atomic commit on a branch with one or more file changes.',
      {
        repo: { type: 'string', description: GITHUB_REPO_DESCRIPTION },
        branch: { type: 'string', description: GITHUB_BRANCH_DESCRIPTION },
        baseBranch: {
          type: 'string',
          description: `${GITHUB_BASE_BRANCH_DESCRIPTION} Used only if the target branch does not exist yet.`,
        },
        message: { type: 'string', description: 'Commit message for the new commit.' },
        changes: {
          type: 'array',
          minItems: 1,
          description:
            'One or more file changes applied together in a single commit. Each item needs a repo path and exactly one of content, filePath, or delete=true.',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              path: { type: 'string', description: GITHUB_PATH_DESCRIPTION },
              content: {
                type: 'string',
                description: 'UTF-8 file contents for create or update operations.',
              },
              filePath: {
                type: 'string',
                description:
                  'Conversation workspace file path to read UTF-8 content from before creating or updating the GitHub file.',
              },
              delete: {
                type: 'boolean',
                description: 'Set true to delete the file instead of writing new content.',
              },
              mode: {
                type: 'string',
                enum: ['100644', '100755', '120000'],
                description: 'Git file mode. Use 100644 for normal text files.',
              },
            },
            required: ['path'],
          },
        },
      },
      ['repo', 'branch', 'message', 'changes'],
      async (args, executionContext = {}) => {
        const repo = normalizeGitHubRepo(args.repo);
        const branch = normalizeGitHubBranch(args.branch);
        const baseBranch = args.baseBranch
          ? normalizeGitHubBranch(args.baseBranch, 'base branch')
          : undefined;
        const message = String(args.message || '').trim();
        if (!message) {
          throw new Error('GitHub commit message is required');
        }

        const changes = await normalizeGitHubCommitChanges(args.changes, executionContext);
        const workflowTouched = changes.some((change) =>
          change.path.startsWith('.github/workflows/'),
        );
        const context = {
          toolName: 'commit_files',
          repo,
          branch,
          permissionHint: workflowTouched
            ? 'Contents: write and Workflows: write when modifying .github/workflows/'
            : 'Contents: write',
          phase: 'resolving the target branch',
        };
        return withGitHubToolErrorHandling(context, async () => {
          context.phase = 'creating or locating the target branch';
          const ensuredBranch = await ensureGitHubBranch(repo, branch, baseBranch);
          const token = await getGitHubToken();

          context.phase = 'reading the current branch head';
          const headSha =
            ensuredBranch.sha ||
            (await getGitHubBranchHeadShaWithRetry(repo, branch, { attempts: 5, delayMs: 300 }));
          context.phase = 'reading the current commit tree';
          const headCommit = await githubApi<{ tree?: { sha?: string } }>(
            `/repos/${repo}/git/commits/${headSha}`,
            token,
          );
          const baseTreeSha = headCommit.tree?.sha;
          if (!baseTreeSha) {
            throw new Error(`GitHub branch ${branch} does not have a tree SHA`);
          }

          context.phase = 'creating blobs for changed files';
          const tree = await Promise.all(
            changes.map(async (change) => {
              if (change.delete) {
                return { path: change.path, mode: change.mode, type: 'blob', sha: null };
              }

              const blob = await githubApi<{ sha: string }>(`/repos/${repo}/git/blobs`, token, {
                method: 'POST',
                body: JSON.stringify({ content: change.content, encoding: 'utf-8' }),
              });
              return { path: change.path, mode: change.mode, type: 'blob', sha: blob.sha };
            }),
          );

          let nextTree: { sha: string };
          context.phase = 'creating the next tree';
          try {
            nextTree = await githubApi<{ sha: string }>(`/repos/${repo}/git/trees`, token, {
              method: 'POST',
              body: JSON.stringify({ base_tree: baseTreeSha, tree }),
            });
          } catch (error) {
            if (error instanceof GitHubApiError && error.status === 403 && workflowTouched) {
              throw new GitHubApiError(
                403,
                `${error.message}. Committing to .github/workflows/ requires the 'Workflows' permission on the GitHub token. Update the token permissions in GitHub Settings > Fine-grained tokens.`,
                error.responseBody,
              );
            }
            throw error;
          }

          context.phase = 'creating the commit object';
          const commit = await githubApi<{ sha: string; html_url?: string }>(
            `/repos/${repo}/git/commits`,
            token,
            {
              method: 'POST',
              body: JSON.stringify({ message, tree: nextTree.sha, parents: [headSha] }),
            },
          );
          context.phase = 'updating the branch reference';
          await githubApi(
            `/repos/${repo}/git/refs/${buildGitHubRefPath(`heads/${branch}`)}`,
            token,
            {
              method: 'PATCH',
              body: JSON.stringify({ sha: commit.sha, force: false }),
            },
          );

          return JSON.stringify({
            repo,
            branch,
            baseBranch: ensuredBranch.baseBranch,
            branchCreated: ensuredBranch.created,
            commitSha: commit.sha,
            url: commit.html_url,
            changedFiles: changes.map((change) => change.path),
          });
        });
      },
      { strict: true },
    ),
  ];
}
