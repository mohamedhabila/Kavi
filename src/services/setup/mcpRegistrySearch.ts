// ---------------------------------------------------------------------------
// Kavi — Finding a service's MCP server in the official registry
// ---------------------------------------------------------------------------
// The MCP Registry (registry.modelcontextprotocol.io) lists published servers. Its search
// matches names by substring and returns republished copies too, so each match carries its
// namespace: a vendor's own server sits under the vendor's domain (com.notion/…), and the
// model offers that one. Only servers reachable over the network can be used from a phone.

const REGISTRY_SEARCH_URL = 'https://registry.modelcontextprotocol.io/v0.1/servers';
const SEARCH_TIMEOUT_MS = 8_000;
const MAX_MATCHES = 8;

export type RegistryServerMatch = Readonly<{
  /** The registry name, `namespace/server`; the namespace is the publisher's. */
  name: string;
  description: string;
  url: string;
  transport: 'streamable-http' | 'sse';
  /** Headers the server says it needs (a token the person enters in the form). */
  requiredHeaders: ReadonlyArray<string>;
}>;

export type RegistrySearchResult =
  | Readonly<{ status: 'found'; matches: ReadonlyArray<RegistryServerMatch> }>
  | Readonly<{ status: 'unavailable'; reason: string }>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function remoteMatches(entry: unknown): RegistryServerMatch[] {
  const server = isRecord(entry) && isRecord(entry.server) ? entry.server : undefined;
  if (!server || typeof server.name !== 'string' || !Array.isArray(server.remotes)) return [];
  const name = server.name;
  const description = typeof server.description === 'string' ? server.description : '';
  return server.remotes.flatMap((remote) => {
    if (!isRecord(remote) || typeof remote.url !== 'string' || !remote.url.startsWith('https://')) {
      return [];
    }
    const transport =
      remote.type === 'sse'
        ? 'sse'
        : remote.type === 'streamable-http'
          ? 'streamable-http'
          : undefined;
    if (!transport) return [];
    const requiredHeaders = Array.isArray(remote.headers)
      ? remote.headers.flatMap((header) =>
          isRecord(header) && header.isRequired === true && typeof header.name === 'string'
            ? [header.name]
            : [],
        )
      : [];
    return [{ name, description, url: remote.url, transport, requiredHeaders }];
  });
}

async function queryRegistry(
  search: string,
  fetchImpl: typeof fetch,
): Promise<{ status: 'found'; servers: unknown[] } | { status: 'unavailable'; reason: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SEARCH_TIMEOUT_MS);
  try {
    const url = `${REGISTRY_SEARCH_URL}?search=${encodeURIComponent(search)}&limit=30&version=latest`;
    const response = await fetchImpl(url, { signal: controller.signal });
    if (!response.ok) {
      return { status: 'unavailable', reason: `The MCP Registry answered ${response.status}.` };
    }
    const body: unknown = await response.json();
    return {
      status: 'found',
      servers: isRecord(body) && Array.isArray(body.servers) ? body.servers : [],
    };
  } catch (error) {
    return {
      status: 'unavailable',
      reason: controller.signal.aborted
        ? 'The MCP Registry did not answer in time.'
        : `The MCP Registry could not be reached: ${error instanceof Error ? error.message : String(error)}`,
    };
  } finally {
    clearTimeout(timer);
  }
}

/** The registry's remote servers whose names match [query], newest version of each. */
export async function searchMcpRegistry(
  query: string,
  fetchImpl: typeof fetch = fetch,
): Promise<RegistrySearchResult> {
  const search = query.trim();
  if (!search) return { status: 'found', matches: [] };
  const result = await queryRegistry(search, fetchImpl);
  return result.status === 'found'
    ? { status: 'found', matches: result.servers.flatMap(remoteMatches).slice(0, MAX_MATCHES) }
    : result;
}

/**
 * Every network address the registry lists under exactly [registryName] (a vendor's own
 * entry, such as com.notion/mcp); searching by the full name returns that entry alone.
 */
export async function findRegistryServer(
  registryName: string,
  fetchImpl: typeof fetch = fetch,
): Promise<RegistrySearchResult> {
  const result = await queryRegistry(registryName, fetchImpl);
  return result.status === 'found'
    ? {
        status: 'found',
        matches: result.servers
          .flatMap(remoteMatches)
          .filter((match) => match.name === registryName),
      }
    : result;
}
