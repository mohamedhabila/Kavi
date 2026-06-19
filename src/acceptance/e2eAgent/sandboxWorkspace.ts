// ---------------------------------------------------------------------------
// Kavi — E2E sandbox workspace (Jest expo-file-system mock)
// ---------------------------------------------------------------------------

type ExpoFileSystemMock = {
  __resetStore?: () => void;
  __getStore?: () => Record<string, string | Uint8Array>;
};

type WorkspaceSeedFile = {
  path: string;
  content: string;
};

function getExpoFileSystemMock(): ExpoFileSystemMock {
  return jest.requireMock('expo-file-system') as ExpoFileSystemMock;
}

export function resetE2EWorkspaceSandbox(): void {
  getExpoFileSystemMock().__resetStore?.();
}

function getWorkspaceStore(): Record<string, string | Uint8Array> {
  return getExpoFileSystemMock().__getStore?.() ?? {};
}

function decodeStoreValue(value: string | Uint8Array | undefined): string {
  if (typeof value === 'string') {
    return value;
  }
  if (value instanceof Uint8Array) {
    return new TextDecoder().decode(value);
  }
  return '';
}

export function buildWorkspaceUri(conversationId: string, relativePath: string): string {
  const normalizedPath = relativePath.replace(/^\/+/, '');
  return `file:///mock/documents/workspace/${conversationId}/${normalizedPath}`;
}

export function readWorkspaceRelativeFile(
  conversationId: string,
  relativePath: string,
): string | undefined {
  const uri = buildWorkspaceUri(conversationId, relativePath);
  const store = getWorkspaceStore();
  if (!(uri in store)) {
    return undefined;
  }
  return decodeStoreValue(store[uri]);
}

export function writeWorkspaceRelativeFile(
  conversationId: string,
  relativePath: string,
  content: string,
): void {
  getWorkspaceStore()[buildWorkspaceUri(conversationId, relativePath)] = content;
}

export function seedE2EWorkspaceSandbox(
  conversationId: string,
  files: ReadonlyArray<WorkspaceSeedFile>,
): void {
  for (const file of files) {
    writeWorkspaceRelativeFile(conversationId, file.path, file.content);
  }
}

export function listWorkspaceRelativePaths(conversationId: string): string[] {
  const prefix = `file:///mock/documents/workspace/${conversationId}/`;
  const store = getWorkspaceStore();
  const paths = new Set<string>();

  for (const uri of Object.keys(store)) {
    if (!uri.startsWith(prefix)) {
      continue;
    }
    const relative = uri.slice(prefix.length);
    if (relative) {
      paths.add(relative);
    }
  }

  return Array.from(paths).sort();
}

export function workspaceFileExists(conversationId: string, relativePath: string): boolean {
  return readWorkspaceRelativeFile(conversationId, relativePath) !== undefined;
}
