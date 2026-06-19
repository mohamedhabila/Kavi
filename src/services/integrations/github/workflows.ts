import { githubApi } from '../../github/api';
import { getGitHubToken, resolveGitHubTargetRef } from './repository';
import type { GitHubTargetRef } from './types';
import { normalizeGitHubPath } from './normalize';

export async function listGitHubWorkflowRuns(
  repo: string,
  args: Record<string, unknown>,
): Promise<any[]> {
  const target = await resolveGitHubTargetRef(repo, args);
  const query = new URLSearchParams();
  query.set('per_page', String(Math.max(1, Math.min(Number(args.limit || args.perPage || 10), 100))));
  const status = typeof args.status === 'string' ? args.status.trim() : '';
  const event = typeof args.event === 'string' ? args.event.trim() : '';
  const workflowFileArg =
    typeof args.workflowFile === 'string'
      ? args.workflowFile
      : typeof args.workflow === 'string'
        ? args.workflow
        : '';
  const workflowFile = workflowFileArg ? normalizeGitHubPath(workflowFileArg) : undefined;

  if (target.branch) {
    query.set('branch', target.branch);
  }
  if (target.sha) {
    query.set('head_sha', target.sha);
  }
  if (status) {
    query.set('status', status);
  }
  if (event) {
    query.set('event', event);
  }

  const basePath = workflowFile
    ? `/repos/${repo}/actions/workflows/${encodeURIComponent(workflowFile)}/runs`
    : `/repos/${repo}/actions/runs`;
  const response = await githubApi<{ workflow_runs?: any[] }>(
    `${basePath}?${query.toString()}`,
    await getGitHubToken(),
  );
  return response.workflow_runs || [];
}

function isGitHubFailureState(value: string | null | undefined): boolean {
  const normalized = String(value || '')
    .trim()
    .toLowerCase();
  return [
    'error',
    'failure',
    'failed',
    'cancelled',
    'timed_out',
    'action_required',
    'startup_failure',
    'stale',
  ].includes(normalized);
}

function isGitHubPendingState(value: string | null | undefined): boolean {
  const normalized = String(value || '')
    .trim()
    .toLowerCase();
  return ['queued', 'in_progress', 'pending', 'requested', 'waiting'].includes(normalized);
}

function normalizeGitHubRunStatus(run: any): string {
  return String(run?.conclusion || run?.status || run?.state || 'unknown');
}

export function summarizeGitHubPipelineState(params: {
  combinedState?: string | null;
  statuses: any[];
  checkRuns: any[];
  workflowRuns: any[];
}): 'success' | 'pending' | 'failure' | 'unknown' {
  if (isGitHubFailureState(params.combinedState)) {
    return 'failure';
  }

  const states = [
    ...params.statuses.map((status) => status?.state),
    ...params.checkRuns.map((run) => run?.conclusion || run?.status),
    ...params.workflowRuns.map((run) => run?.conclusion || run?.status),
  ];

  if (states.some((state) => isGitHubFailureState(state))) {
    return 'failure';
  }
  if (states.some((state) => isGitHubPendingState(state))) {
    return 'pending';
  }
  if (
    params.combinedState === 'success' ||
    states.some(
      (state) =>
        String(state || '')
          .trim()
          .toLowerCase() === 'success',
    )
  ) {
    return 'success';
  }
  return 'unknown';
}

export function getGitHubWorkflowTarget(
  repo: string,
  args: Record<string, unknown>,
): Promise<GitHubTargetRef> {
  return resolveGitHubTargetRef(repo, args);
}

export function getGitHubWorkflowStateHelpers() {
  return {
    isGitHubFailureState,
    isGitHubPendingState,
    normalizeGitHubRunStatus,
  };
}
