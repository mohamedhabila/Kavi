import type { ExpoAccountConfig, ExpoProjectConfig } from '../../../types/remote';
import type { ExpoCommandResult } from '../contracts';
import { expoGraphqlRequest } from '../providers/expoGraphql';
import { resolveExpoAccountToken, tryResolveProjectGithubToken } from '../secrets';
import { selectWorkflowFileForAction } from '../workflowSelection';
import {
  getExpoWorkflowDispatchInputs,
  normalizeExpoWorkflowGitRef,
} from '../logs/workflowFailures';
import { getExpoWorkflowRunUrl } from '../workflowStatus';
import {
  ensureExpoProjectCloudMetadataAsync,
  fetchExpoWorkflowRunByIdAsync,
} from './expoHostedRuns';
import {
  getExpoGitRefCandidates,
  resolveExpoProjectGitRefAsync,
  resolveExpoWorkflowRevisionFromGitRefsAsync,
} from './gitRefs';
async function dispatchExpoWorkflow(
  project: ExpoProjectConfig,
  account: ExpoAccountConfig,
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
  },
): Promise<ExpoCommandResult> {
  const token = await resolveExpoAccountToken(account);
  const hydratedProject = await ensureExpoProjectCloudMetadataAsync(project, account, token);
  const appId = hydratedProject.easProjectId;
  if (!appId) {
    throw new Error('expo-project-not-found');
  }

  const workflowFile = selectWorkflowFileForAction(hydratedProject, action);
  if (!workflowFile) {
    throw new Error('missing-workflow-file');
  }

  const githubToken = await tryResolveProjectGithubToken(hydratedProject);
  const refResolution = await resolveExpoProjectGitRefAsync(hydratedProject, githubToken);
  const explicitWorkflowRef = normalizeExpoWorkflowGitRef(args.workflowRef);
  const { workflowRevisionId, gitRef } = await resolveExpoWorkflowRevisionFromGitRefsAsync(
    token,
    appId,
    workflowFile,
    getExpoGitRefCandidates({
      workflowRef: explicitWorkflowRef || refResolution.ref,
      repoDefaultBranch: refResolution.repoDefaultBranch,
    }),
  );

  const workflowRunData = await expoGraphqlRequest<{
    workflowRun?: {
      createWorkflowRunFromGitRef?: {
        id?: string | null;
      } | null;
    };
  }>(
    token,
    `
    mutation CreateWorkflowRunFromGitRef($workflowRevisionId: ID!, $gitRef: String!, $inputs: JSONObject) {
      workflowRun {
        createWorkflowRunFromGitRef(workflowRevisionId: $workflowRevisionId, gitRef: $gitRef, inputs: $inputs) {
          id
        }
      }
    }
  `,
    {
      workflowRevisionId,
      gitRef,
      inputs: getExpoWorkflowDispatchInputs(hydratedProject, action, args),
    },
  );

  const workflowRunId = workflowRunData.workflowRun?.createWorkflowRunFromGitRef?.id;
  if (!workflowRunId) {
    throw new Error('expo-workflow-run-create-failed');
  }

  const runUrl = getExpoWorkflowRunUrl(hydratedProject, account, workflowRunId);
  let runStatus = 'NEW';
  let runConclusion: string | null | undefined;

  if (args.waitForCompletion) {
    const waitTimeoutMs = args.waitTimeoutMs || 3 * 60 * 1000;
    const deadline = Date.now() + waitTimeoutMs;
    while (Date.now() < deadline) {
      const run = await fetchExpoWorkflowRunByIdAsync(token, workflowRunId);
      runStatus = run.status;
      runConclusion = run.conclusion;
      if (!['NEW', 'IN_PROGRESS', 'ACTION_REQUIRED'].includes(run.status)) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 4000));
    }
  }

  return {
    mode: 'eas-workflow',
    workflowRun: {
      id: workflowRunId,
      url: runUrl,
      status: runStatus,
      conclusion: runConclusion,
    },
  };
}

export { dispatchExpoWorkflow };
