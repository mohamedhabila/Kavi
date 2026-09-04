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
import {
  isSearchProviderConfiguredSnapshot,
  refreshSearchProviderReadiness,
} from '../../services/browser/core/searchProviderReadiness';
import { resolveToolRuntimeRequirements } from './toolRuntimeRequirements';

export interface RuntimeToolAvailabilityContext {
  hasWorkspaceTargets: boolean;
  hasBrowserControllableWorkspaceTargets: boolean;
  hasDelegableWorkspaceTargets: boolean;
  hasMobileController: boolean;
  hasWebSearchProvider: boolean;
  hasDeveloperModeEnabled: boolean;
}

/**
 * Requirement keys a tool may declare in `contract.runtimeRequirements`.
 *
 * Availability used to be a hardcoded chain of tool-name comparisons, so any tool not
 * named in it was advertised unconditionally — `web_search` was offered on every turn
 * with no provider configured, spending a model round-trip on a call that could only
 * fail. Declaring the condition on the tool and evaluating it here means a new tool is
 * gated by describing itself, with no edit to this module.
 */
export const RUNTIME_TOOL_REQUIREMENTS = {
  WORKSPACE_TARGETS: 'workspace_targets',
  BROWSER_CONTROLLABLE_WORKSPACE_TARGETS: 'browser_controllable_workspace_targets',
  DELEGABLE_WORKSPACE_TARGETS: 'delegable_workspace_targets',
  MOBILE_CONTROLLER: 'mobile_controller',
  WEB_SEARCH_PROVIDER: 'web_search_provider',
  DEVELOPER_MODE: 'developer_mode',
} as const;

function isRequirementSatisfied(
  requirement: string,
  context: RuntimeToolAvailabilityContext,
): boolean {
  switch (requirement) {
    case RUNTIME_TOOL_REQUIREMENTS.WORKSPACE_TARGETS:
      return context.hasWorkspaceTargets;
    case RUNTIME_TOOL_REQUIREMENTS.BROWSER_CONTROLLABLE_WORKSPACE_TARGETS:
      return context.hasBrowserControllableWorkspaceTargets;
    case RUNTIME_TOOL_REQUIREMENTS.DELEGABLE_WORKSPACE_TARGETS:
      return context.hasDelegableWorkspaceTargets;
    case RUNTIME_TOOL_REQUIREMENTS.MOBILE_CONTROLLER:
      return context.hasMobileController;
    case RUNTIME_TOOL_REQUIREMENTS.WEB_SEARCH_PROVIDER:
      return context.hasWebSearchProvider;
    case RUNTIME_TOOL_REQUIREMENTS.DEVELOPER_MODE:
      return context.hasDeveloperModeEnabled;
    default:
      // An unrecognized requirement must not silently hide a working tool.
      return true;
  }
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
  // Keeps the synchronous snapshot honest without blocking surface selection.
  void refreshSearchProviderReadiness();
  return {
    hasWorkspaceTargets: resolvedTargets.length > 0,
    hasBrowserControllableWorkspaceTargets: hasBrowserControllableWorkspaceTargets(resolvedTargets),
    hasDelegableWorkspaceTargets: hasDelegableWorkspaceTargets(resolvedTargets),
    hasMobileController: false,
    hasWebSearchProvider: isSearchProviderConfiguredSnapshot(),
    hasDeveloperModeEnabled: useSettingsStore.getState().developerModeEnabled === true,
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
  const requirements = resolveToolRuntimeRequirements(toolName);
  return requirements.every((requirement) => isRequirementSatisfied(requirement, resolvedContext));
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

/** Pin callable host bindings that exist only for this exact model session. */
export function resolveRuntimeExplicitToolSurfaceToolNames(
  explicitToolNames: ReadonlyArray<string> | undefined,
  context: RuntimeToolAvailabilityContext,
): string[] | undefined {
  const resolved = [
    ...(explicitToolNames ?? []),
    ...(context.hasMobileController ? ['mobile_ui_action'] : []),
  ];
  return resolved.length > 0 ? Array.from(new Set(resolved)) : undefined;
}
