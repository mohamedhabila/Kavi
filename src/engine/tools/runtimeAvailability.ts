import type { ToolDefinition, WorkspaceTargetConfig } from '../../types';
import { getBrowserProviderReadiness } from '../../services/browser/providers';
import { getSshTargetReadiness } from '../../services/ssh/connector';
import {
  getWorkspaceTargetReadiness,
  supportsWorkspaceAiTaskDelegation,
  supportsWorkspaceBrowserAutomation,
  supportsWorkspaceFileAccess,
} from '../../services/workspaces/connector';
import { useSettingsStore } from '../../store/useSettingsStore';

export interface RuntimeToolAvailabilityContext {
  hasWorkspaceTargets: boolean;
  hasLaunchableWorkspaceTargets: boolean;
  hasControllableWorkspaceTargets: boolean;
}

export const REMOTE_WORKSPACE_FILE_TOOL_NAMES = new Set([
  'workspace_read_file',
  'workspace_write_file',
  'workspace_list_files',
  'workspace_mkdir',
  'workspace_rename',
  'workspace_delete',
]);

export const REMOTE_WORKSPACE_CONTROL_TOOL_NAMES = new Set([
  'workspace_launch_browser',
  'workspace_delegate_task',
]);

const REMOTE_TO_LOCAL_WORKSPACE_TOOL_FALLBACKS: Record<string, string> = {
  workspace_read_file: 'read_file',
  workspace_write_file: 'write_file',
  workspace_list_files: 'list_files',
};

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

export function hasLaunchableWorkspaceTargets(targets?: WorkspaceTargetConfig[]): boolean {
  return normalizeWorkspaceTargets(targets).some(
    (target) =>
      supportsWorkspaceFileAccess(target) && getWorkspaceTargetReadiness(target).launchable,
  );
}

export function hasControllableWorkspaceTargets(targets?: WorkspaceTargetConfig[]): boolean {
  return normalizeWorkspaceTargets(targets).some(
    (target) =>
      (supportsWorkspaceBrowserAutomation(target) && hasLinkedBrowserProvider(target)) ||
      (supportsWorkspaceAiTaskDelegation(target) && hasLinkedSshTarget(target)),
  );
}

export function getRuntimeToolAvailabilityContext(
  targets?: WorkspaceTargetConfig[],
): RuntimeToolAvailabilityContext {
  const resolvedTargets = targets ?? useSettingsStore.getState().workspaceTargets ?? [];
  return {
    hasWorkspaceTargets: resolvedTargets.length > 0,
    hasLaunchableWorkspaceTargets: hasLaunchableWorkspaceTargets(resolvedTargets),
    hasControllableWorkspaceTargets: hasControllableWorkspaceTargets(resolvedTargets),
  };
}

export function filterToolsByRuntimeAvailability(
  tools: ToolDefinition[],
  context?: RuntimeToolAvailabilityContext,
): ToolDefinition[] {
  const resolvedContext = context ?? getRuntimeToolAvailabilityContext();
  return tools.filter((tool) => {
    if (tool.name === 'workspace_status') {
      return resolvedContext.hasWorkspaceTargets;
    }
    if (REMOTE_WORKSPACE_FILE_TOOL_NAMES.has(tool.name)) {
      return resolvedContext.hasLaunchableWorkspaceTargets;
    }
    if (REMOTE_WORKSPACE_CONTROL_TOOL_NAMES.has(tool.name)) {
      return resolvedContext.hasControllableWorkspaceTargets;
    }
    return true;
  });
}

export function resolveRuntimeFallbackToolName(
  toolName: string,
  options?: {
    availableToolNames?: ReadonlySet<string>;
    context?: RuntimeToolAvailabilityContext;
  },
): string {
  const resolvedContext = options?.context ?? getRuntimeToolAvailabilityContext();
  if (resolvedContext.hasLaunchableWorkspaceTargets) {
    return toolName;
  }

  const fallback = REMOTE_TO_LOCAL_WORKSPACE_TOOL_FALLBACKS[toolName];
  if (!fallback) {
    return toolName;
  }

  if (options?.availableToolNames && !options.availableToolNames.has(fallback)) {
    return toolName;
  }

  return fallback;
}

export function remapRuntimeUnavailableToolNames(
  toolNames?: string[],
  options?: {
    availableToolNames?: ReadonlySet<string>;
    context?: RuntimeToolAvailabilityContext;
  },
): string[] | undefined {
  if (!toolNames?.length) {
    return undefined;
  }

  const remapped = Array.from(
    new Set(toolNames.map((toolName) => resolveRuntimeFallbackToolName(toolName, options))),
  );

  return remapped.length > 0 ? remapped : undefined;
}
