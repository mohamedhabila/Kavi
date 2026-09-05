import { parseSecretRuntimeRequirement, type ToolDefinition } from '../../types/tool';
import type { WorkspaceTargetConfig } from '../../types/remote';
import { getBrowserProviderReadiness } from '../../services/browser/providers/readiness';
import { getSshTargetReadiness } from '../../services/ssh/connector';
import {
  getWorkspaceTargetReadiness,
  supportsWorkspaceAiTaskDelegation,
  supportsWorkspaceBrowserAutomation,
} from '../../services/workspaces/connector';
import { useSettingsStore } from '../../store/useSettingsStore';
import { createLogger } from '../../utils/logger';

const logger = createLogger('ToolRuntimeAvailability');
import { getSecure } from '../../services/storage/SecureStorage';
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
  /**
   * Resolves whether a named secure-storage secret (e.g. `OPENWEATHER_API_KEY`) is
   * currently configured. Backs `secret:<NAME>` runtime requirements so a code-owned
   * service skill tool that needs a secret is never advertised before that secret is
   * configured — see `secretRuntimeRequirement` below.
   */
  hasConfiguredSecret: (secretName: string) => boolean;
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
  const secretName = parseSecretRuntimeRequirement(requirement);
  if (secretName !== undefined) {
    return context.hasConfiguredSecret(secretName);
  }

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

/**
 * Synchronous view of which secure-storage secrets are configured, mirroring
 * `searchProviderReadiness.ts`'s snapshot: tool-surface selection is synchronous but
 * secrets live behind an async `getSecure` read, so each secret name is probed once in
 * the background and the last-settled snapshot is read back immediately. Unknown (not
 * yet probed) counts as unconfigured — advertising a tool that cannot work costs a
 * guaranteed failed call, while withholding one briefly costs at most the turns before
 * the probe settles, and the probe re-fires on every surface build.
 */
const configuredSecretSnapshots = new Map<string, boolean>();
const secretProbesInFlight = new Map<string, Promise<void>>();

function refreshSecretConfiguredSnapshot(secretName: string): Promise<void> {
  const inFlight = secretProbesInFlight.get(secretName);
  if (inFlight) {
    return inFlight;
  }

  // Start inside a promise chain so a store that throws synchronously (a host without a
  // usable keychain, or a partial test double) is handled exactly like a rejected probe
  // instead of crashing the surface build that called us.
  const probe = Promise.resolve()
    .then(() => getSecure(secretName))
    .then((value) => {
      configuredSecretSnapshots.set(secretName, Boolean((value ?? '').trim()));
    })
    .catch((error: unknown) => {
      // A probe failure is not evidence either way; leave any settled value standing.
      logger.warn('secret configuration probe failed; tool stays withheld until it succeeds', {
        secretName,
        error: error instanceof Error ? error.message : String(error),
      });
    })
    .finally(() => {
      secretProbesInFlight.delete(secretName);
    });
  secretProbesInFlight.set(secretName, probe);
  return probe;
}

function isSecretConfiguredSnapshot(secretName: string): boolean {
  return configuredSecretSnapshots.get(secretName) === true;
}

function hasConfiguredSecret(secretName: string): boolean {
  void refreshSecretConfiguredSnapshot(secretName);
  return isSecretConfiguredSnapshot(secretName);
}

/** Test seam; also lets a settings write invalidate a secret's snapshot immediately. */
export function setSecretConfiguredSnapshot(secretName: string, configured: boolean): void {
  configuredSecretSnapshots.set(secretName, configured);
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
    hasConfiguredSecret,
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
