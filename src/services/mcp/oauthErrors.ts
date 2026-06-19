import type { McpServerConfig } from '../../types/remote';

export type OAuthOperation = 'client registration' | 'token exchange' | 'token refresh';

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

export function appendProxyConfigurationHint(
  message: string,
  projectNameForProxy: string,
): string {
  if (!projectNameForProxy.startsWith('@anonymous/')) {
    return message;
  }

  if (!/redirect[_ ]uri|redirect/i.test(message)) {
    return message;
  }

  return `${message} Set OAuth Proxy Project Name to your Expo project full name (@owner/slug) in the MCP server settings if this provider requires an allow-listed redirect URI.`;
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

export async function runOAuthOperation<T>(params: {
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
