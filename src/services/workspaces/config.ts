import type {
  BrowserProviderConfig,
  SshTargetConfig,
  WorkspaceTargetConfig,
} from '../../types/remote';
import { getWorkspaceProviderLabel } from './connector';

function normalizeLinkedId(id?: string): string | undefined {
  const normalized = (id || '').trim();
  return normalized || undefined;
}

export function normalizeWorkspaceTargetId(id: string | null | undefined): string | null {
  const normalized = typeof id === 'string' ? id.trim() : '';
  return normalized || null;
}

export function getWorkspaceTargetDisplayName(
  target: Pick<WorkspaceTargetConfig, 'name' | 'rootPath' | 'provider'>,
): string {
  const explicitName = (target.name || '').trim();
  if (explicitName) {
    return explicitName;
  }

  const rootPath = (target.rootPath || '').trim();
  if (rootPath) {
    const segments = rootPath.split(/[\\/]+/).filter(Boolean);
    const leafName = segments[segments.length - 1];
    return leafName || rootPath;
  }

  return getWorkspaceProviderLabel(target.provider);
}

export function normalizeWorkspaceTargetLinks(
  target: WorkspaceTargetConfig,
  options?: {
    browserProviders?: BrowserProviderConfig[];
    sshTargets?: SshTargetConfig[];
  },
): WorkspaceTargetConfig {
  const browserProviderId = normalizeLinkedId(target.browserProviderId);
  const sshTargetId = normalizeLinkedId(target.sshTargetId);
  const browserProviders = options?.browserProviders || [];
  const sshTargets = options?.sshTargets || [];

  return {
    ...target,
    browserProviderId:
      browserProviderId && browserProviders.some((provider) => provider.id === browserProviderId)
        ? browserProviderId
        : undefined,
    sshTargetId:
      sshTargetId && sshTargets.some((entry) => entry.id === sshTargetId) ? sshTargetId : undefined,
  };
}

export function resolveDefaultWorkspaceTargetId(options: {
  defaultWorkspaceTargetId?: string | null;
  workspaceTargets?: WorkspaceTargetConfig[];
}): string | null {
  const workspaceTargets = options.workspaceTargets || [];
  const normalizedDefault = normalizeWorkspaceTargetId(options.defaultWorkspaceTargetId);

  if (
    normalizedDefault &&
    workspaceTargets.some((target) => target.id === normalizedDefault && target.enabled)
  ) {
    return normalizedDefault;
  }

  const enabledTargets = workspaceTargets.filter((target) => target.enabled);
  return enabledTargets.length === 1 ? enabledTargets[0].id : null;
}

export function resolveWorkspaceTargetId(options: {
  workspaceTargetId?: string | null;
  defaultWorkspaceTargetId?: string | null;
  workspaceTargets?: WorkspaceTargetConfig[];
}): string | null {
  const workspaceTargets = options.workspaceTargets || [];
  const normalizedTargetId = normalizeWorkspaceTargetId(options.workspaceTargetId);

  if (
    normalizedTargetId &&
    workspaceTargets.some((target) => target.id === normalizedTargetId && target.enabled)
  ) {
    return normalizedTargetId;
  }

  return resolveDefaultWorkspaceTargetId({
    defaultWorkspaceTargetId: options.defaultWorkspaceTargetId,
    workspaceTargets,
  });
}

export function resolveWorkspaceTarget(options: {
  workspaceTargetId?: string | null;
  defaultWorkspaceTargetId?: string | null;
  workspaceTargets?: WorkspaceTargetConfig[];
}): WorkspaceTargetConfig | null {
  const workspaceTargets = options.workspaceTargets || [];
  const resolvedTargetId = resolveWorkspaceTargetId(options);

  if (!resolvedTargetId) {
    return null;
  }

  return (
    workspaceTargets.find((target) => target.id === resolvedTargetId && target.enabled) || null
  );
}
