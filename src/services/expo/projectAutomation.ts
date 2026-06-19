import { i18n } from '../../i18n/manager';
import type { AppSettings } from '../../types/settings';
import type { ExpoAccountConfig, ExpoProjectConfig } from '../../types/remote';
import type { ExpoAutomationSummary, ExpoProjectReadiness } from './contracts';
import {
  getExpoProjectDisplayOwner,
  getExpoProjectSlug,
  getSshTargets,
  normalizeRepo,
} from './projectState';
import {
  buildExpoDeployWorkflowTemplate,
  canUseExpoHostedWorkflow,
  getExpoRecommendedWorkflowBranch,
  hasExactExpoDeployWorkflow,
  selectWorkflowFileForAction,
} from './workflowSelection';

const EXPO_MONITORING_TOOL_NAMES = [
  'expo_eas_workflow_runs',
  'expo_eas_workflow_status',
  'expo_eas_workflow_wait',
] as const;
const EXPO_MANUAL_ACTION_TOOL_NAMES = [
  'expo_eas_build',
  'expo_eas_update',
  'expo_eas_submit',
  'expo_eas_deploy_web',
] as const;

export function getExpoProjectExecutionMode(
  project: Pick<
    ExpoProjectConfig,
    | 'mode'
    | 'source'
    | 'repoFullName'
    | 'workflowFile'
    | 'availableWorkflowFiles'
    | 'githubTokenRef'
    | 'sshTargetId'
    | 'projectPath'
  >,
  account?: Pick<ExpoAccountConfig, 'enabled' | 'tokenRef'>,
): ExpoProjectConfig['mode'] {
  if (project.mode === 'eas-workflow') {
    return 'eas-workflow';
  }

  const hostedWorkflowReady = canUseExpoHostedWorkflow(project, account);
  if (!hostedWorkflowReady) {
    return project.mode || 'eas-workflow';
  }

  if (project.source === 'account-sync') {
    return 'eas-workflow';
  }

  if (project.mode === 'github-workflow' && !project.githubTokenRef?.trim()) {
    return 'eas-workflow';
  }

  if (project.mode === 'direct-ssh' && (!project.sshTargetId || !project.projectPath?.trim())) {
    return 'eas-workflow';
  }

  return project.mode || 'eas-workflow';
}

export function getExpoAutomationSummary(
  project: Pick<
    ExpoProjectConfig,
    | 'mode'
    | 'source'
    | 'repoFullName'
    | 'workflowFile'
    | 'availableWorkflowFiles'
    | 'githubTokenRef'
    | 'sshTargetId'
    | 'projectPath'
    | 'workflowRef'
    | 'repoDefaultBranch'
    | 'platforms'
  >,
  account?: Pick<ExpoAccountConfig, 'enabled' | 'tokenRef'>,
): ExpoAutomationSummary {
  const mode = getExpoProjectExecutionMode(project, account);
  const repoLinked = Boolean(normalizeRepo(project.repoFullName));
  const workflowFile = selectWorkflowFileForAction(project);
  const recommendedBranch = getExpoRecommendedWorkflowBranch(project);
  const deployWorkflow =
    (project.platforms || []).includes('web') && !hasExactExpoDeployWorkflow(project)
      ? buildExpoDeployWorkflowTemplate(recommendedBranch)
      : undefined;

  if (mode === 'direct-ssh') {
    return {
      preferredFlow: 'direct-ssh-cli',
      autoTriggerOnPush: false,
      repoLinked,
      workflowFile,
      recommendedBranch,
      recommendedMonitoringTools: [],
      manualActionTools: [...EXPO_MANUAL_ACTION_TOOL_NAMES],
      recommendedFlow: [
        'This project is configured for direct SSH EAS CLI execution, not commit-triggered EAS Workflows.',
        'If you want the Expo-managed default, link the repo in Expo and add .eas/workflows/*.yml on the target branch.',
        'Otherwise run the configured SSH-backed action and inspect the command output directly.',
      ],
      deployWorkflow,
    };
  }

  if (mode === 'github-workflow') {
    return {
      preferredFlow: 'github-workflow-dispatch',
      autoTriggerOnPush: false,
      repoLinked,
      workflowFile,
      recommendedBranch,
      recommendedMonitoringTools: [...EXPO_MONITORING_TOOL_NAMES],
      manualActionTools: [...EXPO_MANUAL_ACTION_TOOL_NAMES],
      recommendedFlow: [
        'This project is configured around GitHub workflow dispatch or a non-Expo workflow file, not the default Expo-hosted commit-driven flow.',
        'If you want the default Expo-managed path, link the repo in Expo and add .eas/workflows/*.yml on the target branch.',
        'Until then, only use manual action tools when the user explicitly asks for a manual run.',
      ],
      deployWorkflow,
    };
  }

  return {
    preferredFlow: 'commit-driven-eas-workflow',
    autoTriggerOnPush: repoLinked && Boolean(workflowFile),
    repoLinked,
    workflowFile,
    recommendedBranch,
    recommendedMonitoringTools: [...EXPO_MONITORING_TOOL_NAMES],
    manualActionTools: [...EXPO_MANUAL_ACTION_TOOL_NAMES],
    recommendedFlow: [
      repoLinked
        ? 'Edit the linked repository or working branch with repository or workspace tools.'
        : 'Link the GitHub repository to the Expo project first so EAS Workflows can react to commits.',
      workflowFile
        ? `Keep ${workflowFile} on the target branch, then commit the required app changes.`
        : 'Add .eas/workflows/deploy.yml for EAS Hosting or another required .eas/workflows/*.yml file on the target branch before committing.',
      `Push a commit to ${recommendedBranch} or another branch matched by the workflow on.push trigger.`,
      `Monitor the automatically triggered run with ${EXPO_MONITORING_TOOL_NAMES.join(', ')}.`,
    ],
    deployWorkflow,
  };
}

export function getExpoProjectReadiness(
  project: ExpoProjectConfig,
  account?: ExpoAccountConfig,
  settings?: Pick<AppSettings, 'sshTargets'>,
): ExpoProjectReadiness {
  if (!project.enabled) {
    return { launchable: false, reason: 'disabled' };
  }
  if (!account?.enabled) {
    return { launchable: false, reason: 'missing-account' };
  }
  if (!getExpoProjectDisplayOwner(project, account).trim()) {
    return { launchable: false, reason: 'missing-owner' };
  }
  if (!getExpoProjectSlug(project)) {
    return { launchable: false, reason: 'missing-slug' };
  }

  const executionMode = getExpoProjectExecutionMode(project, account);

  if (executionMode === 'eas-workflow') {
    if (!account.tokenRef) {
      return { launchable: false, reason: 'missing-expo-token' };
    }
    if (!normalizeRepo(project.repoFullName)) {
      return { launchable: false, reason: 'missing-linked-repo' };
    }
    if (!selectWorkflowFileForAction(project)) {
      return { launchable: false, reason: 'missing-workflow-file' };
    }
    return { launchable: true, reason: 'ready' };
  }

  if (executionMode === 'direct-ssh') {
    if (!account.tokenRef) {
      return { launchable: false, reason: 'missing-expo-token' };
    }
    if (!project.sshTargetId) {
      return { launchable: false, reason: 'missing-ssh-target' };
    }
    const sshTarget = getSshTargets(settings).find(
      (target) => target.id === project.sshTargetId && target.enabled,
    );
    if (!sshTarget) {
      return { launchable: false, reason: 'missing-ssh-target' };
    }
    if (!project.projectPath?.trim()) {
      return { launchable: false, reason: 'missing-project-path' };
    }
    return { launchable: true, reason: 'ready' };
  }

  if (!normalizeRepo(project.repoFullName)) {
    return { launchable: false, reason: 'missing-linked-repo' };
  }
  if (!project.workflowFile?.trim()) {
    return { launchable: false, reason: 'missing-workflow-file' };
  }
  if (!project.githubTokenRef?.trim()) {
    return { launchable: false, reason: 'missing-github-token' };
  }
  return { launchable: true, reason: 'ready' };
}

export function getExpoProjectReadinessLabel(readiness: ExpoProjectReadiness): string {
  switch (readiness.reason) {
    case 'disabled':
      return i18n.t('remoteWork.disabledTarget');
    case 'missing-account':
      return i18n.t('remoteWork.expoReadinessMissingAccount');
    case 'missing-owner':
      return i18n.t('remoteWork.expoReadinessMissingOwner');
    case 'missing-slug':
      return i18n.t('remoteWork.expoReadinessMissingSlug');
    case 'missing-expo-token':
      return i18n.t('remoteWork.expoReadinessMissingExpoToken');
    case 'missing-linked-repo':
      return i18n.t('remoteWork.expoReadinessMissingLinkedRepo');
    case 'missing-ssh-target':
      return i18n.t('remoteWork.expoReadinessMissingSshTarget');
    case 'missing-project-path':
      return i18n.t('remoteWork.expoReadinessMissingProjectPath');
    case 'missing-workflow-file':
      return i18n.t('remoteWork.expoReadinessMissingWorkflowFile');
    case 'missing-github-token':
      return i18n.t('remoteWork.expoReadinessMissingGithubToken');
    case 'ready':
    default:
      return i18n.t('remoteWork.statusReady');
  }
}

function getExpoWorkflowToolUnavailableNote(
  project: ExpoProjectConfig,
  account: ExpoAccountConfig,
  settings: Pick<AppSettings, 'sshTargets'>,
): string | undefined {
  const readiness = getExpoProjectReadiness(project, account, settings);
  if (readiness.launchable) {
    return undefined;
  }
  return `Workflow tooling unavailable until this project is ready: ${getExpoProjectReadinessLabel(readiness)}.`;
}

function getHostedWorkflowUnavailableNote(
  appId: string | undefined,
  workflowFile: string | undefined,
): string | undefined {
  if (!workflowFile) {
    return 'Expo-hosted workflow tooling is unavailable until an automation workflow is configured or synced.';
  }
  if (!appId) {
    return 'Expo-hosted workflow tooling is unavailable until this project is synced to an EAS project id.';
  }
  return undefined;
}

export { getExpoWorkflowToolUnavailableNote, getHostedWorkflowUnavailableNote };
