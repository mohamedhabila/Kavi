import { githubApi } from '../../github/api';
import type { SkillToolDefinition } from '../../skills/types';
import {
  GITHUB_BRANCH_DESCRIPTION,
  GITHUB_REF_DESCRIPTION,
  GITHUB_REPO_DESCRIPTION,
  GITHUB_WORKFLOW_FILE_DESCRIPTION,
} from './constants';
import { withGitHubToolErrorHandling } from './errors';
import {
  normalizeGitHubBranch,
  normalizeGitHubRef,
  normalizeGitHubRepo,
  readGitHubNumberArg,
} from './normalize';
import { getGitHubToken, resolveGitHubTargetRef } from './repository';
import { createGitHubApiTool } from './skillToolFactory';
import {
  getGitHubWorkflowStateHelpers,
  listGitHubWorkflowRuns,
  summarizeGitHubPipelineState,
} from './workflows';

export function createGitHubWorkflowTools(): SkillToolDefinition[] {
  return [
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
              githubApi<any>(
                `/repos/${repo}/commits/${encodeURIComponent(target.ref)}/status`,
                token,
              ),
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
  ];
}
