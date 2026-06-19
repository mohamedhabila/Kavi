jest.mock('expo-file-system', () => {
  const store: Record<string, string | Uint8Array> = {};
  const fileSizes: Record<string, number> = {};
  const dirs = new Set<string>();

  const normalizeUri = (value: string): string => value.replace(/\/+$/, '');

  const joinUri = (...parts: string[]): string => {
    if (parts.length === 0) {
      return '';
    }

    let result = parts[0] || '';
    for (let index = 1; index < parts.length; index += 1) {
      const part = parts[index] || '';
      result = `${normalizeUri(result)}/${part.replace(/^\/+/, '')}`;
    }
    return normalizeUri(result);
  };

  const ensureParents = (uri: string) => {
    const normalized = normalizeUri(uri);
    const pieces = normalized.split('/');
    for (let index = 3; index < pieces.length; index += 1) {
      const dirUri = pieces.slice(0, index).join('/');
      if (dirUri) {
        dirs.add(dirUri);
      }
    }
  };

  class MockFile {
    uri: string;
    name: string;

    static async downloadFileAsync(_url: string, destination: string | { uri: string }) {
      const target =
        typeof destination === 'string' ? new MockFile(destination) : new MockFile(destination.uri);
      ensureParents(target.uri);
      store[target.uri] = 'downloaded';
      return { uri: target.uri, status: 200 };
    }

    constructor(...parts: any[]) {
      const pathParts: string[] = [];
      for (const part of parts) {
        if (typeof part === 'string') {
          pathParts.push(part);
        } else if (part && typeof part.uri === 'string') {
          pathParts.push(part.uri);
        }
      }

      this.uri = joinUri(...pathParts);
      this.name = pathParts[pathParts.length - 1]?.split('/').pop() || '';
    }

    get size() {
      const explicitSize = fileSizes[this.uri];
      if (typeof explicitSize === 'number' && Number.isFinite(explicitSize) && explicitSize >= 0) {
        return explicitSize;
      }

      const value = store[this.uri];
      if (typeof value === 'string') {
        return value.length;
      }
      if (value instanceof Uint8Array) {
        return value.byteLength;
      }
      return 0;
    }

    get type() {
      const extension = this.name.split('.').pop()?.toLowerCase();
      switch (extension) {
        case 'jpg':
        case 'jpeg':
          return 'image/jpeg';
        case 'png':
          return 'image/png';
        case 'gif':
          return 'image/gif';
        case 'm4a':
        case 'mp4':
          return 'audio/mp4';
        case 'mp3':
        case 'mpeg':
        case 'mpga':
          return 'audio/mpeg';
        case 'wav':
          return 'audio/wav';
        case 'ogg':
          return 'audio/ogg';
        case 'webm':
          return 'audio/webm';
        default:
          return '';
      }
    }

    get exists() {
      return this.uri in store;
    }

    get contentUri() {
      if (!this.uri.startsWith('file://')) {
        return this.uri;
      }
      return `content://mock-provider${this.uri.slice('file://'.length)}`;
    }

    async text() {
      const value = store[this.uri];
      if (value instanceof Uint8Array) {
        throw new Error('Binary file');
      }
      return value || '';
    }

    write(content: string | Uint8Array) {
      ensureParents(this.uri);
      store[this.uri] = typeof content === 'string' ? content : new Uint8Array(content);
      fileSizes[this.uri] = typeof content === 'string' ? content.length : content.byteLength;
    }

    copy(destination: { uri: string; name?: string }) {
      const value = store[this.uri];
      if (value === undefined) {
        throw new Error(`File does not exist: ${this.uri}`);
      }

      const targetUri = normalizeUri(destination.uri);
      ensureParents(targetUri);
      store[targetUri] = typeof value === 'string' ? value : new Uint8Array(value);
      fileSizes[targetUri] =
        typeof fileSizes[this.uri] === 'number'
          ? fileSizes[this.uri]
          : typeof value === 'string'
            ? value.length
            : value.byteLength;
    }

    move(destination: { uri: string; name?: string }) {
      this.copy(destination);
      delete store[this.uri];
      this.uri = normalizeUri(destination.uri);
      this.name = destination.name || this.uri.split('/').pop() || this.name;
    }

    delete() {
      delete store[this.uri];
      delete fileSizes[this.uri];
    }
  }

  class MockDirectory {
    uri: string;
    name: string;

    constructor(...parts: any[]) {
      const pathParts: string[] = [];
      for (const part of parts) {
        if (typeof part === 'string') {
          pathParts.push(part);
        } else if (part && typeof part.uri === 'string') {
          pathParts.push(part.uri);
        }
      }

      this.uri = joinUri(...pathParts);
      this.name = pathParts[pathParts.length - 1]?.split('/').pop() || '';
    }

    get exists() {
      return dirs.has(this.uri);
    }

    create(_options?: { idempotent?: boolean; intermediates?: boolean }) {
      ensureParents(this.uri);
      dirs.add(this.uri);
    }

    list() {
      const prefix = `${this.uri}/`;
      const entries = new Map<string, MockFile | MockDirectory>();

      for (const dir of dirs) {
        if (!dir.startsWith(prefix)) {
          continue;
        }

        const rest = dir.slice(prefix.length);
        if (!rest || rest.includes('/')) {
          continue;
        }

        entries.set(rest, new MockDirectory(this, rest));
      }

      for (const fileUri of Object.keys(store)) {
        if (!fileUri.startsWith(prefix)) {
          continue;
        }

        const rest = fileUri.slice(prefix.length);
        if (!rest) {
          continue;
        }

        const firstPart = rest.split('/')[0];
        if (rest.includes('/')) {
          entries.set(firstPart, new MockDirectory(this, firstPart));
        } else {
          entries.set(firstPart, new MockFile(this, firstPart));
        }
      }

      return Array.from(entries.values());
    }

    delete() {
      dirs.delete(this.uri);
      for (const dir of Array.from(dirs)) {
        if (dir.startsWith(`${this.uri}/`)) {
          dirs.delete(dir);
        }
      }
      for (const fileUri of Object.keys(store)) {
        if (fileUri.startsWith(`${this.uri}/`)) {
          delete store[fileUri];
        }
      }
    }
  }

  const documentRoot = 'file:///mock/documents';
  const cacheRoot = 'file:///mock/cache';
  dirs.add(documentRoot);
  dirs.add(cacheRoot);

  return {
    File: MockFile,
    Directory: MockDirectory,
    Paths: {
      get document() {
        return new MockDirectory(documentRoot);
      },
      get cache() {
        return new MockDirectory(cacheRoot);
      },
    },
    documentDirectory: `${documentRoot}/`,
    getInfoAsync: jest.fn().mockImplementation(async (uri: string) => {
      const normalized = normalizeUri(uri);
      const value = store[normalized];
      const size =
        typeof value === 'string'
          ? value.length
          : value instanceof Uint8Array
            ? value.byteLength
            : 0;
      return {
        exists: normalized in store || dirs.has(normalized),
        isDirectory: dirs.has(normalized),
        size,
      };
    }),
    makeDirectoryAsync: jest.fn().mockImplementation(async (uri: string) => {
      const normalized = normalizeUri(uri);
      ensureParents(normalized);
      dirs.add(normalized);
    }),
    readAsStringAsync: jest.fn().mockImplementation(async (uri: string) => {
      const value = store[normalizeUri(uri)];
      if (value instanceof Uint8Array) {
        throw new Error('Binary file');
      }
      return value || '';
    }),
    writeAsStringAsync: jest.fn().mockImplementation(async (uri: string, content: string) => {
      const normalized = normalizeUri(uri);
      ensureParents(normalized);
      store[normalized] = content;
    }),
    readDirectoryAsync: jest.fn().mockImplementation(async (uri: string) => {
      const normalized = normalizeUri(uri);
      return new MockDirectory(normalized).list().map((entry) => entry.name);
    }),
    deleteAsync: jest.fn().mockImplementation(async (uri: string) => {
      const normalized = normalizeUri(uri);
      new MockDirectory(normalized).delete();
      delete store[normalized];
    }),
    __resetStore: () => {
      for (const key of Object.keys(store)) {
        delete store[key];
      }
      for (const key of Object.keys(fileSizes)) {
        delete fileSizes[key];
      }
      dirs.clear();
      dirs.add(documentRoot);
      dirs.add(cacheRoot);
    },
    __getStore: () => store,
    __getDirs: () => dirs,
    __setFileSize: (uri: string, size: number) => {
      fileSizes[normalizeUri(uri)] = size;
    },
  };
});

jest.mock('expo-file-system/legacy', () => {
  const expoFileSystem = jest.requireMock('expo-file-system') as {
    File: new (uri: string) => { write: (content: string) => void };
    __setFileSize?: (uri: string, size: number) => void;
  };
  const localLlmCatalog = jest.requireActual('../../src/services/localLlm/catalog') as {
    LOCAL_LLM_MODEL_CATALOG: Array<{
      repositoryId: string;
      fileName: string;
      sizeBytes: number;
    }>;
  };

  type MockDownloadBehavior = {
    error?: Error | string;
    status?: number;
    totalBytesExpectedToWrite?: number;
    progressEvents?: number[];
    partialBytesBeforeError?: number;
    writeContent?: string | Uint8Array;
    writeSize?: number;
    headers?: Record<string, string>;
  };

  const queuedDownloadBehaviors: MockDownloadBehavior[] = [];

  const inferDownloadSize = (url: string): number => {
    const exactFileMatch = localLlmCatalog.LOCAL_LLM_MODEL_CATALOG.find((entry) =>
      url.includes(entry.fileName),
    );
    if (exactFileMatch) {
      return exactFileMatch.sizeBytes;
    }

    const repositoryMatch = localLlmCatalog.LOCAL_LLM_MODEL_CATALOG.find((entry) =>
      url.includes(entry.repositoryId),
    );
    return repositoryMatch?.sizeBytes ?? 1024;
  };

  const runDownload = async (params: {
    url: string;
    fileUri: string;
    callback?: (progress: { totalBytesWritten: number; totalBytesExpectedToWrite: number }) => void;
    resumeData?: string | null;
    method: 'download' | 'resume';
  }) => {
    const behavior = queuedDownloadBehaviors.shift() || {};
    const totalBytesExpectedToWrite =
      behavior.totalBytesExpectedToWrite ?? inferDownloadSize(params.url);
    const progressEvents =
      behavior.progressEvents ||
      (behavior.error
        ? [
            behavior.partialBytesBeforeError ??
              Math.max(1, Math.floor(totalBytesExpectedToWrite / 2)),
          ]
        : params.method === 'resume'
          ? [totalBytesExpectedToWrite]
          : [Math.max(1, Math.floor(totalBytesExpectedToWrite / 2)), totalBytesExpectedToWrite]);

    for (const bytesWritten of progressEvents) {
      params.callback?.({ totalBytesWritten: bytesWritten, totalBytesExpectedToWrite });
    }

    if (behavior.error) {
      const partialBytes =
        behavior.partialBytesBeforeError ?? progressEvents[progressEvents.length - 1] ?? 0;
      if (partialBytes > 0) {
        new expoFileSystem.File(params.fileUri).write('partial');
        expoFileSystem.__setFileSize?.(params.fileUri, partialBytes);
      }
      throw behavior.error instanceof Error ? behavior.error : new Error(String(behavior.error));
    }

    const writtenContent = behavior.writeContent ?? 'downloaded';
    const writtenSize = behavior.writeSize ?? totalBytesExpectedToWrite;
    new expoFileSystem.File(params.fileUri).write(writtenContent as any);
    expoFileSystem.__setFileSize?.(params.fileUri, writtenSize);
    return {
      uri: params.fileUri,
      status: behavior.status ?? (params.method === 'resume' && params.resumeData ? 206 : 200),
      headers: behavior.headers ?? {},
    };
  };

  const createDownloadResult = (
    url: string,
    fileUri: string,
    options: Record<string, unknown> | undefined,
    callback?: (progress: { totalBytesWritten: number; totalBytesExpectedToWrite: number }) => void,
    resumeData?: string | null,
  ) => ({
    downloadAsync: jest.fn().mockImplementation(async () =>
      runDownload({
        url,
        fileUri,
        callback,
        resumeData,
        method: 'download',
      }),
    ),
    cancelAsync: jest.fn().mockResolvedValue(undefined),
    pauseAsync: jest
      .fn()
      .mockResolvedValue({ url, fileUri, options, resumeData: resumeData ?? null }),
    resumeAsync: jest.fn().mockImplementation(async () =>
      runDownload({
        url,
        fileUri,
        callback,
        resumeData,
        method: 'resume',
      }),
    ),
    savable: jest.fn().mockReturnValue({ url, fileUri, options, resumeData: resumeData ?? null }),
  });

  return {
    writeAsStringAsync: jest.fn().mockResolvedValue(undefined),
    readAsStringAsync: jest.fn().mockResolvedValue(''),
    getInfoAsync: jest.fn().mockResolvedValue({ exists: false, isDirectory: false }),
    createDownloadResumable: jest
      .fn()
      .mockImplementation(
        (
          url: string,
          fileUri: string,
          options?: Record<string, unknown>,
          callback?: (progress: {
            totalBytesWritten: number;
            totalBytesExpectedToWrite: number;
          }) => void,
          resumeData?: string | null,
        ) => createDownloadResult(url, fileUri, options, callback, resumeData),
      ),
    __queueDownloadBehavior: (behavior: MockDownloadBehavior) => {
      queuedDownloadBehaviors.push(behavior);
    },
    __resetDownloadBehaviors: () => {
      queuedDownloadBehaviors.length = 0;
    },
    EncodingType: { UTF8: 'utf8', Base64: 'base64' },
  };
});
