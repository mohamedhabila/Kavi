import { useSettingsStore } from '../../store/useSettingsStore';
import { runAsyncPollLoop } from '../../engine/asyncTracking/pollLoop';
import type { ExpoWorkflowRunInspectionResult, ExpoWorkflowRunListResult } from './contracts';
import { githubApi } from '../github/api';
import { getExpoProjectPublicUrls } from './projectUrls';
import {
  resolveExpoAccount,
  resolveExpoProject,
  requireGitHubWorkflowFile,
  requireGitHubWorkflowRepo,
  trimToUndefined,
} from './projectState';
import {
  getExpoProjectExecutionMode,
  getExpoWorkflowToolUnavailableNote,
  getHostedWorkflowUnavailableNote,
} from './projectAutomation';
import { resolveExpoAccountToken, resolveProjectGithubToken } from './secrets';
import { selectWorkflowFileForAction } from './workflowSelection';
import {
  getExpoBuildFailureGuidance,
  fetchGitHubWorkflowFailureLogs,
} from './logs/workflowFailures';
import {
  ensureExpoProjectCloudMetadataAsync,
  fetchExpoWorkflowRunDetailsAsync,
  fetchExpoWorkflowRunsForFileAsync,
} from './workflows/expoHostedRuns';
import {
  fetchGitHubWorkflowJobs,
  findLatestWorkflowRunAcrossRefs,
  resolveGitHubWorkflowLogArchiveUrl,
} from './workflows/githubWorkflow';
import { getExpoGitRefCandidates } from './workflows/gitRefs';
import {
  getExpoWorkflowRunUrl,
  isWorkflowRunFailure,
  isWorkflowRunTerminal,
  mapGitHubWorkflowRun,
} from './workflowStatus';
export async function listExpoWorkflowRuns(
  projectId: string,
  args: { limit?: number } = {},
): Promise<ExpoWorkflowRunListResult> {
  const settings = useSettingsStore.getState();
  const project = resolveExpoProject(projectId, settings);
  const account = resolveExpoAccount(project.accountId, settings);
  const mode = getExpoProjectExecutionMode(project, account);
  const limit = Math.max(1, Math.min(args.limit || 5, 20));
  const publicUrls = getExpoProjectPublicUrls(project);
  const unavailableNote = getExpoWorkflowToolUnavailableNote(project, account, settings);

  if (unavailableNote) {
    return {
      status: 'unsupported',
      projectId: project.id,
      projectName: project.name,
      mode,
      runs: [],
      publicUrls,
      note: unavailableNote,
    };
  }

  if (mode === 'direct-ssh') {
    return {
      status: 'unsupported',
      projectId: project.id,
      projectName: project.name,
      mode,
      runs: [],
      publicUrls,
      note: 'Direct SSH mode runs EAS CLI synchronously on the linked host. There is no separate cloud workflow history to inspect here.',
    };
  }

  if (mode === 'github-workflow') {
    const githubToken = await resolveProjectGithubToken(project);
    const repo = requireGitHubWorkflowRepo(project);
    const workflowFile = requireGitHubWorkflowFile(project);
    const data = await githubApi<{ workflow_runs?: Array<any> }>(
      `/repos/${repo}/actions/workflows/${encodeURIComponent(workflowFile)}/runs?per_page=${limit}`,
      githubToken,
    );

    return {
      status: 'ok',
      projectId: project.id,
      projectName: project.name,
      mode,
      runs: (data.workflow_runs || []).map((run) => mapGitHubWorkflowRun(run)),
      publicUrls,
      guidance:
        'Use this after pushing a commit to a branch that matches the workflow trigger. Inspect the latest run or pass workflowRunId to expo_eas_workflow_status / expo_eas_workflow_wait to follow the auto-triggered workflow.',
    };
  }

  const token = await resolveExpoAccountToken(account);
  const hydratedProject = await ensureExpoProjectCloudMetadataAsync(project, account, token);
  const appId = hydratedProject.easProjectId;
  const workflowFile = selectWorkflowFileForAction(hydratedProject);
  const hostedWorkflowUnavailableNote = getHostedWorkflowUnavailableNote(appId, workflowFile);

  if (hostedWorkflowUnavailableNote) {
    return {
      status: 'unsupported',
      projectId: hydratedProject.id,
      projectName: hydratedProject.name,
      mode,
      runs: [],
      publicUrls,
      note: hostedWorkflowUnavailableNote,
    };
  }

  if (!appId || !workflowFile) {
    throw new Error('unreachable-hosted-workflow-state');
  }

  const runs = await fetchExpoWorkflowRunsForFileAsync(token, appId, workflowFile, limit);

  return {
    status: 'ok',
    projectId: hydratedProject.id,
    projectName: hydratedProject.name,
    mode,
    runs: runs.map((run) => ({
      id: run.id,
      url: getExpoWorkflowRunUrl(hydratedProject, account, run.id),
      status: run.status,
      conclusion: run.conclusion,
      createdAt: run.createdAt || null,
      updatedAt: run.updatedAt || null,
    })),
    publicUrls,
    note: 'Expo-hosted workflow listing is normalized here. Use it after pushing a commit to the branch that owns the .eas/workflows file, then inspect or wait on the newest run.',
    guidance:
      'Use expo_eas_workflow_status with a workflowRunId to inspect exact job and step status, or expo_eas_workflow_wait to poll until completion. Use expo_eas_graphql only when you need schema-specific fields such as stages, artifacts, or raw log URLs.',
  };
}

export async function inspectExpoWorkflowRun(
  projectId: string,
  args: {
    workflowRunId?: string;
    includeJobs?: boolean;
    includeLogs?: boolean;
  } = {},
): Promise<ExpoWorkflowRunInspectionResult> {
  const settings = useSettingsStore.getState();
  const project = resolveExpoProject(projectId, settings);
  const account = resolveExpoAccount(project.accountId, settings);
  const mode = getExpoProjectExecutionMode(project, account);
  const publicUrls = getExpoProjectPublicUrls(project);
  const unavailableNote = getExpoWorkflowToolUnavailableNote(project, account, settings);

  if (unavailableNote) {
    return {
      status: 'unsupported',
      projectId: project.id,
      projectName: project.name,
      mode,
      publicUrls,
      note: unavailableNote,
    };
  }

  if (mode === 'direct-ssh') {
    return {
      status: 'unsupported',
      projectId: project.id,
      projectName: project.name,
      mode,
      publicUrls,
      note: 'Direct SSH mode does not create a separate cloud workflow run. Inspect the original command output instead.',
    };
  }

  if (mode === 'github-workflow') {
    const githubToken = await resolveProjectGithubToken(project);
    const repo = requireGitHubWorkflowRepo(project);
    const workflowFile = requireGitHubWorkflowFile(project);
    let runId = trimToUndefined(args.workflowRunId);
    const shouldIncludeJobs = args.includeJobs !== false;
    const shouldIncludeLogs = args.includeLogs !== false;

    if (!runId) {
      const latestRun = await findLatestWorkflowRunAcrossRefs(
        repo,
        workflowFile,
        githubToken,
        getExpoGitRefCandidates({
          workflowRef: project.workflowRef,
          repoDefaultBranch: project.repoDefaultBranch,
        }),
      );
      runId = latestRun?.id ? String(latestRun.id) : undefined;
    }

    if (!runId) {
      return {
        status: 'not_found',
        projectId: project.id,
        projectName: project.name,
        mode,
        publicUrls,
        note: 'No workflow run was found for this project. Push a commit to the branch matched by the workflow trigger, then try again.',
      };
    }

    const run = await githubApi<any>(`/repos/${repo}/actions/runs/${runId}`, githubToken);
    const jobs = shouldIncludeJobs
      ? await fetchGitHubWorkflowJobs(repo, run.id, githubToken)
      : undefined;
    const logArchiveUrl = shouldIncludeLogs
      ? await resolveGitHubWorkflowLogArchiveUrl(repo, run.id, githubToken)
      : undefined;
    const failureLogs =
      shouldIncludeLogs && isWorkflowRunFailure('github-workflow', run.status, run.conclusion)
        ? await fetchGitHubWorkflowFailureLogs(repo, run.id, githubToken, jobs)
        : undefined;

    return {
      status: 'ok',
      projectId: project.id,
      projectName: project.name,
      mode,
      workflowRun: mapGitHubWorkflowRun(run),
      jobs,
      logArchiveUrl,
      failureLogs,
      publicUrls,
      guidance: failureLogs?.length
        ? 'Jobs, steps, and parsed failure log excerpts are included inline for agentic debugging. logArchiveUrl points to the full GitHub log archive when available.'
        : logArchiveUrl
          ? 'Jobs and steps are included inline. logArchiveUrl points to the GitHub log archive for the run.'
          : 'Jobs and steps are included inline. GitHub did not return a log archive URL for this run.',
    };
  }

  const token = await resolveExpoAccountToken(account);
  const hydratedProject = await ensureExpoProjectCloudMetadataAsync(project, account, token);
  const shouldIncludeJobs = args.includeJobs !== false;
  const shouldIncludeLogs = args.includeLogs !== false;
  let workflowRunId = trimToUndefined(args.workflowRunId);

  if (!workflowRunId) {
    const appId = hydratedProject.easProjectId;
    const workflowFile = selectWorkflowFileForAction(hydratedProject);
    const hostedWorkflowUnavailableNote = getHostedWorkflowUnavailableNote(appId, workflowFile);
    if (hostedWorkflowUnavailableNote) {
      return {
        status: 'unsupported',
        projectId: hydratedProject.id,
        projectName: hydratedProject.name,
        mode,
        publicUrls,
        note: hostedWorkflowUnavailableNote,
      };
    }

    if (!appId || !workflowFile) {
      throw new Error('unreachable-hosted-workflow-state');
    }

    const runs = await fetchExpoWorkflowRunsForFileAsync(token, appId, workflowFile, 1);
    workflowRunId = runs[0]?.id;
  }

  if (!workflowRunId) {
    return {
      status: 'not_found',
      projectId: hydratedProject.id,
      projectName: hydratedProject.name,
      mode,
      publicUrls,
      note: 'No Expo-hosted workflow run was found for this project. Push a commit to the branch matched by the workflow trigger, then try again.',
    };
  }

  const run = await fetchExpoWorkflowRunDetailsAsync(token, workflowRunId, {
    includeJobs: shouldIncludeJobs,
    includeLogs: shouldIncludeLogs,
  });
  const buildFailureGuidance = getExpoBuildFailureGuidance(
    run.failureLogs,
    Boolean(run.jobs?.length),
  );

  return {
    status: 'ok',
    projectId: hydratedProject.id,
    projectName: hydratedProject.name,
    mode,
    workflowRun: {
      id: run.id,
      url: getExpoWorkflowRunUrl(hydratedProject, account, run.id),
      status: run.status,
      conclusion: run.conclusion,
      createdAt: run.createdAt || null,
      updatedAt: run.updatedAt || null,
    },
    jobs: shouldIncludeJobs ? run.jobs : undefined,
    failureLogs: shouldIncludeLogs ? run.failureLogs : undefined,
    publicUrls,
    note:
      shouldIncludeLogs && run.failureLogs?.length
        ? 'Expo-hosted workflow status includes inline build-stage or failed-step excerpts when Expo exposed raw job logs, then falls back to GraphQL error diagnostics.'
        : 'Expo-hosted workflow status is available here. Use this to inspect the auto-triggered run from your latest commit. Enable includeLogs to fetch inline build-stage excerpts when Expo exposes raw job logs.',
    guidance:
      buildFailureGuidance ||
      'Use expo_eas_graphql only when you need schema-specific fields beyond the normalized run, job, step, and failure log data returned here.',
  };
}

export async function waitForExpoWorkflowRun(
  projectId: string,
  args: {
    workflowRunId?: string;
    timeoutMs?: number;
    pollIntervalMs?: number;
    includeJobs?: boolean;
    includeLogs?: boolean;
  } = {},
): Promise<ExpoWorkflowRunInspectionResult & { waitedMs: number; timedOut: boolean }> {
  if (!trimToUndefined(args.workflowRunId)) {
    const settings = useSettingsStore.getState();
    const project = resolveExpoProject(projectId, settings);
    const account = resolveExpoAccount(project.accountId, settings);
    const mode = getExpoProjectExecutionMode(project, account);
    const publicUrls = getExpoProjectPublicUrls(project);
    const unavailableNote = getExpoWorkflowToolUnavailableNote(project, account, settings);
    if (unavailableNote) {
      return {
        status: 'unsupported',
        projectId: project.id,
        projectName: project.name,
        mode,
        publicUrls,
        note: unavailableNote,
        waitedMs: 0,
        timedOut: false,
      };
    }

    if (mode === 'direct-ssh') {
      return {
        status: 'unsupported',
        projectId: project.id,
        projectName: project.name,
        mode,
        publicUrls,
        note: 'Direct SSH mode does not create a separate cloud workflow run to wait on.',
        waitedMs: 0,
        timedOut: false,
      };
    }

    return {
      status: 'not_found',
      projectId: project.id,
      projectName: project.name,
      mode,
      publicUrls,
      note: 'A workflowRunId is required before waiting so the agent does not accidentally wait on a stale latest run.',
      guidance:
        'Call the workflow run listing/status tool first, correlate a run to the current mutation, then call wait with that exact workflowRunId.',
      waitedMs: 0,
      timedOut: false,
    };
  }

  const timeoutMs = Math.max(1000, Math.min(args.timeoutMs || 10 * 60 * 1000, 60 * 60 * 1000));
  const pollIntervalMs = Math.max(1000, Math.min(args.pollIntervalMs || 5000, 60000));
  const startedAt = Date.now();
  const deadline = startedAt + timeoutMs;

  const snapshot = await runAsyncPollLoop({
    initialValue: await inspectExpoWorkflowRun(projectId, args),
    shouldContinue: (current) => {
      const workflowRun = current.workflowRun;
      return (
        current.status === 'ok' &&
        workflowRun != null &&
        !isWorkflowRunTerminal(current.mode, workflowRun.status)
      );
    },
    poll: () => inspectExpoWorkflowRun(projectId, args),
    pollIntervalMs,
    deadlineMs: deadline,
  });

  return {
    ...snapshot,
    waitedMs: Date.now() - startedAt,
    timedOut: Boolean(
      snapshot.status === 'ok' &&
      snapshot.workflowRun &&
      !isWorkflowRunTerminal(snapshot.mode, snapshot.workflowRun.status),
    ),
  };
}
