import {
  getExpoProjectDisplayOwner,
  resolveExpoAccount,
} from '../../services/expo/projectState';
import { listExpoProjects } from '../../services/expo/projectSync';
import {
  getExpoProjectExecutionMode,
  getExpoProjectReadiness,
  getExpoProjectReadinessLabel,
} from '../../services/expo/projectAutomation';
import { createExpoProject } from '../../services/expo/projectCreation';
import { resolveExpoProjectForExecutionTask } from '../../services/expo/projectResolution';
import { probeExpoProject, runExpoProjectAction } from '../../services/expo/workflowActions';
import { useSettingsStore } from '../../store/useSettingsStore';
import {
  getExpoAutomationGuidance,
  getExpoProjectAutomationContext,
  withExpoAutomation,
} from './builtin-expoAutomation';
import {
  buildExpoListProjectsSelection,
  resolveExpoProjectForToolCall,
} from './builtin-expoProjectResolution';
import { normalizeExpoToolPayload } from './builtin-expoSummary';

export async function executeExpoEasListProjects(args: {
  accountId?: string;
  refresh?: boolean;
}): Promise<string> {
  const projects = await listExpoProjects({
    accountId: args.accountId,
    refresh: args.refresh,
  });
  const selection = buildExpoListProjectsSelection(projects);

  return JSON.stringify(
    normalizeExpoToolPayload(
      'expo_eas_list_projects',
      {
        status: 'ok',
        count: projects.length,
        projects,
        ...(projects.length > 0 ? { selection } : {}),
        guidance: projects.length
          ? selection.defaultProjectId
            ? `Do not call expo_eas_list_projects again with the same arguments unless you need refresh=true or a different account. Reuse projectId "${selection.defaultProjectId}" (or ${selection.defaultProjectFullName}) in expo_eas_status, expo_eas_probe, or the expo_eas_workflow_* monitoring tools.`
            : 'Do not call expo_eas_list_projects again with the same arguments unless you need refresh=true or a different account. Choose one returned project and inspect it with expo_eas_status before taking further Expo actions.'
          : 'No synced Expo projects were found. Link an Expo account with a valid token, then either call expo_eas_create_project to create one or create/link a project in Expo and call expo_eas_list_projects with refresh=true.',
      },
      {
        preferredFlow: 'commit-driven-eas-workflow',
      },
    ),
  );
}

export async function executeExpoEasCreateProject(args: {
  accountId?: string;
  name: string;
  slug?: string;
  confirmedCreateNewProject?: boolean;
}): Promise<string> {
  if (!args.confirmedCreateNewProject) {
    const resolution = await resolveExpoProjectForExecutionTask({
      accountId: args.accountId,
      allowSync: true,
    });
    const linkedCandidates =
      resolution.status === 'resolved'
        ? [resolution.project]
        : resolution.status === 'ambiguous'
          ? resolution.candidates.filter(
              (project) => project.repoFullName || project.readiness.launchable,
            )
          : [];

    if (linkedCandidates.length > 0) {
      const project = linkedCandidates[0];
      const automation = getExpoProjectAutomationContext(project.id).automation;
      const guidance =
        resolution.status === 'ambiguous'
          ? 'Multiple existing Expo projects are available. Choose one explicitly with expo_eas_status before creating a new project.'
          : 'Existing linked Expo project found. Use expo_eas_status, expo_eas_probe, and expo_eas_workflow_* monitoring with this project instead of creating another project.';

      return JSON.stringify(
        normalizeExpoToolPayload(
          'expo_eas_create_project',
          {
            status: 'redirected_existing_project',
            project,
            candidates: linkedCandidates,
            reason: resolution.reason,
            nextSuggestedTool: 'expo_eas_status',
            nextSuggestedArgs: { projectId: project.id },
            guidance,
          },
          {
            preferredFlow: automation.preferredFlow,
          },
        ),
      );
    }
  }

  const project = await createExpoProject(args);
  const automation = getExpoProjectAutomationContext(project.id).automation;

  return JSON.stringify(
    normalizeExpoToolPayload(
      'expo_eas_create_project',
      {
        status: 'ok',
        project,
        guidance: project.readiness.launchable
          ? getExpoAutomationGuidance(automation)
          : 'Project created and synced. If it is not launchable yet, link the GitHub repository in Expo and add .eas/workflows/*.yml on the target branch, or configure direct SSH execution as a fallback.',
      },
      {
        preferredFlow: automation.preferredFlow,
      },
    ),
  );
}

export async function executeExpoEasStatus(args: { projectId: string }): Promise<string> {
  const resolved = await resolveExpoProjectForToolCall('expo_eas_status', args.projectId);
  if ('response' in resolved) {
    return resolved.response;
  }
  const settings = useSettingsStore.getState();
  const project = resolved.project;
  const account = resolveExpoAccount(project.accountId, settings);
  const readiness = getExpoProjectReadiness(project, account, settings);
  const automation = getExpoProjectAutomationContext(project.id).automation;

  const projectGuidance = readiness.launchable
    ? automation.preferredFlow === 'commit-driven-eas-workflow'
      ? `Project is ready for repository-driven EAS Workflows. Keep ${automation.workflowFile || '.eas/workflows/*.yml'} on the target branch, push a commit to ${automation.recommendedBranch} or another matched branch, then monitor the automatically triggered run.`
      : getExpoAutomationGuidance(automation)
    : readiness.reason === 'missing-linked-repo'
      ? 'Link a GitHub repository to this Expo project in the Expo dashboard so EAS Workflows can react to commits, or configure direct SSH execution as a fallback.'
      : readiness.reason === 'missing-workflow-file'
        ? 'Add .eas/workflows/deploy.yml for EAS Hosting or another required .eas/workflows/*.yml file on the target branch, then push a commit and monitor the resulting run.'
        : undefined;

  return JSON.stringify(
    normalizeExpoToolPayload(
      'expo_eas_status',
      {
        status: 'ok',
        guidance: getExpoAutomationGuidance(automation),
        ...(projectGuidance ? { note: projectGuidance } : {}),
        project: {
          id: project.id,
          easProjectId: project.easProjectId,
          name: project.name,
          fullName: `@${getExpoProjectDisplayOwner(project, account)}/${project.slug}`,
          mode: getExpoProjectExecutionMode(project, account),
          source: project.source,
          repoDefaultBranch: project.repoDefaultBranch,
          availableWorkflowFiles: project.availableWorkflowFiles,
          platforms: project.platforms || ['android', 'ios', 'web'],
          repoFullName: project.repoFullName,
          workflowFile: project.workflowFile,
          workflowRef: project.workflowRef,
          readiness: {
            launchable: readiness.launchable,
            reason: readiness.reason,
            label: getExpoProjectReadinessLabel(readiness),
          },
        },
      },
      {
        preferredFlow: automation.preferredFlow,
      },
    ),
  );
}

export async function executeExpoEasProbe(args: { projectId: string }): Promise<string> {
  const resolved = await resolveExpoProjectForToolCall('expo_eas_probe', args.projectId);
  if ('response' in resolved) {
    return resolved.response;
  }
  const projectId = resolved.project.id;
  const automation = getExpoProjectAutomationContext(projectId).automation;

  return JSON.stringify(
    normalizeExpoToolPayload(
      'expo_eas_probe',
      withExpoAutomation(projectId, {
        ...(await probeExpoProject(projectId)),
        guidance: getExpoAutomationGuidance(automation),
      }),
      {
        preferredFlow: automation.preferredFlow,
      },
    ),
  );
}

export async function executeExpoEasBuild(args: {
  projectId: string;
  platform?: 'android' | 'ios' | 'all';
  profile?: string;
  waitForCompletion?: boolean;
  waitTimeoutMs?: number;
}): Promise<string> {
  const resolved = await resolveExpoProjectForToolCall('expo_eas_build', args.projectId);
  if ('response' in resolved) {
    return resolved.response;
  }
  const projectId = resolved.project.id;
  const automation = getExpoProjectAutomationContext(projectId).automation;

  return JSON.stringify(
    normalizeExpoToolPayload(
      'expo_eas_build',
      withExpoAutomation(projectId, await runExpoProjectAction(projectId, 'build', args)),
      { preferredFlow: automation.preferredFlow },
    ),
  );
}

export async function executeExpoEasUpdate(args: {
  projectId: string;
  branch?: string;
  message?: string;
  waitForCompletion?: boolean;
  waitTimeoutMs?: number;
}): Promise<string> {
  const resolved = await resolveExpoProjectForToolCall('expo_eas_update', args.projectId);
  if ('response' in resolved) {
    return resolved.response;
  }
  const projectId = resolved.project.id;
  const automation = getExpoProjectAutomationContext(projectId).automation;

  return JSON.stringify(
    normalizeExpoToolPayload(
      'expo_eas_update',
      withExpoAutomation(projectId, await runExpoProjectAction(projectId, 'update', args)),
      { preferredFlow: automation.preferredFlow },
    ),
  );
}

export async function executeExpoEasSubmit(args: {
  projectId: string;
  platform?: 'android' | 'ios' | 'all';
  profile?: string;
  waitForCompletion?: boolean;
  waitTimeoutMs?: number;
}): Promise<string> {
  const resolved = await resolveExpoProjectForToolCall('expo_eas_submit', args.projectId);
  if ('response' in resolved) {
    return resolved.response;
  }
  const projectId = resolved.project.id;
  const automation = getExpoProjectAutomationContext(projectId).automation;

  return JSON.stringify(
    normalizeExpoToolPayload(
      'expo_eas_submit',
      withExpoAutomation(projectId, await runExpoProjectAction(projectId, 'submit', args)),
      { preferredFlow: automation.preferredFlow },
    ),
  );
}

export async function executeExpoEasDeployWeb(args: {
  projectId: string;
  alias?: string;
  waitForCompletion?: boolean;
  waitTimeoutMs?: number;
}): Promise<string> {
  const resolved = await resolveExpoProjectForToolCall('expo_eas_deploy_web', args.projectId);
  if ('response' in resolved) {
    return resolved.response;
  }
  const projectId = resolved.project.id;
  const automation = getExpoProjectAutomationContext(projectId).automation;

  return JSON.stringify(
    normalizeExpoToolPayload(
      'expo_eas_deploy_web',
      withExpoAutomation(projectId, await runExpoProjectAction(projectId, 'deploy-web', args)),
      { preferredFlow: automation.preferredFlow },
    ),
  );
}
