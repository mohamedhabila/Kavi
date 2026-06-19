import { GitHubApiError, githubApi } from '../../github/api';
import type { Skill } from '../../skills/types';
import { createApiTool } from '../shared/toolFactory';
import { normalizeGitHubCommitChanges } from './commitChanges';
import {
  GITHUB_BASE_BRANCH_DESCRIPTION,
  GITHUB_BRANCH_DESCRIPTION,
  GITHUB_PATH_DESCRIPTION,
  GITHUB_REF_DESCRIPTION,
  GITHUB_REPO_DESCRIPTION,
  GITHUB_WORKFLOW_FILE_DESCRIPTION,
} from './constants';
import { listGitHubFiles, readGitHubFile } from './contents';
import { withGitHubToolErrorHandling } from './errors';
import {
  buildGitHubRefPath,
  normalizeGitHubBranch,
  normalizeGitHubPath,
  normalizeGitHubRepo,
  normalizeGitHubRef,
  readGitHubNumberArg,
} from './normalize';
import {
  ensureGitHubBranch,
  findExistingGitHubPullRequest,
  getGitHubBranchHeadShaWithRetry,
  getGitHubDefaultBranch,
  getGitHubToken,
  resolveGitHubTargetRef,
} from './repository';
import {
  getGitHubWorkflowStateHelpers,
  listGitHubWorkflowRuns,
  summarizeGitHubPipelineState,
} from './workflows';
import { getGitHubToolContract } from './toolContracts';

function normalizeLabelsInput(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((entry) => String(entry || '').trim()).filter(Boolean);
}

function createGitHubApiTool(
  ...args: Parameters<typeof createApiTool>
): ReturnType<typeof createApiTool> {
  const [name, description, properties, required, handler, options] = args;
  return createApiTool(name, description, properties, required, handler, {
    ...options,
    contract: getGitHubToolContract(name),
  });
}

export function createGitHubSkill(): Skill {
  return {
    id: 'github',
    name: 'GitHub',
    description:
      'GitHub repositories, repo files, branches, commits, issues, pull requests, and workflow status',
    version: '2.0.0',
    tools: [
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

                const blob = await githubApi<{ sha: string }>(
                  `/repos/${repo}/git/blobs`,
                  token,
                  {
                    method: 'POST',
                    body: JSON.stringify({ content: change.content, encoding: 'utf-8' }),
                  },
                );
                return { path: change.path, mode: change.mode, type: 'blob', sha: blob.sha };
              }),
            );

            let nextTree: { sha: string };
            context.phase = 'creating the next tree';
            try {
              nextTree = await githubApi<{ sha: string }>(
                `/repos/${repo}/git/trees`,
                token,
                {
                  method: 'POST',
                  body: JSON.stringify({ base_tree: baseTreeSha, tree }),
                },
              );
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
      createGitHubApiTool(
        'issues',
        'List GitHub issues for a repository. Pull requests are excluded from the result.',
        {
          repo: { type: 'string', description: GITHUB_REPO_DESCRIPTION },
          state: {
            type: 'string',
            enum: ['open', 'closed', 'all'],
            description: 'Issue state filter.',
          },
          limit: { type: 'number', description: 'Max results (default: 10)' },
        },
        ['repo'],
        async (args) => {
          const repo = normalizeGitHubRepo(args.repo);
          return withGitHubToolErrorHandling(
            {
              toolName: 'issues',
              repo,
              permissionHint: 'Issues: read',
            },
            async () => {
              const limit = Math.max(1, Math.min(Number(args.limit || 10), 100));
              const data = await githubApi<any[]>(
                `/repos/${repo}/issues?state=${args.state || 'open'}&per_page=${limit}`,
                await getGitHubToken(),
              );
              return JSON.stringify(
                data
                  .filter((issue: any) => !issue.pull_request)
                  .map((issue: any) => ({
                    number: issue.number,
                    title: issue.title,
                    state: issue.state,
                    author: issue.user?.login,
                    labels: issue.labels?.map((label: any) => label.name),
                    created: issue.created_at,
                    url: issue.html_url,
                  })),
              );
            },
          );
        },
      ),
      createGitHubApiTool(
        'create_issue',
        'Create a GitHub issue in a repository.',
        {
          repo: { type: 'string', description: GITHUB_REPO_DESCRIPTION },
          title: { type: 'string', description: 'Issue title' },
          body: { type: 'string', description: 'Issue body (markdown)' },
          labels: {
            type: 'array',
            items: { type: 'string' },
            description: 'Optional label names to apply to the issue.',
          },
        },
        ['repo', 'title'],
        async (args) => {
          const repo = normalizeGitHubRepo(args.repo);
          return withGitHubToolErrorHandling(
            {
              toolName: 'create_issue',
              repo,
              permissionHint: 'Issues: write',
            },
            async () => {
              const data = await githubApi<any>(
                `/repos/${repo}/issues`,
                await getGitHubToken(),
                {
                  method: 'POST',
                  body: JSON.stringify({
                    title: args.title,
                    body: args.body || '',
                    labels: normalizeLabelsInput(args.labels),
                  }),
                },
              );
              return JSON.stringify({ number: data.number, url: data.html_url, state: data.state });
            },
          );
        },
        { strict: true },
      ),
      createGitHubApiTool(
        'create_pull_request',
        'Create a pull request from a head branch into a base branch.',
        {
          repo: { type: 'string', description: GITHUB_REPO_DESCRIPTION },
          title: { type: 'string', description: 'Pull request title' },
          head: { type: 'string', description: GITHUB_BRANCH_DESCRIPTION },
          base: {
            type: 'string',
            description: `${GITHUB_BASE_BRANCH_DESCRIPTION} Leave null to use the repository default branch.`,
          },
          body: { type: 'string', description: 'Pull request body (markdown)' },
        },
        ['repo', 'title', 'head'],
        async (args) => {
          const repo = normalizeGitHubRepo(args.repo);
          const head = normalizeGitHubBranch(args.head, 'head branch');
          const baseBranch = args.base ? normalizeGitHubBranch(args.base, 'base branch') : undefined;
          return withGitHubToolErrorHandling(
            {
              toolName: 'create_pull_request',
              repo,
              branch: head,
              permissionHint: 'Pull requests: write',
            },
            async () => {
              const base = baseBranch || (await getGitHubDefaultBranch(repo));
              let data: any;
              let created = true;
              try {
                data = await githubApi<any>(
                  `/repos/${repo}/pulls`,
                  await getGitHubToken(),
                  {
                    method: 'POST',
                    body: JSON.stringify({ title: args.title, head, base, body: args.body || '' }),
                  },
                );
              } catch (error) {
                if (
                  !(error instanceof GitHubApiError) ||
                  error.status !== 422 ||
                  !/pull request already exists/i.test(error.message)
                ) {
                  throw error;
                }

                data = await findExistingGitHubPullRequest(repo, head, base);
                if (!data) {
                  throw error;
                }
                created = false;
              }

              return JSON.stringify({
                number: data.number,
                title: data.title,
                state: data.state,
                head: data.head?.ref,
                base: data.base?.ref,
                url: data.html_url,
                created,
              });
            },
          );
        },
        { strict: true },
      ),
      createGitHubApiTool(
        'workflow_runs',
        'List GitHub Actions workflow runs for a branch, ref, or pull request.',
        {
          repo: { type: 'string', description: GITHUB_REPO_DESCRIPTION },
          workflowFile: {
            type: 'string',
            description: `Optional ${GITHUB_WORKFLOW_FILE_DESCRIPTION}`,
          },
          branch: { type: 'string', description: GITHUB_BRANCH_DESCRIPTION },
          ref: { type: 'string', description: GITHUB_REF_DESCRIPTION },
          pullNumber: { type: 'number', description: 'Pull request number to inspect' },
          status: { type: 'string', description: 'Optional workflow run status filter' },
          event: { type: 'string', description: 'Optional workflow event filter' },
          limit: { type: 'number', description: 'Max results (default: 10)' },
        },
        ['repo'],
        async (args) => {
          const repo = normalizeGitHubRepo(args.repo);
          return withGitHubToolErrorHandling(
            {
              toolName: 'workflow_runs',
              repo,
              branch: args.branch ? normalizeGitHubBranch(args.branch, 'branch') : undefined,
              ref: args.ref ? normalizeGitHubRef(args.ref, 'ref') : undefined,
              permissionHint: 'Actions: read',
            },
            async () => {
              const target = await resolveGitHubTargetRef(repo, args);
              const runs = await listGitHubWorkflowRuns(repo, args);
              return JSON.stringify({
                repo,
                ref: target.ref,
                branch: target.branch || null,
                sha: target.sha || null,
                pullNumber: target.pullNumber || null,
                runs: runs.map((run: any) => ({
                  id: run.id,
                  name: run.name,
                  displayTitle: run.display_title,
                  event: run.event,
                  status: run.status,
                  conclusion: run.conclusion,
                  workflowId: run.workflow_id,
                  headBranch: run.head_branch,
                  headSha: run.head_sha,
                  url: run.html_url,
                  createdAt: run.created_at,
                  updatedAt: run.updated_at,
                })),
              });
            },
          );
        },
      ),
      createGitHubApiTool(
        'checks_status',
        'Fetch combined commit status, check runs, and workflow runs for a branch, ref, or pull request.',
        {
          repo: { type: 'string', description: GITHUB_REPO_DESCRIPTION },
          branch: { type: 'string', description: GITHUB_BRANCH_DESCRIPTION },
          ref: { type: 'string', description: GITHUB_REF_DESCRIPTION },
          pullNumber: { type: 'number', description: 'Pull request number to inspect' },
          workflowFile: {
            type: 'string',
            description: `Optional ${GITHUB_WORKFLOW_FILE_DESCRIPTION}`,
          },
          limit: { type: 'number', description: 'Max check and workflow entries (default: 20)' },
        },
        ['repo'],
        async (args) => {
          const repo = normalizeGitHubRepo(args.repo);
          const { isGitHubFailureState, isGitHubPendingState, normalizeGitHubRunStatus } =
            getGitHubWorkflowStateHelpers();
          return withGitHubToolErrorHandling(
            {
              toolName: 'checks_status',
              repo,
              branch: args.branch ? normalizeGitHubBranch(args.branch, 'branch') : undefined,
              ref: args.ref ? normalizeGitHubRef(args.ref, 'ref') : undefined,
              permissionHint: 'Checks: read, Commit statuses: read, and Actions: read',
            },
            async () => {
              const target = await resolveGitHubTargetRef(repo, args);
              const limit = readGitHubNumberArg(args, ['limit']) || 20;
              const token = await getGitHubToken();
              const [combinedStatus, checkRunsResponse, workflowRuns] = await Promise.all([
                githubApi<any>(`/repos/${repo}/commits/${encodeURIComponent(target.ref)}/status`, token),
                githubApi<any>(
                  `/repos/${repo}/commits/${encodeURIComponent(target.ref)}/check-runs?per_page=${limit}`,
                  token,
                ),
                listGitHubWorkflowRuns(repo, {
                  ...args,
                  branch: target.branch,
                  ref: target.ref,
                  limit,
                }),
              ]);

              const statuses = combinedStatus?.statuses || [];
              const checkRuns = checkRunsResponse?.check_runs || [];
              const state = summarizeGitHubPipelineState({
                combinedState: combinedStatus?.state,
                statuses,
                checkRuns,
                workflowRuns,
              });

              return JSON.stringify({
                repo,
                ref: target.ref,
                branch: target.branch || null,
                sha: target.sha || combinedStatus?.sha || null,
                pullNumber: target.pullNumber || null,
                baseBranch: target.baseBranch || null,
                state,
                summary: {
                  statuses: {
                    total: statuses.length,
                    failing: statuses.filter((status: any) => isGitHubFailureState(status?.state))
                      .length,
                    pending: statuses.filter((status: any) => isGitHubPendingState(status?.state))
                      .length,
                  },
                  checkRuns: {
                    total: checkRuns.length,
                    failing: checkRuns.filter((run: any) =>
                      isGitHubFailureState(run?.conclusion || run?.status),
                    ).length,
                    pending: checkRuns.filter((run: any) =>
                      isGitHubPendingState(run?.conclusion || run?.status),
                    ).length,
                  },
                  workflowRuns: {
                    total: workflowRuns.length,
                    failing: workflowRuns.filter((run: any) =>
                      isGitHubFailureState(normalizeGitHubRunStatus(run)),
                    ).length,
                    pending: workflowRuns.filter((run: any) =>
                      isGitHubPendingState(normalizeGitHubRunStatus(run)),
                    ).length,
                  },
                },
                combinedStatus: {
                  state: combinedStatus?.state || 'unknown',
                  statuses: statuses.map((status: any) => ({
                    context: status.context,
                    state: status.state,
                    description: status.description,
                    targetUrl: status.target_url,
                    updatedAt: status.updated_at,
                  })),
                },
                checkRuns: checkRuns.map((run: any) => ({
                  id: run.id,
                  name: run.name,
                  status: run.status,
                  conclusion: run.conclusion,
                  startedAt: run.started_at,
                  completedAt: run.completed_at,
                  detailsUrl: run.details_url,
                })),
                workflowRuns: workflowRuns.map((run: any) => ({
                  id: run.id,
                  name: run.name,
                  displayTitle: run.display_title,
                  event: run.event,
                  status: run.status,
                  conclusion: run.conclusion,
                  headBranch: run.head_branch,
                  headSha: run.head_sha,
                  url: run.html_url,
                  createdAt: run.created_at,
                  updatedAt: run.updated_at,
                })),
              });
            },
          );
        },
      ),
    ],
  };
}
