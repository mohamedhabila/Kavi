import { getSecure } from '../storage/SecureStorage';
import { i18n } from '../../i18n/manager';
import type { WorkspaceTargetConfig } from '../../types/remote';

export type WorkspaceProvider = NonNullable<WorkspaceTargetConfig['provider']>;
export type WorkspaceAuthMode = NonNullable<WorkspaceTargetConfig['authMode']>;
export type WorkspaceFileAccessMode = 'native' | 'custom' | 'none';

export interface WorkspaceTargetCapabilities {
  fileAccessMode: WorkspaceFileAccessMode;
  supportsFileAccess: boolean;
  supportsBrowserAutomation: boolean;
  supportsAiTaskDelegation: boolean;
}

export interface WorkspaceConnectionReadiness {
  launchable: boolean;
  reason:
    | 'ready'
    | 'disabled'
    | 'missing-root-path'
    | 'missing-base-url'
    | 'invalid-base-url'
    | 'missing-token'
    | 'missing-query-token-param';
}

export interface WorkspaceLaunchRequest {
  uri: string;
  headers?: Record<string, string>;
  provider: WorkspaceProvider;
}

export interface WorkspaceProbeResult {
  ok: boolean;
  status?: number;
  message: string;
  checkedAt: number;
}

export const WORKSPACE_PROVIDER_OPTIONS: WorkspaceProvider[] = [
  'code-server',
  'openvscode-server',
  'vscode-web',
  'vscode-tunnel',
  'cursor',
  'windsurf',
  'antigravity',
  'generic-vscode',
  'custom',
];

export const WORKSPACE_AUTH_MODE_OPTIONS: WorkspaceAuthMode[] = ['none', 'bearer', 'query-token'];

function normalizeProvider(provider?: WorkspaceTargetConfig['provider']): WorkspaceProvider {
  return provider || 'code-server';
}

function providerUsesFolderQuery(provider: WorkspaceProvider): boolean {
  return provider === 'code-server' || provider === 'openvscode-server' || provider === 'custom';
}

function normalizeAuthMode(authMode?: WorkspaceTargetConfig['authMode']): WorkspaceAuthMode {
  return authMode || 'none';
}

function normalizeBaseUrl(baseUrl?: string): string {
  return (baseUrl || '').trim().replace(/\/+$/g, '');
}

function normalizeRootPath(rootPath: string): string {
  return rootPath.trim();
}

export function isValidWorkspaceBaseUrl(baseUrl?: string): boolean {
  const normalized = normalizeBaseUrl(baseUrl);
  if (!normalized) {
    return false;
  }

  try {
    const parsed = new URL(normalized);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

export function getWorkspaceProviderLabel(provider?: WorkspaceTargetConfig['provider']): string {
  switch (normalizeProvider(provider)) {
    case 'vscode-web':
      return i18n.t('remoteWork.providerVSCodeWeb');
    case 'vscode-tunnel':
      return i18n.t('remoteWork.providerVSCodeTunnel');
    case 'cursor':
      return i18n.t('remoteWork.providerCursor');
    case 'windsurf':
      return i18n.t('remoteWork.providerWindsurf');
    case 'antigravity':
      return i18n.t('remoteWork.providerAntigravity');
    case 'generic-vscode':
      return i18n.t('remoteWork.providerGenericVSCode');
    case 'openvscode-server':
      return i18n.t('remoteWork.providerOpenVSCode');
    case 'custom':
      return i18n.t('remoteWork.providerCustom');
    case 'code-server':
    default:
      return i18n.t('remoteWork.providerCodeServer');
  }
}

export function getWorkspaceProviderFileAccessMode(
  provider?: WorkspaceTargetConfig['provider'],
): WorkspaceFileAccessMode {
  switch (normalizeProvider(provider)) {
    case 'code-server':
    case 'openvscode-server':
      return 'native';
    case 'custom':
      return 'custom';
    case 'vscode-web':
    case 'vscode-tunnel':
    case 'cursor':
    case 'windsurf':
    case 'antigravity':
    case 'generic-vscode':
    default:
      return 'none';
  }
}

export function getWorkspaceTargetReadiness(
  target: WorkspaceTargetConfig,
  accessToken?: string | null,
): WorkspaceConnectionReadiness {
  const rootPath = normalizeRootPath(target.rootPath);
  const baseUrl = normalizeBaseUrl(target.baseUrl);
  const authMode = normalizeAuthMode(target.authMode);
  const hasToken = Boolean((accessToken || '').trim() || (target.accessTokenRef || '').trim());

  if (!target.enabled) {
    return { launchable: false, reason: 'disabled' };
  }

  if (!rootPath) {
    return { launchable: false, reason: 'missing-root-path' };
  }

  if (!baseUrl) {
    return { launchable: false, reason: 'missing-base-url' };
  }

  if (!isValidWorkspaceBaseUrl(baseUrl)) {
    return { launchable: false, reason: 'invalid-base-url' };
  }

  if (authMode === 'query-token' && !(target.queryTokenParam || '').trim()) {
    return { launchable: false, reason: 'missing-query-token-param' };
  }

  if (authMode !== 'none' && !hasToken) {
    return { launchable: false, reason: 'missing-token' };
  }

  return { launchable: true, reason: 'ready' };
}

export function supportsWorkspaceFileAccess(target: WorkspaceTargetConfig): boolean {
  return getWorkspaceProviderFileAccessMode(target.provider) !== 'none';
}

export function supportsWorkspaceBrowserAutomation(target: WorkspaceTargetConfig): boolean {
  return (
    getWorkspaceTargetReadiness(target).launchable &&
    normalizeAuthMode(target.authMode) !== 'bearer'
  );
}

export function supportsWorkspaceAiTaskDelegation(target: WorkspaceTargetConfig): boolean {
  if (!target.enabled || !normalizeRootPath(target.rootPath)) {
    return false;
  }

  if (!(target.sshTargetId || '').trim()) {
    return false;
  }

  return (
    normalizeProvider(target.provider) === 'cursor' ||
    Boolean((target.aiTaskCommandTemplate || '').trim())
  );
}

export function getWorkspaceTargetCapabilities(
  target: WorkspaceTargetConfig,
): WorkspaceTargetCapabilities {
  const fileAccessMode = getWorkspaceProviderFileAccessMode(target.provider);

  return {
    fileAccessMode,
    supportsFileAccess: fileAccessMode !== 'none',
    supportsBrowserAutomation: supportsWorkspaceBrowserAutomation(target),
    supportsAiTaskDelegation: supportsWorkspaceAiTaskDelegation(target),
  };
}

export function buildWorkspaceLaunchUrl(
  target: WorkspaceTargetConfig,
  accessToken?: string | null,
): string {
  const rootPath = normalizeRootPath(target.rootPath);
  const provider = normalizeProvider(target.provider);
  const authMode = normalizeAuthMode(target.authMode);
  const queryTokenParam = (target.queryTokenParam || '').trim() || 'token';
  const baseUrl = normalizeBaseUrl(target.baseUrl);

  if (baseUrl.includes('{rootPath}')) {
    const expandedUrl = baseUrl.replaceAll('{rootPath}', encodeURIComponent(rootPath));
    const parsed = new URL(expandedUrl);
    if (authMode === 'query-token' && accessToken) {
      parsed.searchParams.set(queryTokenParam, accessToken);
    }
    return parsed.toString();
  }

  const parsed = new URL(baseUrl);

  if (providerUsesFolderQuery(provider)) {
    parsed.searchParams.set('folder', rootPath);
  }

  if (authMode === 'query-token' && accessToken) {
    parsed.searchParams.set(queryTokenParam, accessToken);
  }

  return parsed.toString();
}

export async function resolveWorkspaceTargetLaunch(
  target: WorkspaceTargetConfig,
): Promise<WorkspaceLaunchRequest> {
  const accessToken = target.accessTokenRef ? await getSecure(target.accessTokenRef) : null;
  const readiness = getWorkspaceTargetReadiness(target, accessToken);

  if (!readiness.launchable) {
    throw new Error(readiness.reason);
  }

  const headers =
    normalizeAuthMode(target.authMode) === 'bearer' && accessToken
      ? { Authorization: `Bearer ${accessToken}` }
      : undefined;

  return {
    uri: buildWorkspaceLaunchUrl(target, accessToken),
    headers,
    provider: normalizeProvider(target.provider),
  };
}

export async function probeWorkspaceTarget(
  target: WorkspaceTargetConfig,
): Promise<WorkspaceProbeResult> {
  const checkedAt = Date.now();

  try {
    const request = await resolveWorkspaceTargetLaunch(target);
    const response = await fetch(request.uri, {
      method: 'GET',
      headers: {
        Accept: 'text/html,application/xhtml+xml',
        ...(request.headers || {}),
      },
    });

    return {
      ok: response.ok,
      status: response.status,
      message: response.ok ? `Ready (${response.status})` : `HTTP ${response.status}`,
      checkedAt,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown-error';
    return {
      ok: false,
      message,
      checkedAt,
    };
  }
}
