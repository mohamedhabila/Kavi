export type ToolCatalogSearchTokenInput = {
  name: string;
  category: string;
  serverName?: string;
  description?: string;
  capabilities: ReadonlyArray<string>;
  resourceKinds?: ReadonlyArray<string>;
  sideEffects?: ReadonlyArray<string>;
  riskHints?: ReadonlyArray<string>;
  providesEvidence?: ReadonlyArray<string>;
  workflowStages?: ReadonlyArray<string>;
  produces?: ReadonlyArray<unknown>;
  consumes?: ReadonlyArray<unknown>;
  precedes?: ReadonlyArray<string>;
  inputSchema?: unknown;
};

export function tokenizeStructuralIdentifiers(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9_]+/)
    .map((token) => token.trim())
    .filter(Boolean);
}

export function scoreStructuralIdentifierToken(queryToken: string, candidateToken: string): number {
  const query = queryToken.trim().toLowerCase();
  const candidate = candidateToken.trim().toLowerCase();
  if (!query || !candidate) {
    return 0;
  }
  if (query === candidate) {
    return 4;
  }
  if (query.length >= 3 && candidate.startsWith(query)) {
    return 3;
  }
  if (candidate.length >= 3 && query.startsWith(candidate)) {
    return 2;
  }
  return 0;
}

export function buildSearchTokens(entry: ToolCatalogSearchTokenInput): ReadonlySet<string> {
  const tokens = new Set<string>();
  addSearchTokens(tokens, entry.name);
  addSearchTokens(tokens, entry.category);
  addSearchTokens(tokens, entry.serverName);
  addSearchTokens(tokens, entry.description);
  for (const value of [
    entry.capabilities,
    entry.resourceKinds,
    entry.sideEffects,
    entry.riskHints,
    entry.providesEvidence,
    entry.workflowStages,
    entry.precedes,
  ]) {
    addSearchTokensFromList(tokens, value);
  }
  addSearchTokensFromUnknown(tokens, entry.produces);
  addSearchTokensFromUnknown(tokens, entry.consumes);
  addSearchTokensFromUnknown(tokens, entry.inputSchema);
  return tokens;
}

function addSearchTokens(tokens: Set<string>, value: string | undefined): void {
  if (!value) {
    return;
  }
  for (const token of tokenizeStructuralIdentifiers(value)) {
    tokens.add(token);
    for (const part of token.split('_')) {
      if (part) {
        tokens.add(part);
      }
    }
  }
}

function addSearchTokensFromList(
  tokens: Set<string>,
  values: ReadonlyArray<string> | undefined,
): void {
  for (const value of values ?? []) {
    addSearchTokens(tokens, value);
  }
}

function addSearchTokensFromUnknown(tokens: Set<string>, value: unknown, depth = 0): void {
  if (depth > 4 || value == null) {
    return;
  }
  if (typeof value === 'string') {
    addSearchTokens(tokens, value);
    return;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    addSearchTokens(tokens, String(value));
    return;
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      addSearchTokensFromUnknown(tokens, entry, depth + 1);
    }
    return;
  }
  if (typeof value === 'object') {
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      addSearchTokens(tokens, key);
      addSearchTokensFromUnknown(tokens, nested, depth + 1);
    }
  }
}
