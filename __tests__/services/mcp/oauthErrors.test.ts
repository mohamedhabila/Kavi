import {
  InvalidClientError,
  InvalidClientMetadataError,
  InvalidGrantError,
  ServerError,
} from '@modelcontextprotocol/sdk/server/auth/errors.js';
import { McpOAuthError, runOAuthOperation } from '../../../src/services/mcp/oauthErrors';
import type { McpServerConfig } from '../../../src/types/remote';

function makeServer(overrides: Partial<McpServerConfig> = {}): McpServerConfig {
  return {
    id: 'server-1',
    name: 'Test Server',
    url: 'https://mcp.example.com/mcp',
    enabled: true,
    tools: [],
    allowedTools: [],
    ...overrides,
  } as McpServerConfig;
}

describe('oauthErrors — structured SDK OAuthError classification', () => {
  it('classifies an InvalidClientMetadataError from its errorCode, not from a parsed HTTP status', async () => {
    const error = await runOAuthOperation({
      server: makeServer(),
      operation: 'client registration',
      execute: () => {
        throw new InvalidClientMetadataError('redirect_uris must use https');
      },
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(McpOAuthError);
    expect((error as McpOAuthError).code).toBe('configuration_required');
    expect((error as McpOAuthError).message).toContain('invalid_client_metadata');
    expect((error as McpOAuthError).message).toContain('redirect_uris must use https');
    expect((error as McpOAuthError).message).toContain(
      'It may not support dynamic client registration on this endpoint.',
    );
    // No status was ever available on this path — the message must not
    // fabricate one.
    expect((error as McpOAuthError).message).not.toMatch(/\(HTTP \d{3}\)/);
  });

  it('classifies an InvalidClientError during registration as an allow-listing hint', async () => {
    const error = await runOAuthOperation({
      server: makeServer(),
      operation: 'client registration',
      execute: () => {
        throw new InvalidClientError('unknown client');
      },
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(McpOAuthError);
    expect((error as McpOAuthError).code).toBe('configuration_required');
    expect((error as McpOAuthError).message).toContain('allow-listed OAuth clients');
  });

  it('classifies an InvalidGrantError during token exchange as an auth failure', async () => {
    const error = await runOAuthOperation({
      server: makeServer(),
      operation: 'token exchange',
      execute: () => {
        throw new InvalidGrantError('authorization code expired');
      },
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(McpOAuthError);
    expect((error as McpOAuthError).code).toBe('auth_failed');
    expect((error as McpOAuthError).message).toContain('invalid_grant');
    expect((error as McpOAuthError).message).toContain('authorization code expired');
  });

  it('classifies a ServerError during token refresh without needing prose HTTP-status parsing', async () => {
    const error = await runOAuthOperation({
      server: makeServer(),
      operation: 'token refresh',
      execute: () => {
        throw new ServerError('temporarily overloaded');
      },
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(McpOAuthError);
    expect((error as McpOAuthError).code).toBe('auth_failed');
    expect((error as McpOAuthError).message).toContain('token refresh');
    expect((error as McpOAuthError).message).toContain('server_error');
  });

  it('still falls back to prose parsing for a non-conformant SDK failure', async () => {
    const error = await runOAuthOperation({
      server: makeServer(),
      operation: 'token exchange',
      execute: () => {
        throw new Error(
          'HTTP 403: Invalid OAuth error response: SyntaxError: Unexpected token. Raw body: Forbidden',
        );
      },
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(McpOAuthError);
    expect((error as McpOAuthError).code).toBe('auth_failed');
    expect((error as McpOAuthError).message).toContain('(HTTP 403)');
    expect((error as McpOAuthError).message).not.toContain('Invalid OAuth error response');
  });
});
