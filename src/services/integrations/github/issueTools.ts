import { GitHubApiError, githubApi } from '../../github/api';
import type { SkillToolDefinition } from '../../skills/types';
import {
  GITHUB_BASE_BRANCH_DESCRIPTION,
  GITHUB_BRANCH_DESCRIPTION,
  GITHUB_REPO_DESCRIPTION,
} from './constants';
import { withGitHubToolErrorHandling } from './errors';
import { normalizeGitHubBranch, normalizeGitHubRepo } from './normalize';
import {
  findExistingGitHubPullRequest,
  getGitHubDefaultBranch,
  getGitHubToken,
} from './repository';
import { createGitHubApiTool } from './skillToolFactory';

function normalizeLabelsInput(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((entry) => String(entry || '').trim()).filter(Boolean);
}

export function createGitHubIssueTools(): SkillToolDefinition[] {
  return [
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
            const data = await githubApi<any>(`/repos/${repo}/issues`, await getGitHubToken(), {
              method: 'POST',
              body: JSON.stringify({
                title: args.title,
                body: args.body || '',
                labels: normalizeLabelsInput(args.labels),
              }),
            });
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
              data = await githubApi<any>(`/repos/${repo}/pulls`, await getGitHubToken(), {
                method: 'POST',
                body: JSON.stringify({ title: args.title, head, base, body: args.body || '' }),
              });
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
  ];
}
