import type { ExpoCommandResult, ExpoWorkflowJobStatus } from '../contracts';
import type { ExpoProjectConfig } from '../../../types/remote';
import { GitHubApiError, getGitHubRequestHeaders, githubApi } from '../../github/api';
import {
  requireGitHubWorkflowFile,
  requireGitHubWorkflowRepo,
  trimToUndefined,
} from '../projectState';
import { normalizeExpoWorkflowGitRef } from '../logs/workflowFailures';
import { getExpoGitRefCandidates, resolveExpoProjectGitRefAsync } from './gitRefs';
async function fetchGitHubWorkflowJobs(
  repo: string,
  runId: string | number,
  token: string,
): Promise<ExpoWorkflowJobStatus[]> {
  const data = await githubApi<{ jobs?: Array<any> }>(
    `/repos/${repo}/actions/runs/${runId}/jobs?per_page=100`,
    token,
  );
  return (data.jobs || []).map((job) => ({
    id: job.id,
    name: job.name,
    status: job.status,
    conclusion: job.conclusion,
    startedAt: job.started_at || null,
    completedAt: job.completed_at || null,
    url: job.html_url || null,
    steps: Array.isArray(job.steps)
      ? job.steps.map((step: any) => ({
          number: step.number,
          name: step.name,
          status: step.status,
          conclusion: step.conclusion,
          startedAt: step.started_at || null,
          completedAt: step.completed_at || null,
        }))
      : undefined,
  }));
}

async function resolveGitHubWorkflowLogArchiveUrl(
  repo: string,
  runId: string | number,
  token: string,
): Promise<string | undefined> {
  const response = await fetch(`https://api.github.com/repos/${repo}/actions/runs/${runId}/logs`, {
    method: 'GET',
    headers: getGitHubRequestHeaders(token),
  });

  if (!response.ok) {
    return undefined;
  }

  return response.url || response.headers.get('location') || undefined;
}

async function findLatestWorkflowRun(
  repo: string,
  workflowFile: string,
  token: string,
  ref?: string,
  createdAfter?: number,
) {
  const query = new URLSearchParams();
  query.set('per_page', '10');
  query.set('event', 'workflow_dispatch');
  const normalizedRef = trimToUndefined(ref);
  if (normalizedRef) {
    query.set('branch', normalizedRef);
  }
  const data = await githubApi<{ workflow_runs: Array<any> }>(
    `/repos/${repo}/actions/workflows/${encodeURIComponent(workflowFile)}/runs?${query.toString()}`,
    token,
  );
  return (data.workflow_runs || []).find(
    (run) => !createdAfter || Date.parse(run.created_at) >= createdAfter,
  );
}

async function findLatestWorkflowRunAcrossRefs(
  repo: string,
  workflowFile: string,
  token: string,
  refs: string[],
  createdAfter?: number,
) {
  let latestRun: any;

  for (const ref of Array.from(
    new Set(
      refs
        .map((value) => trimToUndefined(value))
        .filter((value): value is string => Boolean(value)),
    ),
  )) {
    const run = await findLatestWorkflowRun(repo, workflowFile, token, ref, createdAfter);
    if (!run) {
      continue;
    }

    if (!createdAfter) {
      return run;
    }

    if (!latestRun || Date.parse(run.created_at || '') > Date.parse(latestRun.created_at || '')) {
      latestRun = run;
    }
  }

  return latestRun;
}

async function dispatchGitHubWorkflow(
  project: ExpoProjectConfig,
  action: 'build' | 'update' | 'submit' | 'deploy-web',
  githubToken: string,
  args: {
    platform?: 'android' | 'ios' | 'all';
    profile?: string;
    branch?: string;
    workflowRef?: string;
    message?: string;
    alias?: string;
    waitForCompletion?: boolean;
    waitTimeoutMs?: number;
  },
): Promise<ExpoCommandResult> {
  const repo = requireGitHubWorkflowRepo(project);
  const workflowFile = requireGitHubWorkflowFile(project);
  const refResolution = await resolveExpoProjectGitRefAsync(project, githubToken);
  const explicitWorkflowRef = normalizeExpoWorkflowGitRef(args.workflowRef);
  let ref = explicitWorkflowRef || refResolution.ref;
  const startedAt = Date.now();

  let dispatched = false;
  let lastDispatchError: unknown;
  for (const candidateRef of getExpoGitRefCandidates({
    workflowRef: ref,
    repoDefaultBranch: refResolution.repoDefaultBranch,
  })) {
    try {
      await githubApi(
        `/repos/${repo}/actions/workflows/${encodeURIComponent(workflowFile)}/dispatches`,
        githubToken,
        {
          method: 'POST',
          body: JSON.stringify({
            ref: candidateRef,
            inputs: {
              action,
              platform: args.platform || 'android',
              profile: args.profile || project.defaultBuildProfile || 'production',
              branch: args.branch || project.defaultUpdateBranch || 'production',
              message: args.message || `Triggered from Kavi for ${project.name}`,
              alias: args.alias || 'production',
            },
          }),
        },
      );
      ref = candidateRef;
      dispatched = true;
      lastDispatchError = undefined;
      break;
    } catch (error) {
      lastDispatchError = error;
      if (error instanceof GitHubApiError && error.status === 403) {
        break;
      }
      if (!(error instanceof GitHubApiError) || ![404, 422].includes(error.status)) {
        throw error;
      }
    }
  }

  if (!dispatched) {
    const candidates = getExpoGitRefCandidates({
      workflowRef: ref,
      repoDefaultBranch: refResolution.repoDefaultBranch,
    });
    const is403 = lastDispatchError instanceof GitHubApiError && lastDispatchError.status === 403;
    const hint = is403
      ? `GitHub token lacks 'Actions' permission. Update the token in GitHub Settings > Fine-grained tokens to include Actions read/write access. Tried branches: ${candidates.join(', ')}.`
      : `Tried branches: ${candidates.join(', ')}. Set the correct branch in project settings (Workflow Ref), or ensure the workflow file exists on one of these branches.`;
    throw lastDispatchError instanceof Error
      ? new Error(`${lastDispatchError.message} — ${hint}`)
      : new Error(`GitHub workflow dispatch failed. ${hint}`);
  }

  let run = await findLatestWorkflowRun(repo, workflowFile, githubToken, ref, startedAt - 5000);
  const waitTimeoutMs = args.waitTimeoutMs || 3 * 60 * 1000;
  const deadline = Date.now() + waitTimeoutMs;

  while (!run && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 2000));
    run = await findLatestWorkflowRun(repo, workflowFile, githubToken, ref, startedAt - 5000);
  }

  if (!run) {
    return { mode: 'github-workflow' };
  }

  if (args.waitForCompletion) {
    while (run.status !== 'completed' && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 5000));
      run = await githubApi<any>(`/repos/${repo}/actions/runs/${run.id}`, githubToken);
    }
  }

  return {
    mode: 'github-workflow',
    workflowRun: {
      id: run.id,
      url: run.html_url,
      status: run.status,
      conclusion: run.conclusion,
    },
  };
}

export {
  dispatchGitHubWorkflow,
  fetchGitHubWorkflowJobs,
  findLatestWorkflowRunAcrossRefs,
  resolveGitHubWorkflowLogArchiveUrl,
};
