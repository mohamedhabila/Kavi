import 'react-native-get-random-values';

import * as AuthSession from 'expo-auth-session';
import Constants from 'expo-constants';
import * as WebBrowser from 'expo-web-browser';
import {
  discoverAuthorizationServerMetadata,
  discoverOAuthProtectedResourceMetadata,
  exchangeAuthorization,
  refreshAuthorization,
  registerClient,
} from '@modelcontextprotocol/sdk/client/auth.js';
import type {
  AuthorizationServerMetadata,
  OAuthClientInformationFull,
  OAuthClientMetadata,
  OAuthProtectedResourceMetadata,
  OAuthTokens,
} from '@modelcontextprotocol/sdk/shared/auth.js';
import { APP_DISPLAY_NAME, APP_VERSION } from '../../constants/appMetadata';
import type { McpOAuthConfig, McpServerConfig } from '../../types/remote';
import {
  deleteMcpOAuthClientSecret,
  deleteMcpOAuthSecret,
  getMcpOAuthClientSecret,
  getMcpOAuthSecret,
  saveMcpOAuthSecret,
} from '../storage/SecureStorage';

const DEFAULT_PROTOCOL_VERSION = '2025-03-26';
const DEFAULT_PROXY_BASE_URL = 'https://auth.expo.io';
const AUTH_REFRESH_SKEW_MS = 60_000;
const OAUTH_RETURN_PATH = 'mcp-auth';

type StoredOAuthTokens = OAuthTokens & {
  obtainedAt: number;
};

type PendingOAuthFlow = {
  state: string;
  codeVerifier: string;
  redirectUrl: string;
  returnUrl: string;
  projectNameForProxy: string;
};

type StoredOAuthState = {
  authorizationServerUrl?: string;
  metadata?: AuthorizationServerMetadata;
  resourceMetadata?: OAuthProtectedResourceMetadata;
  clientInformation?: OAuthClientInformationFull;
  tokens?: StoredOAuthTokens;
  pending?: PendingOAuthFlow;
};

type OAuthServerInfo = {
  authorizationServerUrl: string;
  metadata: AuthorizationServerMetadata;
  resourceMetadata?: OAuthProtectedResourceMetadata;
};

type OAuthOperation = 'client registration' | 'token exchange' | 'token refresh';

export class McpOAuthError extends Error {
  code: 'cancelled' | 'configuration_required' | 'auth_failed';

  constructor(message: string, code: McpOAuthError['code']) {
    super(message);
    this.name = 'McpOAuthError';
    this.code = code;
  }
}

function trimOAuthDetail(value?: string): string | undefined {
  const trimmed = value?.replace(/\s+/g, ' ').trim();
  if (!trimmed) {
    return undefined;
  }

  return trimmed.length > 240 ? `${trimmed.slice(0, 237)}...` : trimmed;
}

function shouldSuppressOAuthDetail(value?: string): boolean {
  if (!value) {
    return true;
  }

  const normalized = value.trim();
  return (
    /^(forbidden|unauthorized|not found|method not allowed)\.?$/i.test(normalized) ||
    /^<!doctype/i.test(normalized) ||
    /^<html/i.test(normalized) ||
    normalized.startsWith('<')
  );
}

function parseOAuthSdkFailure(error: unknown): {
  message: string;
  statusCode?: number;
  rawBody?: string;
  detail?: string;
} {
  const message = error instanceof Error ? error.message : String(error);
  const statusCode = Number(message.match(/\bHTTP\s+(\d{3})\b/i)?.[1] || '') || undefined;
  const rawBody = trimOAuthDetail(message.match(/Raw body:\s*([\s\S]*)$/i)?.[1]);
  const detail =
    rawBody && !shouldSuppressOAuthDetail(rawBody)
      ? rawBody
      : trimOAuthDetail(
          !/Invalid OAuth error response/i.test(message) && !shouldSuppressOAuthDetail(message)
            ? message
            : undefined,
        );

  return {
    message,
    statusCode,
    rawBody,
    detail,
  };
}

function normalizeOAuthOperationError(params: {
  server: McpServerConfig;
  operation: OAuthOperation;
  error: unknown;
  authorizationServerUrl?: string;
  projectNameForProxy?: string;
}): McpOAuthError {
  if (params.error instanceof McpOAuthError) {
    return params.error;
  }

  const parsed = parseOAuthSdkFailure(params.error);
  const statusSuffix = parsed.statusCode ? ` (HTTP ${parsed.statusCode})` : '';

  if (params.operation === 'client registration') {
    if (/does not support dynamic client registration/i.test(parsed.message)) {
      return new McpOAuthError(
        'This server requires an OAuth client registration. Edit this server to add a client ID and optional client secret.',
        'configuration_required',
      );
    }

    let message = `This server rejected automatic OAuth client registration${statusSuffix}.`;
    if (parsed.statusCode === 401 || parsed.statusCode === 403) {
      message += ' It may only allow pre-registered or allow-listed OAuth clients.';
    } else if (
      parsed.statusCode === 404 ||
      parsed.statusCode === 405 ||
      parsed.statusCode === 501
    ) {
      message += ' It may not support dynamic client registration on this endpoint.';
    }
    if (parsed.detail) {
      message += ` Server response: ${parsed.detail}.`;
    }
    message +=
      ' Edit this server to add a client ID and optional client secret, or connect with a client that the server administrator has already approved.';

    return new McpOAuthError(
      appendProxyConfigurationHint(message, params.projectNameForProxy || '@anonymous/kavi'),
      'configuration_required',
    );
  }

  let message =
    params.operation === 'token refresh'
      ? `The OAuth provider rejected the stored session during token refresh${statusSuffix}.`
      : `The OAuth provider rejected the authorization exchange${statusSuffix}.`;

  if (parsed.detail) {
    message += ` Server response: ${parsed.detail}.`;
  } else if (parsed.statusCode === 403) {
    message += ' The provider refused this client or redirect configuration.';
  }

  return new McpOAuthError(
    appendProxyConfigurationHint(message, params.projectNameForProxy || '@anonymous/kavi'),
    'auth_failed',
  );
}

async function runOAuthOperation<T>(params: {
  server: McpServerConfig;
  operation: OAuthOperation;
  execute: () => Promise<T>;
  authorizationServerUrl?: string;
  projectNameForProxy?: string;
}): Promise<T> {
  try {
    return await params.execute();
  } catch (error) {
    throw normalizeOAuthOperationError({
      server: params.server,
      operation: params.operation,
      error,
      authorizationServerUrl: params.authorizationServerUrl,
      projectNameForProxy: params.projectNameForProxy,
    });
  }
}

function stripToOrigin(url: string): string {
  const parsed = new URL(url);
  parsed.pathname = '/';
  parsed.search = '';
  parsed.hash = '';
  return parsed.toString();
}

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

function getProjectNameForProxy(server: McpServerConfig): string {
  return (
    sanitizeProjectNameForProxy(server.oauth?.projectNameForProxy) ||
    getDefaultProjectNameForProxy() ||
    '@anonymous/kavi'
  );
}

function shouldUseProxy(server: McpServerConfig): boolean {
  const projectName = getProjectNameForProxy(server);
  return !projectName.startsWith('@anonymous/');
}

function getDirectRedirectUrl(serverId: string): string {
  return AuthSession.makeRedirectUri({
    scheme: 'kavi',
    path: `${OAUTH_RETURN_PATH}/${encodeURIComponent(serverId)}`,
  });
}

function getRedirectUrl(projectNameForProxy: string): string {
  return `${DEFAULT_PROXY_BASE_URL}/${projectNameForProxy}`;
}

function getReturnUrl(serverId: string): string {
  return AuthSession.getDefaultReturnUrl(`${OAUTH_RETURN_PATH}/${encodeURIComponent(serverId)}`);
}

function getStartUrl(authUrl: string, returnUrl: string, projectNameForProxy: string): string {
  const query = new URLSearchParams({ authUrl, returnUrl });
  return `${getRedirectUrl(projectNameForProxy)}/start?${query.toString()}`;
}

function appendProxyConfigurationHint(message: string, projectNameForProxy: string): string {
  if (!projectNameForProxy.startsWith('@anonymous/')) {
    return message;
  }

  if (!/redirect[_ ]uri|redirect/i.test(message)) {
    return message;
  }

  return `${message} Set OAuth Proxy Project Name to your Expo project full name (@owner/slug) in the MCP server settings if this provider requires an allow-listed redirect URI.`;
}

function randomBase64Url(bytesLength = 32): string {
  const bytes = new Uint8Array(bytesLength);
  crypto.getRandomValues(bytes);

  let raw = '';
  for (const byte of bytes) {
    raw += String.fromCharCode(byte);
  }

  const base64 = btoa(raw);
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function jsSha256(message: Uint8Array): Uint8Array {
  const K: number[] = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ];
  const rotr = (n: number, x: number) => (x >>> n) | (x << (32 - n));
  const length = message.length;
  const bitLength = length * 8;
  const padded = new Uint8Array((length + 9 + 63) & ~63);
  padded.set(message);
  padded[length] = 0x80;

  const dataView = new DataView(padded.buffer);
  dataView.setUint32(padded.length - 4, bitLength, false);

  let [h0, h1, h2, h3, h4, h5, h6, h7] = [
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ];

  for (let offset = 0; offset < padded.length; offset += 64) {
    const words = new Int32Array(64);
    for (let index = 0; index < 16; index += 1) {
      words[index] = dataView.getInt32(offset + index * 4, false);
    }
    for (let index = 16; index < 64; index += 1) {
      const s0 =
        rotr(7, words[index - 15]) ^ rotr(18, words[index - 15]) ^ (words[index - 15] >>> 3);
      const s1 =
        rotr(17, words[index - 2]) ^ rotr(19, words[index - 2]) ^ (words[index - 2] >>> 10);
      words[index] = (words[index - 16] + s0 + words[index - 7] + s1) | 0;
    }

    let [a, b, c, d, e, f, g, h] = [h0, h1, h2, h3, h4, h5, h6, h7];
    for (let index = 0; index < 64; index += 1) {
      const s1 = rotr(6, e) ^ rotr(11, e) ^ rotr(25, e);
      const choice = (e & f) ^ (~e & g);
      const temp1 = (h + s1 + choice + K[index] + words[index]) | 0;
      const s0 = rotr(2, a) ^ rotr(13, a) ^ rotr(22, a);
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (s0 + majority) | 0;

      h = g;
      g = f;
      f = e;
      e = (d + temp1) | 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) | 0;
    }

    h0 = (h0 + a) | 0;
    h1 = (h1 + b) | 0;
    h2 = (h2 + c) | 0;
    h3 = (h3 + d) | 0;
    h4 = (h4 + e) | 0;
    h5 = (h5 + f) | 0;
    h6 = (h6 + g) | 0;
    h7 = (h7 + h) | 0;
  }

  const result = new Uint8Array(32);
  const resultView = new DataView(result.buffer);
  [h0, h1, h2, h3, h4, h5, h6, h7].forEach((value, index) => {
    resultView.setUint32(index * 4, value, false);
  });
  return result;
}

function base64UrlEncode(bytes: Uint8Array): string {
  let raw = '';
  for (const byte of bytes) {
    raw += String.fromCharCode(byte);
  }

  return btoa(raw).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function buildAuthorizationRequest(params: {
  metadata: AuthorizationServerMetadata;
  clientInformation: OAuthClientInformationFull;
  redirectUrl: string;
  scope?: string;
  state: string;
  resource?: URL;
}): { authorizationUrl: URL; codeVerifier: string } {
  const authorizationEndpoint = params.metadata.authorization_endpoint;
  if (!authorizationEndpoint) {
    throw new McpOAuthError(
      'This server did not provide an OAuth authorization endpoint.',
      'configuration_required',
    );
  }

  const clientId = params.clientInformation.client_id?.trim();
  if (!clientId) {
    throw new McpOAuthError(
      'This server requires an OAuth client registration. Edit this server to add a client ID and optional client secret.',
      'configuration_required',
    );
  }

  const codeVerifier = randomBase64Url(64);
  const codeChallenge = base64UrlEncode(jsSha256(new TextEncoder().encode(codeVerifier)));
  const query = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: params.redirectUrl,
    state: params.state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  });

  if (params.scope) {
    query.set('scope', params.scope);
  }
  if (params.resource) {
    query.append('resource', params.resource.toString());
  }

  return {
    authorizationUrl: new URL(`${authorizationEndpoint}?${query.toString()}`),
    codeVerifier,
  };
}

function buildFallbackMetadata(
  authorizationServerUrl: string,
  oauth?: McpOAuthConfig,
): AuthorizationServerMetadata {
  const baseUrl = stripToOrigin(authorizationServerUrl);
  return {
    issuer: baseUrl,
    authorization_endpoint: oauth?.authorizationUrl || new URL('/authorize', baseUrl).toString(),
    token_endpoint: oauth?.tokenUrl || new URL('/token', baseUrl).toString(),
    registration_endpoint: new URL('/register', baseUrl).toString(),
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256', 'plain'],
    token_endpoint_auth_methods_supported: oauth?.clientId
      ? [oauth.tokenEndpointAuthMethod || (oauth.clientSecretRef ? 'client_secret_basic' : 'none')]
      : ['none', 'client_secret_basic', 'client_secret_post'],
  };
}

function shouldFilterOAuthHeader(name: string): boolean {
  return /^(authorization|cookie)$/i.test(name);
}

function parseMaybeJson<T>(value: string | null): T | null {
  if (!value) {
    return null;
  }

  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

async function loadState(serverId: string): Promise<StoredOAuthState> {
  return parseMaybeJson<StoredOAuthState>(await getMcpOAuthSecret(serverId)) || {};
}

async function saveState(serverId: string, state: StoredOAuthState): Promise<void> {
  await saveMcpOAuthSecret(serverId, JSON.stringify(state));
}

function buildClientMetadata(
  redirectUrl: string,
  metadata: AuthorizationServerMetadata,
): OAuthClientMetadata {
  const grantTypes = metadata.grant_types_supported?.includes('refresh_token')
    ? ['authorization_code', 'refresh_token']
    : ['authorization_code'];

  return {
    client_name: APP_DISPLAY_NAME,
    redirect_uris: [redirectUrl],
    grant_types: grantTypes,
    response_types: ['code'],
    token_endpoint_auth_method: 'none',
    software_id: 'kavi',
    software_version: APP_VERSION,
  };
}

async function resolveClientInformation(
  server: McpServerConfig,
  metadata: AuthorizationServerMetadata,
  authorizationServerUrl: string,
  redirectUrl: string,
  projectNameForProxy?: string,
): Promise<OAuthClientInformationFull> {
  const storedState = await loadState(server.id);

  if (storedState.clientInformation?.client_id) {
    const savedRedirectUrl = storedState.clientInformation.redirect_uris?.[0];
    if (savedRedirectUrl === redirectUrl) {
      return storedState.clientInformation;
    }
  }

  if (server.oauth?.clientId) {
    const clientSecret = server.oauth.clientSecretRef
      ? await getMcpOAuthClientSecret(server.id)
      : null;

    return {
      client_id: server.oauth.clientId,
      client_secret: clientSecret || undefined,
      redirect_uris: [redirectUrl],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method:
        server.oauth.tokenEndpointAuthMethod || (clientSecret ? 'client_secret_basic' : 'none'),
      scope: server.oauth.scope,
    };
  }

  if (!metadata.registration_endpoint) {
    throw new McpOAuthError(
      'This server requires an OAuth client registration. Edit this server to add a client ID and optional client secret.',
      'configuration_required',
    );
  }

  return runOAuthOperation({
    server,
    operation: 'client registration',
    authorizationServerUrl,
    projectNameForProxy,
    execute: () =>
      registerClient(authorizationServerUrl, {
        metadata,
        clientMetadata: buildClientMetadata(redirectUrl, metadata),
        fetchFn: createOAuthFetch(server),
      }),
  });
}

function createOAuthFetch(server: McpServerConfig) {
  return async (input: RequestInfo | URL, init?: RequestInit) => {
    const headers = new Headers(init?.headers || {});

    if (!headers.has('Accept')) {
      headers.set('Accept', 'application/json');
    }

    for (const [key, value] of Object.entries(server.headers || {})) {
      if (!shouldFilterOAuthHeader(key)) {
        headers.set(key, value);
      }
    }

    return fetch(input, {
      ...init,
      headers,
    });
  };
}

async function discoverServerInfo(server: McpServerConfig): Promise<OAuthServerInfo> {
  const oauthConfig = server.oauth;

  if (oauthConfig?.authorizationUrl && oauthConfig.tokenUrl) {
    const authorizationServerUrl = stripToOrigin(oauthConfig.authorizationUrl);
    return {
      authorizationServerUrl,
      metadata: buildFallbackMetadata(authorizationServerUrl, oauthConfig),
    };
  }

  const fetchFn = createOAuthFetch(server);
  const resourceMetadata = await discoverOAuthProtectedResourceMetadata(
    server.url,
    { protocolVersion: DEFAULT_PROTOCOL_VERSION },
    fetchFn,
  ).catch(() => undefined);

  const authorizationServerUrl =
    resourceMetadata?.authorization_servers?.[0] || stripToOrigin(server.url);

  const metadata = await discoverAuthorizationServerMetadata(authorizationServerUrl, {
    fetchFn,
    protocolVersion: DEFAULT_PROTOCOL_VERSION,
  }).catch(() => undefined);

  return {
    authorizationServerUrl,
    metadata: metadata || buildFallbackMetadata(authorizationServerUrl, oauthConfig),
    resourceMetadata,
  };
}

function getResourceUrl(resourceMetadata?: OAuthProtectedResourceMetadata): URL | undefined {
  const value = resourceMetadata?.resource;
  if (!value) {
    return undefined;
  }

  try {
    return new URL(value);
  } catch {
    return undefined;
  }
}

function isTokenExpired(tokens: StoredOAuthTokens): boolean {
  if (!tokens.expires_in) {
    return false;
  }

  return tokens.obtainedAt + tokens.expires_in * 1000 - AUTH_REFRESH_SKEW_MS <= Date.now();
}

async function refreshTokens(
  server: McpServerConfig,
  state: StoredOAuthState,
): Promise<StoredOAuthTokens | null> {
  if (!state.tokens?.refresh_token || !state.clientInformation || !state.authorizationServerUrl) {
    return state.tokens || null;
  }

  const refreshed = await refreshAuthorization(state.authorizationServerUrl, {
    metadata: state.metadata,
    clientInformation: state.clientInformation,
    refreshToken: state.tokens.refresh_token,
    resource: getResourceUrl(state.resourceMetadata),
    fetchFn: createOAuthFetch(server),
  }).catch(() => null);

  if (!refreshed) {
    return null;
  }

  const nextTokens: StoredOAuthTokens = {
    ...refreshed,
    refresh_token: refreshed.refresh_token || state.tokens.refresh_token,
    obtainedAt: Date.now(),
  };

  await saveState(server.id, {
    ...state,
    tokens: nextTokens,
  });

  return nextTokens;
}

export async function getMcpOAuthHeaders(server: McpServerConfig): Promise<Record<string, string>> {
  const state = await loadState(server.id);
  if (!state.tokens) {
    return {};
  }

  const tokens = isTokenExpired(state.tokens) ? await refreshTokens(server, state) : state.tokens;

  if (!tokens?.access_token) {
    return {};
  }

  return {
    Authorization: `Bearer ${tokens.access_token}`,
  };
}

export async function hasStoredMcpOAuth(serverId: string): Promise<boolean> {
  const state = await loadState(serverId);
  return Boolean(
    state.tokens?.access_token || state.pending?.state || state.clientInformation?.client_id,
  );
}

export async function clearMcpOAuth(serverId: string): Promise<void> {
  await Promise.all([deleteMcpOAuthSecret(serverId), deleteMcpOAuthClientSecret(serverId)]);
}

export async function authenticateMcpServer(server: McpServerConfig): Promise<void> {
  const useProxy = shouldUseProxy(server);
  const projectNameForProxy = getProjectNameForProxy(server);

  const redirectUrl = useProxy
    ? getRedirectUrl(projectNameForProxy)
    : getDirectRedirectUrl(server.id);
  const returnUrl = useProxy ? getReturnUrl(server.id) : redirectUrl;

  const { authorizationServerUrl, metadata, resourceMetadata } = await discoverServerInfo(server);
  const clientInformation = await resolveClientInformation(
    server,
    metadata,
    authorizationServerUrl,
    redirectUrl,
    projectNameForProxy,
  );
  const scope =
    server.oauth?.scope ||
    clientInformation.scope ||
    resourceMetadata?.scopes_supported?.join(' ') ||
    metadata.scopes_supported?.join(' ');
  const state = randomBase64Url();
  const resource = getResourceUrl(resourceMetadata);
  const { authorizationUrl, codeVerifier } = buildAuthorizationRequest({
    metadata,
    clientInformation,
    redirectUrl,
    scope,
    state,
    resource,
  });

  await saveState(server.id, {
    authorizationServerUrl,
    metadata,
    resourceMetadata,
    clientInformation,
    pending: {
      state,
      codeVerifier,
      redirectUrl,
      returnUrl,
      projectNameForProxy,
    },
  });

  const browserUrl = useProxy
    ? getStartUrl(authorizationUrl.toString(), returnUrl, projectNameForProxy)
    : authorizationUrl.toString();
  const result = await WebBrowser.openAuthSessionAsync(browserUrl, returnUrl);
  const redirectResult = result as { type: string; url?: string };

  if (redirectResult.type !== 'success' || !redirectResult.url) {
    throw new McpOAuthError(
      'Authentication was cancelled before the server returned an authorization code.',
      'cancelled',
    );
  }

  const callbackUrl = new URL(redirectResult.url);
  if (callbackUrl.searchParams.get('state') !== state) {
    throw new McpOAuthError(
      'OAuth state validation failed. Start authentication again.',
      'auth_failed',
    );
  }

  const code = callbackUrl.searchParams.get('code');
  const oauthError = callbackUrl.searchParams.get('error');
  if (oauthError) {
    const description = callbackUrl.searchParams.get('error_description');
    throw new McpOAuthError(
      appendProxyConfigurationHint(description || oauthError, projectNameForProxy),
      'auth_failed',
    );
  }
  if (!code) {
    throw new McpOAuthError(
      'No authorization code was returned by the OAuth provider.',
      'auth_failed',
    );
  }

  const tokens = await runOAuthOperation({
    server,
    operation: 'token exchange',
    authorizationServerUrl,
    projectNameForProxy,
    execute: () =>
      exchangeAuthorization(authorizationServerUrl, {
        metadata,
        clientInformation,
        authorizationCode: code,
        codeVerifier,
        redirectUri: redirectUrl,
        resource,
        fetchFn: createOAuthFetch(server),
      }),
  });

  await saveState(server.id, {
    authorizationServerUrl,
    metadata,
    resourceMetadata,
    clientInformation,
    tokens: {
      ...tokens,
      obtainedAt: Date.now(),
    },
  });
}
