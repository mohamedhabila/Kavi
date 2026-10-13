// ---------------------------------------------------------------------------
// Kavi — E2E sandbox workspace (Jest expo-file-system mock)
// ---------------------------------------------------------------------------

type ExpoFileSystemMock = {
  __resetStore?: () => void;
  __getStore?: () => Record<string, string | Uint8Array>;
  File: new (uri: string) => { write: (content: string) => void };
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

export function assertE2EWorkspaceSandboxReset(): void {
  const remainingPaths = Object.keys(getWorkspaceStore());
  if (remainingPaths.length > 0) {
    throw new Error(
      `E2E workspace reset left ${remainingPaths.length} persisted entr${remainingPaths.length === 1 ? 'y' : 'ies'}.`,
    );
  }
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

/**
 * Writes through the file API, so the file's folders exist the way they would on a device:
 * a store entry with no parent directory was invisible to every tool that walks the
 * workspace, such as the JavaScript tool's file bridge.
 */
export function writeWorkspaceRelativeFile(
  conversationId: string,
  relativePath: string,
  content: string,
): void {
  const { File } = getExpoFileSystemMock();
  new File(buildWorkspaceUri(conversationId, relativePath)).write(content);
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
