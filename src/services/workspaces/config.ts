import type { BrowserProviderConfig, SshTargetConfig, WorkspaceTargetConfig } from '../../types';
import { getWorkspaceProviderLabel } from './connector';

function normalizeLinkedId(id?: string): string | undefined {
  const normalized = (id || '').trim();
  return normalized || undefined;
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
