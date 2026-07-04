export async function saveSecure(_key: string, _value: string): Promise<void> {}

export async function getSecure(key: string): Promise<string | null> {
  return process.env[key] ?? null;
}

export async function deleteSecure(_key: string): Promise<void> {}

export async function saveProviderApiKey(_providerId: string, _apiKey: string): Promise<void> {}

export async function getProviderApiKey(providerId: string): Promise<string | null> {
  return process.env[`PROVIDER_API_KEY_${providerId}`] ?? null;
}

export async function deleteProviderApiKey(_providerId: string): Promise<void> {}

export async function saveMcpToken(_serverId: string, _token: string): Promise<void> {}

export async function getMcpToken(serverId: string): Promise<string | null> {
  return process.env[`MCP_TOKEN_${serverId}`] ?? null;
}

export async function deleteMcpToken(_serverId: string): Promise<void> {}

export async function saveMcpOAuthSecret(_serverId: string, _value: string): Promise<void> {}

export async function getMcpOAuthSecret(serverId: string): Promise<string | null> {
  return process.env[`MCP_OAUTH_SECRET_${serverId}`] ?? null;
}

export async function deleteMcpOAuthSecret(_serverId: string): Promise<void> {}

export async function saveMcpOAuthClientSecret(_serverId: string, _value: string): Promise<void> {}

export async function getMcpOAuthClientSecret(serverId: string): Promise<string | null> {
  return process.env[`MCP_OAUTH_CLIENT_SECRET_${serverId}`] ?? null;
}

export async function deleteMcpOAuthClientSecret(_serverId: string): Promise<void> {}
