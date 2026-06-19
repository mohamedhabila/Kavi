import { useSettingsStore } from '../../../store/useSettingsStore';
import type { ExpoAccountConfig, ExpoProjectConfig } from '../../../types/remote';
import type {
  ExpoHostedWorkflowRunRecord,
  ExpoWorkflowFailureLog,
  ExpoWorkflowJobStatus,
} from '../contracts';
import { expoGraphqlRequest } from '../providers/expoGraphql';
import { fetchExpoProjectWorkflowsAsync, findExpoProjectByFullNameAsync } from '../projectRemote';
import { getExpoProjectExecutionMode } from '../projectAutomation';
import { getExpoProjectFullName } from '../projectState';
import {
  selectDefaultWorkflowFile,
  selectWorkflowFileForAction,
  uniqueWorkflowFiles,
} from '../workflowSelection';
import { extractFailureLogsFromErrorEntries, mergeFailureLogs } from '../logs/workflowFailures';
import { inspectExpoHostedWorkflowJobAsync } from './expoHostedLogs';
async function fetchExpoWorkflowRunWithJobsAsync(
  token: string,
  workflowRunId: string,
): Promise<ExpoHostedWorkflowRunRecord> {
  const data = await expoGraphqlRequest<{
    workflowRuns: {
      byId: ExpoHostedWorkflowRunRecord;
    };
  }>(
    token,
    `
    query WorkflowRunByIdWithJobs($workflowRunId: ID!) {
      workflowRuns {
        byId(workflowRunId: $workflowRunId) {
          id
          status
          createdAt
          updatedAt
          errors {
            title
            message
          }
          jobs {
            id
            key
            name
            status
            type
            outputs
            errors {
              title
              message
            }
            createdAt
            updatedAt
            turtleJobRun {
              id
              logFileUrls
              errors {
                errorCode
                message
              }
            }
            turtleBuild {
              id
              status
              logFiles
              error {
                errorCode
                message
                docsUrl
              }
            }
          }
        }
      }
    }
  `,
    { workflowRunId },
  );

  return data.workflowRuns.byId;
}

async function fetchExpoWorkflowRunDetailsAsync(
  token: string,
  workflowRunId: string,
  options: { includeJobs: boolean; includeLogs: boolean },
): Promise<{
  id: string;
  status: string;
  createdAt?: string | null;
  updatedAt?: string | null;
  conclusion?: string | null;
  jobs?: ExpoWorkflowJobStatus[];
  failureLogs?: ExpoWorkflowFailureLog[];
}> {
  const run = await fetchExpoWorkflowRunWithJobsAsync(token, workflowRunId);
  const baseFailureLogs = extractFailureLogsFromErrorEntries(run.errors, 'expo-workflow-error');

  if (!options.includeJobs && !options.includeLogs) {
    const errorMessage = baseFailureLogs?.map((entry) => entry.excerpt).join('; ') || undefined;
    return {
      id: run.id,
      status: run.status,
      createdAt: run.createdAt || null,
      updatedAt: run.updatedAt || null,
      conclusion: errorMessage || null,
      failureLogs: baseFailureLogs,
    };
  }

  const inspectedJobs = await Promise.all(
    (run.jobs || []).map((job) =>
      inspectExpoHostedWorkflowJobAsync(token, job, {
        includeSteps: options.includeJobs,
        includeLogs: options.includeLogs,
      }),
    ),
  );
  const failureLogs = mergeFailureLogs(
    baseFailureLogs,
    ...inspectedJobs.map((job) => job.failureLogs),
  );
  const errorMessage = failureLogs?.map((entry) => entry.excerpt).join('; ') || undefined;

  return {
    id: run.id,
    status: run.status,
    createdAt: run.createdAt || null,
    updatedAt: run.updatedAt || null,
    conclusion: errorMessage || null,
    jobs: options.includeJobs ? inspectedJobs.map((job) => job.status) : undefined,
    failureLogs,
  };
}

async function fetchExpoWorkflowRunByIdAsync(
  token: string,
  workflowRunId: string,
): Promise<{
  id: string;
  status: string;
  conclusion?: string | null;
  failureLogs?: ExpoWorkflowFailureLog[];
}> {
  const data = await expoGraphqlRequest<{
    workflowRuns: {
      byId: {
        id: string;
        status: string;
        errors?: Array<{ title?: string | null; message?: string | null }>;
      };
    };
  }>(
    token,
    `
    query WorkflowRunById($workflowRunId: ID!) {
      workflowRuns {
        byId(workflowRunId: $workflowRunId) {
          id
          status
          errors {
            title
            message
          }
        }
      }
    }
  `,
    { workflowRunId },
  );

  const run = data.workflowRuns.byId;
  const failureLogs = extractFailureLogsFromErrorEntries(run.errors, 'expo-workflow-error');
  const errorMessage = failureLogs?.map((entry) => entry.excerpt).join('; ') || undefined;
  return {
    id: run.id,
    status: run.status,
    conclusion: errorMessage || null,
    failureLogs,
  };
}

async function fetchExpoWorkflowRunsForFileAsync(
  token: string,
  appId: string,
  fileName: string,
  limit = 5,
): Promise<
  Array<{
    id: string;
    status: string;
    conclusion?: string | null;
    createdAt?: string | null;
    updatedAt?: string | null;
  }>
> {
  const data = await expoGraphqlRequest<{
    workflows: {
      byAppIdAndFileName?: {
        runs?: {
          edges?: Array<{
            node?: {
              id: string;
              status: string;
              createdAt?: string | null;
              updatedAt?: string | null;
              errors?: Array<{ title?: string | null; message?: string | null }>;
            } | null;
          }>;
        } | null;
      } | null;
    };
  }>(
    token,
    `
    query WorkflowRunsForAppIdFileName($appId: ID!, $fileName: String!, $limit: Int!) {
      workflows {
        byAppIdAndFileName(appId: $appId, fileName: $fileName) {
          id
          runs: runsPaginated(first: $limit) {
            edges {
              node {
                id
                status
                createdAt
                updatedAt
                errors {
                  title
                  message
                }
              }
            }
          }
        }
      }
    }
  `,
    { appId, fileName, limit },
  );

  return (data.workflows.byAppIdAndFileName?.runs?.edges || [])
    .map((edge) => edge.node)
    .filter(
      (
        node,
      ): node is {
        id: string;
        status: string;
        createdAt?: string | null;
        updatedAt?: string | null;
        errors?: Array<{ title?: string | null; message?: string | null }>;
      } => Boolean(node),
    )
    .map((node) => ({
      id: node.id,
      status: node.status,
      conclusion:
        node.errors
          ?.map((entry) => entry.message || entry.title)
          .filter(Boolean)
          .join('; ') || null,
      createdAt: node.createdAt || null,
      updatedAt: node.updatedAt || null,
    }));
}

async function ensureExpoProjectCloudMetadataAsync(
  project: ExpoProjectConfig,
  account: ExpoAccountConfig,
  token: string,
): Promise<ExpoProjectConfig> {
  let nextProject = project;
  let patch: Partial<ExpoProjectConfig> | null = null;

  if (!project.easProjectId) {
    const fullName = getExpoProjectFullName(project, account);
    const remoteProject = await findExpoProjectByFullNameAsync(token, fullName);
    if (!remoteProject) {
      throw new Error('expo-project-not-found');
    }
    patch = {
      easProjectId: remoteProject.projectId,
      repoFullName: remoteProject.repoFullName || project.repoFullName,
      repoDefaultBranch: remoteProject.repoDefaultBranch || project.repoDefaultBranch,
      availableWorkflowFiles:
        uniqueWorkflowFiles(remoteProject.availableWorkflowFiles) || project.availableWorkflowFiles,
      workflowFile:
        project.workflowFile || selectDefaultWorkflowFile(remoteProject.availableWorkflowFiles),
    };
  }

  const appId = patch?.easProjectId || project.easProjectId;
  if (appId) {
    const workflows = await fetchExpoProjectWorkflowsAsync(token, appId);
    const availableWorkflowFiles = uniqueWorkflowFiles(
      workflows.map((workflow) => workflow.fileName),
    );
    const workflowFile = selectWorkflowFileForAction({
      workflowFile: patch?.workflowFile || project.workflowFile,
      availableWorkflowFiles,
    });
    patch = {
      ...patch,
      availableWorkflowFiles:
        availableWorkflowFiles || patch?.availableWorkflowFiles || project.availableWorkflowFiles,
      workflowFile,
    };
  }

  if (patch) {
    const mergedProject = { ...project, ...patch };
    const preferredMode = getExpoProjectExecutionMode(mergedProject, account);
    if (preferredMode !== mergedProject.mode) {
      patch = { ...patch, mode: preferredMode };
    }

    useSettingsStore.setState((current) => ({
      expoProjects: (current.expoProjects || []).map((entry) =>
        entry.id === project.id ? { ...entry, ...patch } : entry,
      ),
    }));
    nextProject = { ...project, ...patch };
  }

  return nextProject;
}

export {
  ensureExpoProjectCloudMetadataAsync,
  fetchExpoWorkflowRunByIdAsync,
  fetchExpoWorkflowRunDetailsAsync,
  fetchExpoWorkflowRunsForFileAsync,
};
