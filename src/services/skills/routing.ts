import { useSettingsStore } from '../../store/useSettingsStore';
import type { AppSettings } from '../../types/settings';
import type { SkillExecutionSurface, SkillMetadata } from './types';
import { getSkillCompatibility } from './manifest';
import { buildSkillEligibilityContext, targetSupportsConfigPath } from './eligibility';
import { getBrowserProviderLabel } from '../browser/providers/labels';
import { getBrowserProviderReadiness } from '../browser/providers/readiness';
import { getSshTargetLabel, getSshTargetReadiness } from '../ssh/connector';
import {
  getWorkspaceProviderLabel,
  getWorkspaceTargetReadiness,
  supportsWorkspaceFileAccess,
} from '../workspaces/connector';

export interface SkillExecutionRoute {
  surface: SkillExecutionSurface;
  targetId?: string;
  targetName?: string;
  detail: string;
}

export interface SkillExecutionPlan {
  selectedRoute: SkillExecutionRoute | null;
  fallbackRoutes: SkillExecutionRoute[];
}

function uniqueRoutes(routes: SkillExecutionRoute[]): SkillExecutionRoute[] {
  const seen = new Set<string>();
  return routes.filter((route) => {
    const key = `${route.surface}:${route.targetId || route.targetName || route.detail}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function prioritizeSurfaces(
  surfaces: SkillExecutionSurface[],
  metadata: SkillMetadata,
): SkillExecutionSurface[] {
  const ordered = [...surfaces];

  if ((metadata.requires?.config?.length || 0) > 0 && ordered.includes('workspace')) {
    return ['workspace', ...ordered.filter((surface) => surface !== 'workspace')];
  }

  return ordered;
}

function getSurfaceRoutes(
  surface: SkillExecutionSurface,
  metadata: SkillMetadata,
  settings: Pick<
    AppSettings,
    'mcpServers' | 'sshTargets' | 'workspaceTargets' | 'browserProviders'
  >,
): SkillExecutionRoute[] {
  switch (surface) {
    case 'local-mobile':
      return [{ surface, detail: 'Run directly on-device' }];
    case 'local-js':
      return [{ surface, detail: 'Run through the embedded JavaScript helpers' }];
    case 'mcp':
      return (settings.mcpServers || [])
        .filter((server) => server.enabled)
        .map((server) => ({
          surface,
          targetId: server.id,
          targetName: server.name,
          detail: server.url,
        }));
    case 'ssh':
      return (settings.sshTargets || [])
        .filter((target) => getSshTargetReadiness(target).launchable)
        .map((target) => ({
          surface,
          targetId: target.id,
          targetName: target.name,
          detail: getSshTargetLabel(target),
        }));
    case 'workspace':
      return (settings.workspaceTargets || [])
        .filter(
          (target) =>
            supportsWorkspaceFileAccess(target) && getWorkspaceTargetReadiness(target).launchable,
        )
        .filter((target) => {
          const configPaths = metadata.requires?.config || [];
          if (configPaths.length === 0) {
            return true;
          }
          return configPaths.every((configPath) => targetSupportsConfigPath(target, configPath));
        })
        .map((target) => ({
          surface,
          targetId: target.id,
          targetName: target.name,
          detail: `${getWorkspaceProviderLabel(target.provider)} · ${target.rootPath}`,
        }));
    case 'browser-job':
      return (settings.browserProviders || [])
        .filter((provider) => getBrowserProviderReadiness(provider).launchable)
        .map((provider) => ({
          surface,
          targetId: provider.id,
          targetName: provider.name,
          detail: `${getBrowserProviderLabel(provider.provider)}${provider.projectId ? ` · ${provider.projectId}` : ''}`,
        }));
    default:
      return [];
  }
}

export function resolveSkillExecutionPlan(
  metadata: SkillMetadata,
  settings: Pick<
    AppSettings,
    'mcpServers' | 'sshTargets' | 'workspaceTargets' | 'browserProviders'
  >,
): SkillExecutionPlan {
  const compatibility = getSkillCompatibility(metadata, buildSkillEligibilityContext(settings));
  const orderedSurfaces = prioritizeSurfaces(
    compatibility.availableSurfaces.length > 0
      ? compatibility.availableSurfaces
      : compatibility.suggestedSurfaces,
    metadata,
  );
  const allRoutes = uniqueRoutes(
    orderedSurfaces.flatMap((surface) => getSurfaceRoutes(surface, metadata, settings)),
  );

  return {
    selectedRoute: allRoutes[0] || null,
    fallbackRoutes: allRoutes.slice(1),
  };
}

export function resolveSettingsSkillExecutionPlan(metadata: SkillMetadata): SkillExecutionPlan {
  const state = useSettingsStore.getState();
  return resolveSkillExecutionPlan(metadata, state);
}
