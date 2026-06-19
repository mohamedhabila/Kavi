import { executeSshCommand } from '../ssh/connector';
import { addRemoteArtifact, startRemoteJob, updateRemoteJob } from '../remote/store';
import { useSettingsStore } from '../../store/useSettingsStore';
import type { ExpoProjectProbeResult, ExpoCommandResult } from './contracts';
import type { RemoteJobRecord } from '../../types/remote';
import { getExpoProjectPublicUrls } from './projectUrls';
import {
  requireGitHubWorkflowFile,
  requireGitHubWorkflowRepo,
  resolveExpoAccount,
  resolveExpoProject,
  resolveExpoProjectSshTarget,
} from './projectState';
import {
  getExpoProjectExecutionMode,
  getExpoProjectReadiness,
  getExpoProjectReadinessLabel,
} from './projectAutomation';
import { resolveExpoAccountToken, resolveProjectGithubToken } from './secrets';
import { selectWorkflowFileForAction } from './workflowSelection';
import {
  ensureExpoProjectCloudMetadataAsync,
  fetchExpoWorkflowRunsForFileAsync,
} from './workflows/expoHostedRuns';
import { buildDirectCommand } from './workflows/directSsh';
import { dispatchExpoWorkflow } from './workflows/expoHostedDispatch';
import { getExpoGitRefCandidates, resolveExpoProjectGitRefAsync } from './workflows/gitRefs';
import {
  dispatchGitHubWorkflow,
  findLatestWorkflowRunAcrossRefs,
} from './workflows/githubWorkflow';
import { validateExpoProjectExecution } from './workflows/validation';
import {
  getExpoWorkflowRunUrl,
  isWorkflowRunFailure,
  isWorkflowRunTerminal,
} from './workflowStatus';
export async function runExpoProjectAction(
  projectId: string,
  action: 'build' | 'update' | 'submit' | 'deploy-web',
  args: {
    platform?: 'android' | 'ios' | 'all';
    profile?: string;
    branch?: string;
    workflowRef?: string;
    message?: string;
    alias?: string;
    waitForCompletion?: boolean;
    waitTimeoutMs?: number;
  } = {},
): Promise<ExpoCommandResult> {
  const settings = useSettingsStore.getState();
  const project = resolveExpoProject(projectId, settings);
  const account = resolveExpoAccount(project.accountId, settings);
  const executionMode = getExpoProjectExecutionMode(project, account);
  const readiness = getExpoProjectReadiness(project, account, settings);
  if (!readiness.launchable) {
    throw new Error(readiness.reason);
  }

  const preflightChecks = await validateExpoProjectExecution(project, account, settings);

  const jobSummary = `${project.name} ${action}`;
  const jobId = startRemoteJob({
    jobType: 'expo-job',
    targetId: project.id,
    providerId: account.id,
    status: 'running',
    requestedBy: 'agent',
    executionSurface: 'expo-eas',
    summary: jobSummary,
    progressText:
      executionMode === 'direct-ssh'
        ? 'Validated project and running EAS CLI over SSH'
        : executionMode === 'eas-workflow'
          ? 'Validated Expo workflow access and dispatching EAS workflow'
          : 'Validated workflow access and dispatching GitHub workflow',
  } as Omit<RemoteJobRecord, 'id' | 'createdAt' | 'updatedAt' | 'artifacts'>);

  for (const check of preflightChecks) {
    addRemoteArtifact(jobId, {
      kind: 'log-snippet',
      title: `Preflight · ${check.stage}`,
      value: `${check.ok ? 'OK' : 'FAIL'} · ${check.message}`,
    });
  }

  try {
    const result: ExpoCommandResult =
      executionMode === 'direct-ssh'
        ? await (async () => {
            const token = await resolveExpoAccountToken(account);
            const sshTarget = resolveExpoProjectSshTarget(project, settings);
            const command = buildDirectCommand(project, account, action, args, token);
            const output = await executeSshCommand(sshTarget, command);
            return { mode: 'direct-ssh', command, output };
          })()
        : executionMode === 'eas-workflow'
          ? await dispatchExpoWorkflow(project, account, action, args)
          : await (async () => {
              const githubToken = await resolveProjectGithubToken(project);
              return dispatchGitHubWorkflow(project, action, githubToken, args);
            })();

    const publicUrls = action === 'deploy-web' ? getExpoProjectPublicUrls(project) : undefined;
    const normalizedResult: ExpoCommandResult = {
      ...result,
      jobId,
      publicUrls,
      note:
        result.note ||
        (result.workflowRun && result.mode !== 'direct-ssh'
          ? 'This was a manual workflow dispatch. For GitHub-linked Expo projects, prefer repository changes plus .eas/workflows/*.yml on the target branch, then push a commit and monitor the auto-triggered run.'
          : undefined),
      guidance: result.workflowRun
        ? 'Use expo_eas_workflow_status for an exact snapshot of this run, or expo_eas_workflow_wait to poll until it reaches a terminal state. If the build fails, inspect failureLogs first; missing dependency installation is the most common Expo root cause.'
        : result.mode === 'direct-ssh'
          ? 'Direct SSH mode runs synchronously; inspect output for the final result.'
          : undefined,
    };

    updateRemoteJob(jobId, {
      status: normalizedResult.workflowRun
        ? !isWorkflowRunTerminal(normalizedResult.mode, normalizedResult.workflowRun.status)
          ? 'running'
          : isWorkflowRunFailure(
                normalizedResult.mode,
                normalizedResult.workflowRun.status,
                normalizedResult.workflowRun.conclusion,
              )
            ? 'failed'
            : 'completed'
        : 'completed',
      externalId: result.workflowRun?.id ? String(result.workflowRun.id) : undefined,
      progressText: normalizedResult.workflowRun
        ? `${normalizedResult.workflowRun.status}${normalizedResult.workflowRun.conclusion ? ` · ${normalizedResult.workflowRun.conclusion}` : ''}`
        : 'Completed',
    });

    if (normalizedResult.output?.trim()) {
      addRemoteArtifact(jobId, {
        kind: 'log-snippet',
        title: `${action} output`,
        value: normalizedResult.output.slice(0, 12000),
      });
    }
    if (normalizedResult.workflowRun?.url) {
      addRemoteArtifact(jobId, {
        kind: 'export-bundle',
        title: `${action} workflow run`,
        uri: normalizedResult.workflowRun.url,
        mimeType: 'text/uri-list',
      });
    }
    for (const publicUrl of publicUrls || []) {
      addRemoteArtifact(jobId, {
        kind: 'export-bundle',
        title: `${action} ${publicUrl.label}`,
        uri: publicUrl.url,
        mimeType: 'text/uri-list',
      });
    }

    return normalizedResult;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'expo-action-failed';
    updateRemoteJob(jobId, {
      status: 'failed',
      error: message,
      progressText: 'Failed',
    });
    throw error;
  }
}

export async function probeExpoProject(projectId: string): Promise<ExpoProjectProbeResult> {
  const settings = useSettingsStore.getState();
  const project = resolveExpoProject(projectId, settings);
  const account = resolveExpoAccount(project.accountId, settings);
  const executionMode = getExpoProjectExecutionMode(project, account);
  const readiness = getExpoProjectReadiness(project, account, settings);
  const checkedAt = Date.now();

  if (!readiness.launchable) {
    return {
      ok: false,
      message: getExpoProjectReadinessLabel(readiness),
      checkedAt,
      checks: [{ stage: 'config', ok: false, message: getExpoProjectReadinessLabel(readiness) }],
    };
  }

  try {
    const checks = await validateExpoProjectExecution(project, account, settings);
    if (executionMode === 'direct-ssh') {
      return {
        ok: true,
        message: checks[checks.length - 1]?.message || 'EAS CLI ready',
        checkedAt,
        checks,
      };
    }

    if (executionMode === 'eas-workflow') {
      const token = await resolveExpoAccountToken(account);
      const hydratedProject = await ensureExpoProjectCloudMetadataAsync(project, account, token);
      const workflowFile = selectWorkflowFileForAction(hydratedProject);
      const runs =
        hydratedProject.easProjectId && workflowFile
          ? await fetchExpoWorkflowRunsForFileAsync(
              token,
              hydratedProject.easProjectId,
              workflowFile,
              1,
            )
          : [];
      const latestRun = runs[0];

      return {
        ok: true,
        message: latestRun
          ? `Expo workflow ready · last run ${latestRun.status} · push the next commit to start a new run`
          : `Expo workflow ready · ${workflowFile} · push a commit to trigger runs`,
        checkedAt,
        checks,
        workflowRun: latestRun
          ? {
              id: latestRun.id,
              url: getExpoWorkflowRunUrl(hydratedProject, account, latestRun.id),
              status: latestRun.status,
              conclusion: latestRun.conclusion,
            }
          : undefined,
      };
    }

    const githubToken = await resolveProjectGithubToken(project);
    const refResolution = await resolveExpoProjectGitRefAsync(project, githubToken);
    const latestRun = await findLatestWorkflowRunAcrossRefs(
      requireGitHubWorkflowRepo(project),
      requireGitHubWorkflowFile(project),
      githubToken,
      getExpoGitRefCandidates({
        workflowRef: refResolution.ref,
        repoDefaultBranch: refResolution.repoDefaultBranch,
      }),
    );
    return {
      ok: true,
      message: latestRun
        ? `Workflow ready · last run ${latestRun.status}`
        : 'Workflow dispatch ready',
      checkedAt,
      checks,
      workflowRun: latestRun
        ? {
            id: latestRun.id,
            url: latestRun.html_url,
            status: latestRun.status,
            conclusion: latestRun.conclusion,
          }
        : undefined,
    };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : 'Expo project probe failed',
      checkedAt,
      checks: [],
    };
  }
}
