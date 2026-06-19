import type { AppSettings } from '../../types/settings';
import type {
  BrowserProviderConfig,
  SshTargetConfig,
  WorkspaceTargetConfig,
} from '../../types/remote';
import { useSettingsStore } from '../../store/useSettingsStore';
import type { SkillEligibilityContext, SkillExecutionSurface } from './types';
import { getBrowserProviderReadiness } from '../browser/providers/readiness';
import { getExpoProjectReadiness } from '../expo/projectAutomation';
import { getSshTargetReadiness } from '../ssh/connector';
import { getWorkspaceTargetReadiness, supportsWorkspaceFileAccess } from '../workspaces/connector';

const SURFACE_ORDER: SkillExecutionSurface[] = [
  'local-mobile',
  'local-js',
  'mcp',
  'ssh',
  'workspace',
  'browser-job',
  'expo-eas',
];

function normalizePath(path: string): string {
  return path.trim().replace(/\\/g, '/').replace(/\/+$/g, '');
}

function isEnabledSshTarget(target: SshTargetConfig): boolean {
  return getSshTargetReadiness(target).launchable;
}

function isEnabledWorkspaceTarget(target: WorkspaceTargetConfig): boolean {
  return supportsWorkspaceFileAccess(target) && getWorkspaceTargetReadiness(target).launchable;
}

function isEnabledBrowserProvider(provider: BrowserProviderConfig): boolean {
  return getBrowserProviderReadiness(provider).launchable;
}

function uniqueSurfaces(surfaces: SkillExecutionSurface[]): SkillExecutionSurface[] {
  const seen = new Set<SkillExecutionSurface>();
  return SURFACE_ORDER.filter((surface) => {
    if (!surfaces.includes(surface) || seen.has(surface)) {
      return false;
    }
    seen.add(surface);
    return true;
  });
}

function getWorkspaceCandidates(target: WorkspaceTargetConfig): string[] {
  return [target.rootPath, ...(target.configRoots || [])].map(normalizePath).filter(Boolean);
}

export function targetSupportsConfigPath(
  target: WorkspaceTargetConfig,
  configPath: string,
): boolean {
  const normalizedConfigPath = normalizePath(configPath);
  if (!normalizedConfigPath) {
    return false;
  }

  return getWorkspaceCandidates(target).some(
    (candidate) =>
      normalizedConfigPath === candidate ||
      normalizedConfigPath.startsWith(`${candidate}/`) ||
      candidate.startsWith(`${normalizedConfigPath}/`),
  );
}

export function buildSkillEligibilityContext(
  settings: Pick<
    AppSettings,
    | 'mcpServers'
    | 'sshTargets'
    | 'workspaceTargets'
    | 'browserProviders'
    | 'expoAccounts'
    | 'expoProjects'
  >,
  overrides: Partial<SkillEligibilityContext> = {},
): SkillEligibilityContext {
  const enabledSshTargets = (settings.sshTargets || []).filter(isEnabledSshTarget);
  const enabledWorkspaceTargets = (settings.workspaceTargets || []).filter(
    isEnabledWorkspaceTarget,
  );
  const enabledBrowserProviders = (settings.browserProviders || []).filter(
    isEnabledBrowserProvider,
  );
  const enabledMcpServers = (settings.mcpServers || []).filter((server) => server.enabled);
  const expoAccountsById = new Map(
    (settings.expoAccounts || []).map((account) => [account.id, account]),
  );
  const enabledExpoProjects = (settings.expoProjects || []).filter(
    (project) =>
      getExpoProjectReadiness(project, expoAccountsById.get(project.accountId), settings)
        .launchable,
  );

  const availableSurfaces = uniqueSurfaces([
    'local-mobile',
    'local-js',
    ...(enabledMcpServers.length > 0 ? (['mcp'] as SkillExecutionSurface[]) : []),
    ...(enabledSshTargets.length > 0 ? (['ssh'] as SkillExecutionSurface[]) : []),
    ...(enabledWorkspaceTargets.length > 0 ? (['workspace'] as SkillExecutionSurface[]) : []),
    ...(enabledBrowserProviders.length > 0 ? (['browser-job'] as SkillExecutionSurface[]) : []),
    ...(enabledExpoProjects.length > 0 ? (['expo-eas'] as SkillExecutionSurface[]) : []),
    ...(overrides.availableSurfaces || []),
  ]);

  const supportsConfigPath =
    overrides.supportsConfigPath ||
    (enabledWorkspaceTargets.length > 0
      ? (configPath: string) =>
          enabledWorkspaceTargets.some((target) => targetSupportsConfigPath(target, configPath))
      : undefined);

  return {
    platform: overrides.platform,
    availableSurfaces,
    hasSecret: overrides.hasSecret,
    supportsConfigPath,
  };
}

export function getSettingsSkillEligibilityContext(
  overrides: Partial<SkillEligibilityContext> = {},
): SkillEligibilityContext {
  const state = useSettingsStore.getState();
  return buildSkillEligibilityContext(state, overrides);
}
