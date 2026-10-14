// ---------------------------------------------------------------------------
// Kavi — which Anthropic workspace a key's requests run in
// ---------------------------------------------------------------------------
// Every Claude API request runs in one workspace. A key bound to one workspace always runs
// there; a personal or service-account key that may act in several must name one on every
// request with the anthropic-workspace-id header, or the API refuses the request. Only the
// latter kind can list the organization's workspaces, so that listing tells the two apart.
// Such a key keeps the workspace it was given while that workspace still exists, and
// otherwise runs in the organization's Default workspace, the one the listing includes only
// when asked to (include_default).
// https://platform.claude.com/docs/en/manage-claude/workspaces
// ---------------------------------------------------------------------------

export const ANTHROPIC_WORKSPACE_HEADER = 'anthropic-workspace-id';

const WORKSPACE_LIST_LIMIT = 100;
const WORKSPACE_LIST_TIMEOUT_MS = 10_000;

async function listWorkspaceIds(args: {
  baseUrl: string;
  headers: Record<string, string>;
  includeDefault: boolean;
  createTimeoutSignal: (ms: number) => AbortSignal;
  performFetch: (url: string, init: RequestInit) => Promise<Response>;
}): Promise<string[] | null> {
  const url = new URL(`${args.baseUrl.replace(/\/+$/, '')}/organizations/workspaces`);
  url.searchParams.set('limit', String(WORKSPACE_LIST_LIMIT));
  if (args.includeDefault) url.searchParams.set('include_default', 'true');
  const response = await args.performFetch(url.toString(), {
    method: 'GET',
    headers: args.headers,
    signal: args.createTimeoutSignal(WORKSPACE_LIST_TIMEOUT_MS),
  });
  if (!response.ok) return null;
  const json = (await response.json()) as { data?: unknown };
  return Array.isArray(json?.data)
    ? json.data
        .map((workspace) => (workspace as { id?: unknown } | null)?.id)
        .filter((id): id is string => typeof id === 'string' && id.length > 0)
    : [];
}

/**
 * The workspace the key's requests must name: an id for a key that may act in several,
 * `null` for a key bound to one (nothing to name), `undefined` when it could not be told
 * (the network failed), so a workspace found earlier is kept.
 */
export async function resolveAnthropicWorkspaceId(args: {
  baseUrl: string;
  /** The key's headers, without a workspace header. */
  headers: Record<string, string>;
  currentWorkspaceId?: string;
  createTimeoutSignal: (ms: number) => AbortSignal;
  performFetch: (url: string, init: RequestInit) => Promise<Response>;
}): Promise<string | null | undefined> {
  try {
    const all = await listWorkspaceIds({ ...args, includeDefault: true });
    if (all === null || all.length === 0) return null;
    if (args.currentWorkspaceId && all.includes(args.currentWorkspaceId)) {
      return args.currentWorkspaceId;
    }
    const named = new Set((await listWorkspaceIds({ ...args, includeDefault: false })) ?? []);
    return all.find((id) => !named.has(id)) ?? all[0]!;
  } catch {
    return undefined;
  }
}
