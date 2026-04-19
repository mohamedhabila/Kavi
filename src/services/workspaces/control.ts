import { useSettingsStore } from '../../store/useSettingsStore';
import type {
  AppSettings,
  BrowserProviderConfig,
  SshTargetConfig,
  WorkspaceTargetConfig,
} from '../../types';
import { browserNavigate } from '../browser/automation';
import { launchBrowserLiveSession, stopBrowserLiveSession } from '../browser/jobs';
import { getBrowserProviderReadiness } from '../browser/providers';
import { executeSshCommand, getSshTargetReadiness } from '../ssh/connector';
import {
  getWorkspaceProviderFileAccessMode,
  getWorkspaceProviderLabel,
  getWorkspaceTargetReadiness,
  resolveWorkspaceTargetLaunch,
  supportsWorkspaceAiTaskDelegation,
  supportsWorkspaceBrowserAutomation,
} from './connector';

export type WorkspaceDelegationMode = 'agent' | 'plan' | 'ask';

type WorkspaceControlSettings = Pick<AppSettings, 'browserProviders' | 'sshTargets'>;

export interface WorkspaceTargetControlStatus {
  id: string;
  name: string;
  provider: WorkspaceTargetConfig['provider'];
  providerLabel: string;
  launchable: boolean;
  launchReason: string;
  fileAccessMode: ReturnType<typeof getWorkspaceProviderFileAccessMode>;
  fileAccessReady: boolean;
  browserAutomationReady: boolean;
  browserProviderId?: string;
  sshTargetId?: string;
  aiTaskReady: boolean;
  aiTaskCommandSource?: 'cursor-default' | 'custom-template';
  summary: string;
}

export interface WorkspaceBrowserLaunchResult {
  sessionId: string;
  providerId: string;
  url: string;
}

export interface WorkspaceDelegationResult {
  targetId: string;
  sshTargetId: string;
  providerLabel: string;
  mode: WorkspaceDelegationMode;
  command: string;
  output: string;
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `"'"'`)}'`;
}

function getResolvedSettings(settings?: WorkspaceControlSettings): WorkspaceControlSettings {
  const state = useSettingsStore.getState();
  return {
    browserProviders: settings?.browserProviders ?? state.browserProviders ?? [],
    sshTargets: settings?.sshTargets ?? state.sshTargets ?? [],
  };
}

function getEnabledBrowserProviders(settings?: WorkspaceControlSettings): BrowserProviderConfig[] {
  return (getResolvedSettings(settings).browserProviders || []).filter(
    (provider) => getBrowserProviderReadiness(provider).launchable,
  );
}

function getLinkedBrowserProvider(
  target: WorkspaceTargetConfig,
  settings?: WorkspaceControlSettings,
  overrideProviderId?: string,
): BrowserProviderConfig | null {
  const enabledProviders = getEnabledBrowserProviders(settings);
  if (enabledProviders.length === 0) {
    return null;
  }

  const preferredProviderId = (overrideProviderId || target.browserProviderId || '').trim();
  if (preferredProviderId) {
    return enabledProviders.find((provider) => provider.id === preferredProviderId) ?? null;
  }

  return enabledProviders[0] ?? null;
}

function getLinkedSshTarget(
  target: WorkspaceTargetConfig,
  settings?: WorkspaceControlSettings,
): SshTargetConfig | null {
  const linkedSshTargetId = (target.sshTargetId || '').trim();
  if (!linkedSshTargetId) {
    return null;
  }

  return (
    (getResolvedSettings(settings).sshTargets || []).find(
      (entry) => entry.id === linkedSshTargetId && getSshTargetReadiness(entry).launchable,
    ) ?? null
  );
}

function getAiTaskCommandSource(
  target: WorkspaceTargetConfig,
): 'cursor-default' | 'custom-template' | undefined {
  if ((target.aiTaskCommandTemplate || '').trim()) {
    return 'custom-template';
  }

  return target.provider === 'cursor' ? 'cursor-default' : undefined;
}

export function getWorkspaceTargetControlStatus(
  target: WorkspaceTargetConfig,
  settings?: WorkspaceControlSettings,
): WorkspaceTargetControlStatus {
  const providerLabel = getWorkspaceProviderLabel(target.provider);
  const launchReadiness = getWorkspaceTargetReadiness(target);
  const fileAccessMode = getWorkspaceProviderFileAccessMode(target.provider);
  const linkedBrowserProvider = getLinkedBrowserProvider(target, settings);
  const linkedSshTarget = getLinkedSshTarget(target, settings);
  const browserAutomationReady =
    supportsWorkspaceBrowserAutomation(target) && Boolean(linkedBrowserProvider);
  const aiTaskReady = supportsWorkspaceAiTaskDelegation(target) && Boolean(linkedSshTarget);
  const readinessFacets: string[] = [];

  if (fileAccessMode !== 'none' && launchReadiness.launchable) {
    readinessFacets.push(`file API (${fileAccessMode})`);
  }
  if (browserAutomationReady && linkedBrowserProvider) {
    readinessFacets.push(`browser automation via ${linkedBrowserProvider.name}`);
  }
  if (aiTaskReady && linkedSshTarget) {
    readinessFacets.push(`AI handoff via ${linkedSshTarget.name}`);
  }

  return {
    id: target.id,
    name: target.name,
    provider: target.provider,
    providerLabel,
    launchable: launchReadiness.launchable,
    launchReason: launchReadiness.reason,
    fileAccessMode,
    fileAccessReady: fileAccessMode !== 'none' && launchReadiness.launchable,
    browserAutomationReady,
    ...(linkedBrowserProvider ? { browserProviderId: linkedBrowserProvider.id } : {}),
    ...(linkedSshTarget ? { sshTargetId: linkedSshTarget.id } : {}),
    aiTaskReady,
    ...(getAiTaskCommandSource(target)
      ? { aiTaskCommandSource: getAiTaskCommandSource(target) }
      : {}),
    summary:
      readinessFacets.length > 0
        ? `Ready for ${readinessFacets.join(', ')}.`
        : launchReadiness.reason === 'disabled'
          ? 'Workspace target is disabled.'
          : 'No ready remote control path is configured for this workspace target.',
  };
}

function renderWorkspaceCommandTemplate(
  template: string,
  values: {
    mode: WorkspaceDelegationMode;
    prompt: string;
    provider: string;
    rootPath: string;
    targetName: string;
  },
): string {
  const trimmedTemplate = template.trim();
  if (!trimmedTemplate) {
    throw new Error('workspace-task-command-template-required');
  }

  const rendered = trimmedTemplate.replace(
    /\{\{\s*(mode|prompt|provider|rootPath|targetName)\s*\}\}/g,
    (_match, key: keyof typeof values) => shellQuote(values[key]),
  );

  if (/\{\{[^}]+\}\}/.test(rendered)) {
    throw new Error('workspace-task-command-template-invalid-placeholder');
  }

  return rendered;
}

function buildCursorDelegationCommand(prompt: string, mode: WorkspaceDelegationMode): string {
  const modeFlag = mode === 'agent' ? '' : ` --mode=${mode}`;
  return `agent -p ${shellQuote(prompt)}${modeFlag} --output-format text`;
}

export function buildWorkspaceDelegationCommand(
  target: WorkspaceTargetConfig,
  prompt: string,
  mode: WorkspaceDelegationMode = 'agent',
): string {
  const normalizedPrompt = prompt.trim();
  if (!normalizedPrompt) {
    throw new Error('workspace-task-prompt-required');
  }

  const template = (target.aiTaskCommandTemplate || '').trim();
  if (template) {
    return renderWorkspaceCommandTemplate(template, {
      mode,
      prompt: normalizedPrompt,
      provider: getWorkspaceProviderLabel(target.provider),
      rootPath: target.rootPath.trim(),
      targetName: target.name,
    });
  }

  if (target.provider === 'cursor') {
    return buildCursorDelegationCommand(normalizedPrompt, mode);
  }

  throw new Error('workspace-ai-task-unconfigured');
}

export async function launchWorkspaceBrowserSession(
  target: WorkspaceTargetConfig,
  options?: {
    providerId?: string;
    settings?: WorkspaceControlSettings;
  },
): Promise<WorkspaceBrowserLaunchResult> {
  const launchReadiness = getWorkspaceTargetReadiness(target);
  if (!launchReadiness.launchable) {
    throw new Error(launchReadiness.reason);
  }
  if (!supportsWorkspaceBrowserAutomation(target)) {
    throw new Error(
      (target.authMode || 'none') === 'bearer'
        ? 'workspace-browser-automation-unsupported-auth'
        : 'workspace-browser-automation-unavailable',
    );
  }

  const linkedBrowserProvider = getLinkedBrowserProvider(
    target,
    options?.settings,
    options?.providerId,
  );
  if (!linkedBrowserProvider) {
    throw new Error('workspace-browser-provider-not-found');
  }

  const request = await resolveWorkspaceTargetLaunch(target);
  const sessionId = await launchBrowserLiveSession(linkedBrowserProvider);

  try {
    await browserNavigate(sessionId, { url: request.uri });
  } catch (error) {
    await stopBrowserLiveSession(sessionId).catch(() => undefined);
    throw error;
  }

  return {
    sessionId,
    providerId: linkedBrowserProvider.id,
    url: request.uri,
  };
}

export async function delegateWorkspaceTask(
  target: WorkspaceTargetConfig,
  prompt: string,
  options?: {
    mode?: WorkspaceDelegationMode;
    settings?: WorkspaceControlSettings;
  },
): Promise<WorkspaceDelegationResult> {
  if (!supportsWorkspaceAiTaskDelegation(target)) {
    throw new Error('workspace-ai-task-unconfigured');
  }

  const linkedSshTarget = getLinkedSshTarget(target, options?.settings);
  if (!linkedSshTarget) {
    throw new Error('workspace-ssh-target-unavailable');
  }

  const mode = options?.mode || 'agent';
  const command = buildWorkspaceDelegationCommand(target, prompt, mode);
  const output = await executeSshCommand(
    linkedSshTarget,
    command,
    target.rootPath.trim() || undefined,
  );

  return {
    targetId: target.id,
    sshTargetId: linkedSshTarget.id,
    providerLabel: getWorkspaceProviderLabel(target.provider),
    mode,
    command,
    output,
  };
}
