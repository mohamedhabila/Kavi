import type { ExpoAccountConfig, ExpoProjectConfig } from '../../types/remote';
import type { ExpoWorkflowRunInspectionResult } from './contracts';
import { getExpoProjectDisplayOwner, getExpoProjectSlug } from './projectState';

function getDefaultPlatforms(project: ExpoProjectConfig): string[] {
  const platforms = project.platforms?.length ? project.platforms : ['android', 'ios', 'web'];
  return platforms;
}

function getExpoWorkflowRunUrl(
  project: ExpoProjectConfig,
  account: ExpoAccountConfig,
  workflowRunId: string,
): string {
  return `https://expo.dev/accounts/${getExpoProjectDisplayOwner(project, account)}/projects/${getExpoProjectSlug(project) || 'project'}/workflows/${workflowRunId}`;
}

function isExpoHostedWorkflowTerminal(status: string | undefined): boolean {
  if (!status) {
    return false;
  }
  return !['NEW', 'IN_PROGRESS', 'ACTION_REQUIRED'].includes(status);
}

function isWorkflowRunTerminal(
  mode: ExpoProjectConfig['mode'],
  status: string | undefined,
): boolean {
  if (!status) {
    return false;
  }
  if (mode === 'github-workflow') {
    return status === 'completed';
  }
  if (mode === 'eas-workflow') {
    return isExpoHostedWorkflowTerminal(status);
  }
  return true;
}

function isWorkflowRunFailure(
  mode: ExpoProjectConfig['mode'],
  status: string | undefined,
  conclusion: string | null | undefined,
): boolean {
  if (!status) {
    return false;
  }
  if (mode === 'github-workflow') {
    return status === 'completed' && Boolean(conclusion) && conclusion !== 'success';
  }
  if (mode === 'eas-workflow') {
    return isExpoHostedWorkflowTerminal(status) && !['SUCCESS', 'COMPLETED'].includes(status);
  }
  return false;
}

function mapGitHubWorkflowRun(
  run: any,
): NonNullable<ExpoWorkflowRunInspectionResult['workflowRun']> {
  return {
    id: run.id,
    url: run.html_url,
    status: run.status,
    conclusion: run.conclusion,
    createdAt: run.created_at || null,
    updatedAt: run.updated_at || null,
    headBranch: run.head_branch || null,
    event: run.event || null,
  };
}

export {
  getDefaultPlatforms,
  getExpoWorkflowRunUrl,
  isExpoHostedWorkflowTerminal,
  isWorkflowRunTerminal,
  isWorkflowRunFailure,
  mapGitHubWorkflowRun,
};
