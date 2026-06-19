import type { ToolDefinition } from '../../types/tool';
import type { WorkspaceTargetConfig } from '../../types/remote';
import { getBrowserProviderReadiness } from '../../services/browser/providers/readiness';
import { getSshTargetReadiness } from '../../services/ssh/connector';
import {
  getWorkspaceTargetReadiness,
  supportsWorkspaceAiTaskDelegation,
  supportsWorkspaceBrowserAutomation,
} from '../../services/workspaces/connector';
import { useSettingsStore } from '../../store/useSettingsStore';

export interface RuntimeToolAvailabilityContext {
  hasWorkspaceTargets: boolean;
  hasBrowserControllableWorkspaceTargets: boolean;
  hasDelegableWorkspaceTargets: boolean;
}

function normalizeWorkspaceTargets(targets?: WorkspaceTargetConfig[]): WorkspaceTargetConfig[] {
  return Array.isArray(targets) ? targets : [];
}

function hasLinkedBrowserProvider(target: WorkspaceTargetConfig): boolean {
  const enabledProviders = (useSettingsStore.getState().browserProviders ?? []).filter(
    (provider) => getBrowserProviderReadiness(provider).launchable,
  );
  if (enabledProviders.length === 0) {
    return false;
  }

  const linkedProviderId = (target.browserProviderId || '').trim();
  if (!linkedProviderId) {
    return true;
  }

  return enabledProviders.some((provider) => provider.id === linkedProviderId);
}

function hasLinkedSshTarget(target: WorkspaceTargetConfig): boolean {
  const linkedSshTargetId = (target.sshTargetId || '').trim();
  if (!linkedSshTargetId) {
    return false;
  }

  return (useSettingsStore.getState().sshTargets ?? []).some(
    (sshTarget) =>
      sshTarget.id === linkedSshTargetId && getSshTargetReadiness(sshTarget).launchable,
  );
}

export function hasBrowserControllableWorkspaceTargets(targets?: WorkspaceTargetConfig[]): boolean {
  return normalizeWorkspaceTargets(targets).some(
    (target) =>
      supportsWorkspaceBrowserAutomation(target) &&
      getWorkspaceTargetReadiness(target).launchable &&
      hasLinkedBrowserProvider(target),
  );
}

export function hasDelegableWorkspaceTargets(targets?: WorkspaceTargetConfig[]): boolean {
  return normalizeWorkspaceTargets(targets).some(
    (target) =>
      supportsWorkspaceAiTaskDelegation(target) &&
      getWorkspaceTargetReadiness(target).launchable &&
      hasLinkedSshTarget(target),
  );
}

export function getRuntimeToolAvailabilityContext(
  targets?: WorkspaceTargetConfig[],
): RuntimeToolAvailabilityContext {
  const resolvedTargets = targets ?? useSettingsStore.getState().workspaceTargets ?? [];
  return {
    hasWorkspaceTargets: resolvedTargets.length > 0,
    hasBrowserControllableWorkspaceTargets: hasBrowserControllableWorkspaceTargets(resolvedTargets),
    hasDelegableWorkspaceTargets: hasDelegableWorkspaceTargets(resolvedTargets),
  };
}

export function filterToolsByRuntimeAvailability(
  tools: ToolDefinition[],
  context?: RuntimeToolAvailabilityContext,
): ToolDefinition[] {
  const resolvedContext = context ?? getRuntimeToolAvailabilityContext();
  return tools.filter((tool) => isToolRuntimeAvailable(tool.name, resolvedContext));
}

export function isToolRuntimeAvailable(
  toolName: string,
  context?: RuntimeToolAvailabilityContext,
): boolean {
  const resolvedContext = context ?? getRuntimeToolAvailabilityContext();
  if (toolName === 'workspace_status') {
    return resolvedContext.hasWorkspaceTargets;
  }
  if (toolName === 'workspace_launch_browser') {
    return resolvedContext.hasBrowserControllableWorkspaceTargets;
  }
  if (toolName === 'workspace_delegate_task') {
    return resolvedContext.hasDelegableWorkspaceTargets;
  }
  return true;
}

export function filterRuntimeAvailableToolNames(
  toolNames?: string[],
  context?: RuntimeToolAvailabilityContext,
): string[] | undefined {
  if (!toolNames?.length) {
    return undefined;
  }

  const resolvedContext = context ?? getRuntimeToolAvailabilityContext();
  const filtered = Array.from(
    new Set(toolNames.filter((toolName) => isToolRuntimeAvailable(toolName, resolvedContext))),
  );

  return filtered.length > 0 ? filtered : undefined;
}
