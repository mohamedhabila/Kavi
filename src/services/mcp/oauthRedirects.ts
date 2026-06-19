import * as AuthSession from 'expo-auth-session';
import Constants from 'expo-constants';
import type { McpServerConfig } from '../../types/remote';

const DEFAULT_PROXY_BASE_URL = 'https://auth.expo.io';
const OAUTH_RETURN_PATH = 'mcp-auth';

function sanitizeProjectNameForProxy(value?: string): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) {
    return undefined;
  }

  if (!trimmed.startsWith('@')) {
    return undefined;
  }

  const segments = trimmed.slice(1).split('/').filter(Boolean);
  if (segments.length !== 2) {
    return undefined;
  }

  return `@${segments[0]}/${segments[1]}`;
}

function getDefaultProjectNameForProxy(): string | undefined {
  const expoConfig = Constants.expoConfig as {
    originalFullName?: string;
    owner?: string;
    slug?: string;
  } | null;
  const originalFullName = sanitizeProjectNameForProxy(expoConfig?.originalFullName);
  if (originalFullName) {
    return originalFullName;
  }

  const slug = expoConfig?.slug?.trim() || 'kavi';
  const owner = expoConfig?.owner?.trim();
  if (owner) {
    return `@${owner}/${slug}`;
  }

  return `@anonymous/${slug}`;
}

export function getProjectNameForProxy(server: McpServerConfig): string {
  return (
    sanitizeProjectNameForProxy(server.oauth?.projectNameForProxy) ||
    getDefaultProjectNameForProxy() ||
    '@anonymous/kavi'
  );
}

export function shouldUseProxy(server: McpServerConfig): boolean {
  const projectName = getProjectNameForProxy(server);
  return !projectName.startsWith('@anonymous/');
}

export function getDirectRedirectUrl(serverId: string): string {
  return AuthSession.makeRedirectUri({
    scheme: 'kavi',
    path: `${OAUTH_RETURN_PATH}/${encodeURIComponent(serverId)}`,
  });
}

export function getRedirectUrl(projectNameForProxy: string): string {
  return `${DEFAULT_PROXY_BASE_URL}/${projectNameForProxy}`;
}

export function getReturnUrl(serverId: string): string {
  return AuthSession.getDefaultReturnUrl(`${OAUTH_RETURN_PATH}/${encodeURIComponent(serverId)}`);
}

export function getStartUrl(
  authUrl: string,
  returnUrl: string,
  projectNameForProxy: string,
): string {
  const query = new URLSearchParams({ authUrl, returnUrl });
  return `${getRedirectUrl(projectNameForProxy)}/start?${query.toString()}`;
}
