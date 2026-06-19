// ---------------------------------------------------------------------------
// Kavi — Official MCP Registry Client
// ---------------------------------------------------------------------------
// Browses the official MCP Registry and maps remote-installable entries into a
// mobile-friendly shape that can be turned into McpServerConfig records.

import type {
  McpAuthMode,
  McpCapabilityMetadata,
  McpServerConfig,
  McpTrustMetadata,
} from '../../types/remote';
import { generateId } from '../../utils/id';
import { isSseTransportAvailable } from './transport';

const MCP_REGISTRY_BASE_URL = 'https://registry.modelcontextprotocol.io/v0.1';
const REQUEST_TIMEOUT = 15000;

type RegistryStatusMeta = {
  status?: string;
  isLatest?: boolean;
};

type RegistryHeaderSpec = {
  name?: string;
  description?: string;
  default?: string;
  choices?: string[];
  isRequired?: boolean;
  isSecret?: boolean;
  is_required?: boolean;
  is_secret?: boolean;
};

type RegistryVariableSpec = {
  description?: string;
  default?: string;
  choices?: string[];
  isRequired?: boolean;
  isSecret?: boolean;
  is_required?: boolean;
  is_secret?: boolean;
};

type RegistryRemote = {
  type?: 'streamable-http' | 'sse' | string;
  url?: string;
  headers?: RegistryHeaderSpec[];
  variables?: Record<string, RegistryVariableSpec>;
};

type RegistryServer = {
  name?: string;
  title?: string;
  description?: string;
  version?: string;
  websiteUrl?: string;
  website_url?: string;
  remotes?: RegistryRemote[];
};

type RegistryEnvelope = {
  server?: RegistryServer;
  _meta?: {
    'io.modelcontextprotocol.registry/official'?: RegistryStatusMeta;
  };
};

type RegistryListPayload = {
  servers?: RegistryEnvelope[];
  metadata?: {
    nextCursor?: string | null;
  };
};

export interface McpHubInputSpec {
  key: string;
  label: string;
  kind: 'header' | 'variable';
  description?: string;
  required: boolean;
  secret: boolean;
  defaultValue?: string;
  choices?: string[];
}

export interface McpHubRemoteEntry {
  id: string;
  type: 'streamable-http' | 'sse';
  url: string;
  label: string;
  headers: McpHubInputSpec[];
  variables: McpHubInputSpec[];
}

export interface McpHubEntry {
  id: string;
  name: string;
  registryName: string;
  description: string;
  version: string;
  websiteUrl?: string;
  remotes: McpHubRemoteEntry[];
  trust: McpTrustMetadata;
  capabilities: {
    transports: Array<'streamable-http' | 'sse'>;
    authMode: McpAuthMode;
    requiresConfiguration: boolean;
    requiresSecrets: boolean;
    inputCount: number;
  };
}

export interface McpRegistryBrowseResult {
  entries: McpHubEntry[];
  nextCursor: string | null;
}

export interface McpInstallDraft {
  config: McpServerConfig;
  resolvedUrl: string;
}

function getRemoteAuthMode(remote: Pick<McpHubRemoteEntry, 'headers' | 'variables'>): McpAuthMode {
  const hasHeaders = remote.headers.length > 0;
  const hasVariables = remote.variables.length > 0;

  if (hasHeaders && hasVariables) return 'mixed';
  if (hasHeaders) return 'header';
  if (hasVariables) return 'variable';
  return 'none';
}

function summarizeRemoteCapabilities(remote: McpHubRemoteEntry): McpCapabilityMetadata {
  const inputs = getRemoteInputs(remote);
  const authMode = getRemoteAuthMode(remote);

  return {
    transport: remote.type,
    authMode,
    requiresConfiguration: inputs.length > 0,
    requiresSecrets: inputs.some((input) => input.secret),
    inputCount: inputs.length,
  };
}

function summarizeEntryCapabilities(remotes: McpHubRemoteEntry[]): McpHubEntry['capabilities'] {
  const transports = Array.from(new Set(remotes.map((remote) => remote.type)));
  const inputCount = remotes.reduce((count, remote) => count + getRemoteInputs(remote).length, 0);
  const requiresConfiguration = remotes.some((remote) => getRemoteInputs(remote).length > 0);
  const requiresSecrets = remotes.some((remote) =>
    getRemoteInputs(remote).some((input) => input.secret),
  );
  const authModes = Array.from(
    new Set(remotes.map((remote) => getRemoteAuthMode(remote)).filter((mode) => mode !== 'none')),
  );

  return {
    transports,
    authMode: authModes.length === 0 ? 'none' : authModes.length === 1 ? authModes[0] : 'mixed',
    requiresConfiguration,
    requiresSecrets,
    inputCount,
  };
}

function isRequiredFlag(
  value: { isRequired?: boolean; is_required?: boolean } | undefined,
): boolean {
  return Boolean(value?.isRequired ?? value?.is_required);
}

function isSecretFlag(value: { isSecret?: boolean; is_secret?: boolean } | undefined): boolean {
  return Boolean(value?.isSecret ?? value?.is_secret);
}

function labelFromRegistryName(name: string): string {
  const slashIndex = name.lastIndexOf('/');
  return slashIndex >= 0 ? name.slice(slashIndex + 1) : name;
}

function labelRemote(remote: RegistryRemote, url: string, index: number): string {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname.replace(/\/$/, '');
    const lastSegment = path.split('/').filter(Boolean).pop();
    const suffix = lastSegment ? ` ${lastSegment}` : ` ${index + 1}`;
    return `${remote.type === 'sse' ? 'SSE' : 'HTTP'}${suffix}`;
  } catch {
    return `${remote.type === 'sse' ? 'SSE' : 'HTTP'} ${index + 1}`;
  }
}

function isSupportedRemoteTransport(
  type: RegistryRemote['type'],
): type is 'streamable-http' | 'sse' {
  if (type === 'streamable-http') {
    return true;
  }

  if (type === 'sse') {
    return isSseTransportAvailable();
  }

  return false;
}

function mapRemoteInputs(remote: RegistryRemote): Pick<McpHubRemoteEntry, 'headers' | 'variables'> {
  const headers = (remote.headers || [])
    .filter(
      (header): header is RegistryHeaderSpec & { name: string } =>
        typeof header.name === 'string' && !!header.name,
    )
    .map((header) => ({
      key: header.name,
      label: header.name,
      kind: 'header' as const,
      description: header.description,
      required: isRequiredFlag(header),
      secret: isSecretFlag(header),
      defaultValue: header.default,
      choices: header.choices,
    }));

  const variables = Object.entries(remote.variables || {}).map(([name, spec]) => ({
    key: name,
    label: name,
    kind: 'variable' as const,
    description: spec.description,
    required: isRequiredFlag(spec),
    secret: isSecretFlag(spec),
    defaultValue: spec.default,
    choices: spec.choices,
  }));

  return { headers, variables };
}

function mapRegistryEntry(envelope: RegistryEnvelope): McpHubEntry | null {
  const meta = envelope._meta?.['io.modelcontextprotocol.registry/official'];
  if (meta?.status && meta.status !== 'active') return null;
  if (meta?.isLatest === false) return null;

  const server = envelope.server;
  if (!server?.name) return null;

  const remotes = (server.remotes || [])
    .filter(
      (remote): remote is RegistryRemote & { type: 'streamable-http' | 'sse'; url: string } => {
        return (
          isSupportedRemoteTransport(remote.type) && typeof remote.url === 'string' && !!remote.url
        );
      },
    )
    .map((remote, index) => {
      const inputs = mapRemoteInputs(remote);
      return {
        id: `${server.name}:${remote.type}:${index}`,
        type: remote.type,
        url: remote.url,
        label: labelRemote(remote, remote.url, index),
        headers: inputs.headers,
        variables: inputs.variables,
      };
    });

  if (remotes.length === 0) return null;

  return {
    id: `${server.name}@${server.version || '0.0.0'}`,
    name: server.title || labelFromRegistryName(server.name),
    registryName: server.name,
    description: server.description || '',
    version: server.version || '0.0.0',
    websiteUrl: server.websiteUrl || server.website_url,
    remotes,
    trust: {
      source: 'official-registry',
      registryName: server.name,
      websiteUrl: server.websiteUrl || server.website_url,
    },
    capabilities: summarizeEntryCapabilities(remotes),
  };
}

async function registryFetch(path: string): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

  try {
    return await fetch(`${MCP_REGISTRY_BASE_URL}${path}`, {
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        'User-Agent': 'Kavi/1.0',
      },
    });
  } finally {
    clearTimeout(timeout);
  }
}

export async function listOfficialMcpRegistry(
  options: { limit?: number; cursor?: string | null; search?: string } = {},
): Promise<McpRegistryBrowseResult> {
  const { limit = 20, cursor = null, search } = options;
  const entries: McpHubEntry[] = [];
  let nextCursor = cursor;
  let attempts = 0;

  while (entries.length < limit && attempts < 5) {
    const params = new URLSearchParams({ limit: String(limit) });
    if (nextCursor) {
      params.set('cursor', nextCursor);
    }
    if (search?.trim()) {
      params.set('search', search.trim());
    }

    let payload: RegistryListPayload | null = null;
    try {
      const res = await registryFetch(`/servers?${params.toString()}`);
      if (!res.ok) {
        return { entries: [], nextCursor: null };
      }
      payload = (await res.json()) as RegistryListPayload;
    } catch {
      return { entries: [], nextCursor: null };
    }

    const mapped = (payload.servers || [])
      .map(mapRegistryEntry)
      .filter((entry): entry is McpHubEntry => Boolean(entry));

    for (const entry of mapped) {
      if (entries.some((current) => current.id === entry.id)) continue;
      entries.push(entry);
      if (entries.length >= limit) break;
    }

    attempts += 1;
    nextCursor = payload.metadata?.nextCursor || null;
    if (!nextCursor || (payload.servers || []).length === 0 || search?.trim()) {
      break;
    }
  }

  return {
    entries: entries.slice(0, limit),
    nextCursor,
  };
}

export function buildMcpInstallDraft(
  entry: McpHubEntry,
  remote: McpHubRemoteEntry,
  values: Record<string, string>,
): McpInstallDraft {
  if (remote.type === 'sse' && !isSseTransportAvailable()) {
    throw new Error(
      'SSE transport is not available in this runtime. Choose an HTTP remote instead.',
    );
  }

  const resolvedVariables = Object.fromEntries(
    remote.variables.map((variable) => [
      variable.key,
      (values[variable.key] ?? variable.defaultValue ?? '').trim(),
    ]),
  );

  const resolvedUrl = remote.url.replace(/\{([^}]+)\}/g, (_, key: string) => {
    const value = resolvedVariables[key] ?? '';
    return encodeURIComponent(value);
  });

  const headers: Record<string, string> = {};
  for (const header of remote.headers) {
    const value = (values[header.key] ?? header.defaultValue ?? '').trim();
    if (header.required && !value) {
      throw new Error(`Missing required header: ${header.label}`);
    }
    if (value) {
      headers[header.key] = value;
    }
  }

  for (const variable of remote.variables) {
    const value = resolvedVariables[variable.key] ?? '';
    if (variable.required && !value) {
      throw new Error(`Missing required value: ${variable.label}`);
    }
  }

  const hasHeaders = Object.keys(headers).length > 0;
  const capabilities = summarizeRemoteCapabilities(remote);
  const config: McpServerConfig = {
    id: generateId(),
    name: entry.remotes.length > 1 ? `${entry.name} (${remote.label})` : entry.name,
    url: resolvedUrl,
    headers: hasHeaders ? headers : undefined,
    transport: remote.type,
    sseUrl: remote.type === 'sse' ? resolvedUrl : undefined,
    timeoutMs: 20000,
    enabled: true,
    tools: [],
    allowedTools: [],
    trust: entry.trust,
    capabilities,
  };

  return { config, resolvedUrl };
}

export function getRemoteInputs(remote: McpHubRemoteEntry): McpHubInputSpec[] {
  return [...remote.variables, ...remote.headers];
}
