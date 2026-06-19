import { parseJsonOrSsePayload } from './transportFraming';

export class McpTransportError extends Error {
  statusCode?: number;
  shouldFallbackToSse: boolean;
  requiresAuthentication: boolean;

  constructor(
    message: string,
    options: {
      statusCode?: number;
      shouldFallbackToSse?: boolean;
      requiresAuthentication?: boolean;
    } = {},
  ) {
    super(message);
    this.name = 'McpTransportError';
    this.statusCode = options.statusCode;
    this.shouldFallbackToSse = options.shouldFallbackToSse ?? false;
    this.requiresAuthentication = options.requiresAuthentication ?? false;
  }
}

export function hasConfiguredMcpAuth(headers: Record<string, string> | undefined): boolean {
  return Object.keys(headers || {}).some((key) => /authorization|api[-_]key|token|cookie/i.test(key));
}

function extractServerErrorMessage(bodyText: string): string | null {
  const trimmed = bodyText.trim();
  if (!trimmed) {
    return null;
  }

  const parsed = parseJsonOrSsePayload(trimmed);
  if (!parsed) {
    return trimmed;
  }

  if (typeof parsed === 'object' && parsed !== null) {
    const errorMessage = (parsed as { error?: { message?: unknown } }).error?.message;
    if (typeof errorMessage === 'string' && errorMessage.trim()) {
      return errorMessage.trim();
    }

    const message = (parsed as { message?: unknown }).message;
    if (typeof message === 'string' && message.trim()) {
      return message.trim();
    }

    const error = (parsed as { error?: unknown }).error;
    if (typeof error === 'string' && error.trim()) {
      return error.trim();
    }
  }

  return trimmed;
}

export async function createMcpHttpError(
  prefix: string,
  response: Response,
  options: { hasConfiguredAuth: boolean },
): Promise<McpTransportError> {
  const bodyText = await response.text().catch(() => response.statusText);
  const serverMessage = extractServerErrorMessage(bodyText);

  if (response.status === 401) {
    return new McpTransportError(
      options.hasConfiguredAuth
        ? 'MCP authentication failed. Check the configured token or custom auth headers.'
        : 'MCP authentication required. Edit this server to add a token or custom auth headers.',
      { statusCode: 401, requiresAuthentication: true },
    );
  }

  if (response.status === 403) {
    return new McpTransportError(
      'MCP access forbidden. Check the configured scopes, token, or custom auth headers.',
      { statusCode: 403, requiresAuthentication: true },
    );
  }

  const suffix = serverMessage ? ` - ${serverMessage}` : '';
  return new McpTransportError(`${prefix}: HTTP ${response.status}${suffix}`, {
    statusCode: response.status,
    shouldFallbackToSse: response.status === 404 || response.status === 405,
  });
}

export function shouldFallbackToLegacySse(error: unknown): boolean {
  if (error instanceof McpTransportError) {
    return error.shouldFallbackToSse;
  }

  return true;
}

export function formatTransportError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}
