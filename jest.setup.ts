// ---------------------------------------------------------------------------
// Kavi — Jest Setup
// ---------------------------------------------------------------------------

// Note: jest-native/extend-expect requires `expect` to be available,
// which is only provided after the test framework loads. Using setupFiles
// is too early — we only include mocks here. Matchers will be available
// via @testing-library/react-native's built-in jest-dom integration.

// Mock expo modules
jest.mock('expo-secure-store', () => ({
  setItemAsync: jest.fn().mockResolvedValue(undefined),
  getItemAsync: jest.fn().mockResolvedValue(null),
  deleteItemAsync: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('expo-crypto', () => {
  const { createHash } = require('crypto');
  return {
    CryptoDigestAlgorithm: {
      SHA256: 'SHA-256',
    },
    digestStringAsync: jest.fn(async (algorithm: string, value: string) => {
      if (algorithm !== 'SHA-256') {
        throw new Error(`Unsupported digest algorithm: ${algorithm}`);
      }
      return createHash('sha256').update(value).digest('hex');
    }),
  };
});

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
  const localLlmCatalog = jest.requireActual('./src/services/localLlm/catalog') as {
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

jest.mock('expo-clipboard', () => ({
  setStringAsync: jest.fn().mockResolvedValue(true),
  getStringAsync: jest.fn().mockResolvedValue(''),
}));

jest.mock('expo/fetch', () => ({
  fetch: (input: RequestInfo | URL, init?: RequestInit) => global.fetch(input, init),
}));

jest.mock('expo-web-browser', () => ({
  openAuthSessionAsync: jest.fn().mockResolvedValue({ type: 'cancel' }),
}));

jest.mock('react-native-view-shot', () => ({
  captureRef: jest.fn().mockResolvedValue('QUFBQQ=='),
  releaseCapture: jest.fn(),
}));

jest.mock('@modelcontextprotocol/sdk/client/auth.js', () => ({
  discoverAuthorizationServerMetadata: jest.fn(),
  discoverOAuthProtectedResourceMetadata: jest.fn(),
  exchangeAuthorization: jest.fn(),
  refreshAuthorization: jest.fn(),
  registerClient: jest.fn(),
  startAuthorization: jest.fn(),
}));

jest.mock('expo-notifications', () => ({
  setNotificationHandler: jest.fn(),
  getPermissionsAsync: jest.fn().mockResolvedValue({ granted: true, status: 'granted' }),
  requestPermissionsAsync: jest.fn().mockResolvedValue({ granted: true, status: 'granted' }),
  scheduleNotificationAsync: jest.fn().mockResolvedValue('notification-id'),
  cancelScheduledNotificationAsync: jest.fn().mockResolvedValue(undefined),
  setNotificationChannelAsync: jest.fn().mockResolvedValue(undefined),
  addNotificationResponseReceivedListener: jest.fn().mockReturnValue({ remove: jest.fn() }),
  getLastNotificationResponseAsync: jest.fn().mockResolvedValue(null),
  clearLastNotificationResponseAsync: jest.fn().mockResolvedValue(undefined),
  DEFAULT_ACTION_IDENTIFIER: 'expo.notifications.actions.DEFAULT',
  AndroidImportance: { DEFAULT: 3 },
  AndroidNotificationVisibility: { PUBLIC: 1 },
  SchedulableTriggerInputTypes: { TIME_INTERVAL: 'timeInterval' },
}));

jest.mock('expo-image-picker', () => ({
  launchImageLibraryAsync: jest.fn().mockResolvedValue({ canceled: true, assets: [] }),
  MediaTypeOptions: { Images: 'Images' },
}));

jest.mock('expo-document-picker', () => ({
  getDocumentAsync: jest.fn().mockResolvedValue({ canceled: true, assets: [] }),
}));

jest.mock('expo-audio', () => {
  const mockPlayer = {
    play: jest.fn(),
    pause: jest.fn(),
    seekTo: jest.fn(),
    remove: jest.fn(),
  };

  const defaultStatus = {
    currentTime: 0,
    didJustFinish: false,
    duration: 0,
    isBuffering: false,
    isLoaded: true,
    playing: false,
  };

  let currentStatus = { ...defaultStatus };

  return {
    useAudioPlayer: jest.fn(() => mockPlayer),
    useAudioPlayerStatus: jest.fn(() => currentStatus),
    createAudioPlayer: jest.fn(() => ({
      ...mockPlayer,
      addListener: jest.fn(),
    })),
    AudioModule: {
      AudioRecorder: jest.fn().mockImplementation(() => ({
        prepareToRecordAsync: jest.fn().mockResolvedValue(undefined),
        record: jest.fn(),
        stop: jest.fn().mockResolvedValue(undefined),
        getStatus: jest.fn().mockReturnValue({
          canRecord: true,
          isRecording: true,
          durationMillis: 0,
          mediaServicesDidReset: false,
          metering: -18,
          url: 'file:///mock/cache/recording.m4a',
        }),
        uri: 'file:///mock/cache/recording.m4a',
      })),
      requestRecordingPermissionsAsync: jest
        .fn()
        .mockResolvedValue({ granted: true, status: 'granted' }),
    },
    RecordingPresets: {
      HIGH_QUALITY: {},
    },
    requestRecordingPermissionsAsync: jest
      .fn()
      .mockResolvedValue({ granted: true, status: 'granted' }),
    setAudioModeAsync: jest.fn().mockResolvedValue(undefined),
    useAudioRecorder: jest.fn(),
    useAudioRecorderState: jest.fn(),
    __setAudioStatus: (nextStatus: Record<string, unknown>) => {
      currentStatus = { ...currentStatus, ...nextStatus };
    },
    __resetAudioMocks: () => {
      currentStatus = { ...defaultStatus };
      mockPlayer.play.mockReset();
      mockPlayer.pause.mockReset();
      mockPlayer.seekTo.mockReset();
      mockPlayer.remove.mockReset();
    },
  };
});

jest.mock('yaml', () => ({
  __esModule: true,
  default: {
    parse: (text: string) => {
      if (!text.trim()) return {};
      const lines = text.split('\n');
      const root: Record<string, unknown> = {};

      const parseScalar = (value: string): unknown => {
        if (value === 'true') return true;
        if (value === 'false') return false;
        if (/^-?\d+(\.\d+)?$/.test(value)) return Number(value);
        return value;
      };

      const getNextContainer = (
        currentIndex: number,
        currentIndent: number,
      ): Record<string, unknown> | unknown[] => {
        for (let nextIndex = currentIndex + 1; nextIndex < lines.length; nextIndex += 1) {
          const nextLine = lines[nextIndex];
          if (!nextLine.trim()) {
            continue;
          }

          const nextIndent = nextLine.match(/^\s*/)?.[0].length || 0;
          if (nextIndent <= currentIndent) {
            break;
          }

          return nextLine.trim().startsWith('- ') ? [] : {};
        }

        return {};
      };

      const stack: Array<{ indent: number; container: Record<string, unknown> | unknown[] }> = [
        { indent: -1, container: root },
      ];

      for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index];
        if (!line.trim()) {
          continue;
        }

        const indent = line.match(/^\s*/)?.[0].length || 0;
        const trimmed = line.trim();

        while (stack.length > 1 && indent <= stack[stack.length - 1].indent) {
          stack.pop();
        }

        const currentContainer = stack[stack.length - 1].container;

        const arrayMatch = trimmed.match(/^-\s+(.+)$/);
        if (arrayMatch) {
          if (Array.isArray(currentContainer)) {
            currentContainer.push(parseScalar(arrayMatch[1].trim()));
          }
          continue;
        }

        const kvMatch = trimmed.match(/^([a-zA-Z_]\w*)\s*:\s*(.*)$/);
        if (kvMatch) {
          const key = kvMatch[1];
          const val = kvMatch[2].trim();

          if (Array.isArray(currentContainer)) {
            continue;
          }

          if (!val) {
            const nextContainer = getNextContainer(index, indent);
            currentContainer[key] = nextContainer;
            stack.push({ indent, container: nextContainer });
            continue;
          }

          currentContainer[key] = parseScalar(val);
        }
      }

      return root;
    },
    stringify: (obj: any) => JSON.stringify(obj),
  },
}));

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    setItem: jest.fn().mockResolvedValue(undefined),
    getItem: jest.fn().mockResolvedValue(null),
    removeItem: jest.fn().mockResolvedValue(undefined),
    multiGet: jest.fn().mockResolvedValue([]),
    multiSet: jest.fn().mockResolvedValue(undefined),
    multiRemove: jest.fn().mockResolvedValue(undefined),
    getAllKeys: jest.fn().mockResolvedValue([]),
    clear: jest.fn().mockResolvedValue(undefined),
  },
}));

jest.mock('react-native-marked', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return {
    __esModule: true,
    default: ({ value }: { value: string }) => React.createElement(Text, null, value),
    useMarkdown: (value: string) => [
      React.createElement(Text, { key: `markdown-${value}` }, value),
    ],
  };
});

jest.mock('lucide-react-native', () => {
  const React = require('react');
  const { View } = require('react-native');
  const createMockIcon = (name: string) => {
    const MockIcon = (props: any) =>
      React.createElement(View, { ...props, testID: `icon-${name}` });
    MockIcon.displayName = name;
    return MockIcon;
  };
  return new Proxy(
    {},
    {
      get: (_target, prop) => {
        if (typeof prop === 'string') {
          return createMockIcon(prop);
        }
        return undefined;
      },
    },
  );
});

// Mock navigation
jest.mock('@react-navigation/native', () => {
  const actual = jest.requireActual('@react-navigation/native');
  return {
    ...actual,
    useNavigation: () => ({
      navigate: jest.fn(),
      goBack: jest.fn(),
      openDrawer: jest.fn(),
      closeDrawer: jest.fn(),
    }),
    useRoute: () => ({ params: {} }),
    NavigationContainer: ({ children }: { children: React.ReactNode }) => children,
  };
});

jest.mock('@react-navigation/drawer', () => ({
  createDrawerNavigator: () => ({
    Navigator: ({ children }: { children: React.ReactNode }) => children,
    Screen: ({ children }: { children: React.ReactNode }) => children,
  }),
}));

jest.mock('react-native-webview', () => {
  const React = require('react');
  const { View } = require('react-native');
  const WebView = React.forwardRef((props: any, ref: any) => {
    React.useImperativeHandle(ref, () => ({
      injectJavaScript: jest.fn(),
      postMessage: jest.fn(),
      reload: jest.fn(),
    }));
    return React.createElement(View, { testID: 'mock-webview', ...props });
  });
  WebView.displayName = 'WebView';
  return {
    __esModule: true,
    default: WebView,
    WebView,
  };
});

// Silence warnings during tests
const originalWarn = console.warn;
const originalError = console.error;

const suppressedWarnPrefixes = [
  'Failed to import chat attachments into the conversation workspace.',
];

console.warn = (...args: any[]) => {
  if (
    typeof args[0] === 'string' &&
    (args[0].includes('Animated') ||
      args[0].includes('useNativeDriver') ||
      suppressedWarnPrefixes.some((prefix) => args[0].startsWith(prefix)))
  ) {
    return;
  }
  originalWarn(...args);
};

console.error = (...args: any[]) => {
  const message = args
    .map((arg) => {
      try {
        return String(arg);
      } catch {
        return '';
      }
    })
    .join(' ');

  if (message.includes('findNodeHandle is deprecated in StrictMode')) {
    return;
  }
  originalError(...args);
};
