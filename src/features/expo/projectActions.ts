import { getExpoProjectExecutionMode } from '../../services/expo/projectAutomation';
import { getExpoRecommendedWorkflowBranch } from '../../services/expo/workflowSelection';
import type { ExpoAccountConfig, ExpoProjectConfig } from '../../types/remote';

type TranslationFn = (key: string, params?: any) => string;

export type ExpoActionType = 'build' | 'update' | 'submit' | 'deploy-web';

export type ExpoActionOverrides = {
  platform?: 'android' | 'ios' | 'all';
};

export type ExpoWorkflowPromptState = null | {
  projectId: string;
  action: ExpoActionType;
  overrides?: ExpoActionOverrides;
  workflowRef: string;
};

export function getExpoActionLabel(
  t: TranslationFn,
  action: ExpoActionType,
  overrides?: ExpoActionOverrides,
): string {
  if (action === 'build') {
    if (overrides?.platform === 'ios') {
      return t('remoteWork.expoBuildIos');
    }
    return t('remoteWork.expoBuildAndroid');
  }
  if (action === 'submit') {
    return t('remoteWork.expoSubmitIos');
  }
  if (action === 'deploy-web') {
    return t('remoteWork.expoDeployWeb');
  }
  return t('remoteWork.expoPublishUpdate');
}

export function getExpoActionArgs(
  project: ExpoProjectConfig,
  action: ExpoActionType,
  overrides?: ExpoActionOverrides,
): {
  platform?: 'android' | 'ios' | 'all';
  message?: string;
} {
  if (action === 'build') {
    return { platform: overrides?.platform || 'android' };
  }
  if (action === 'submit') {
    return { platform: overrides?.platform || 'ios' };
  }
  if (action === 'update') {
    return { message: `Triggered from Remote Work for ${project.name}` };
  }
  return {};
}

export function shouldPromptForExpoWorkflowAction(
  project: ExpoProjectConfig,
  account?: ExpoAccountConfig,
): boolean {
  return getExpoProjectExecutionMode(project, account) !== 'direct-ssh';
}

export function createExpoWorkflowPrompt(
  project: ExpoProjectConfig,
  account: ExpoAccountConfig | undefined,
  action: ExpoActionType,
  overrides?: ExpoActionOverrides,
): ExpoWorkflowPromptState {
  if (!shouldPromptForExpoWorkflowAction(project, account)) {
    return null;
  }

  return {
    projectId: project.id,
    action,
    overrides,
    workflowRef: getExpoRecommendedWorkflowBranch(project),
  };
}

export function normalizeExpoWorkflowRef(value: string): string {
  return value
    .trim()
    .replace(/^refs\/heads\//i, '')
    .replace(/^heads\//i, '')
    .replace(/^origin\//i, '');
}
