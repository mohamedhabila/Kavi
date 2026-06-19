import type { Skill } from '../../src/services/skills/types';

jest.mock('../../src/services/python/pyodideBridge', () => ({
  executePython: jest.fn().mockResolvedValue({ success: true, output: '42' }),
}));

jest.mock('expo-file-system', () => {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const store: Record<string, Uint8Array> = {};
  const dirs = new Set<string>();

  const normalizeUri = (value: string): string => value.replace(/\/+$/g, '');

  const joinUri = (...parts: string[]): string => {
    if (parts.length === 0) return '';
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
    constructor(...parts: any[]) {
      const pathParts: string[] = [];
      for (const p of parts) {
        if (typeof p === 'string') {
          pathParts.push(p);
        } else if (p && p.uri) {
          pathParts.push(p.uri);
        }
      }
      this.uri = joinUri(...pathParts);
      this.name = pathParts[pathParts.length - 1]?.split('/').pop() || '';
    }
    get exists() {
      return this.uri in store;
    }
    text() {
      return decoder.decode(store[this.uri] || new Uint8Array());
    }
    bytes() {
      return store[this.uri] || new Uint8Array();
    }
    write(content: string | Uint8Array | ArrayBuffer) {
      ensureParents(this.uri);
      if (typeof content === 'string') {
        store[this.uri] = encoder.encode(content);
        return;
      }

      if (content instanceof Uint8Array) {
        store[this.uri] = content;
        return;
      }

      store[this.uri] = new Uint8Array(content);
    }
    delete() {
      delete store[this.uri];
    }
  }

  class MockDirectory {
    uri: string;
    name: string;
    constructor(...parts: any[]) {
      const pathParts: string[] = [];
      for (const p of parts) {
        if (typeof p === 'string') {
          pathParts.push(p);
        } else if (p && p.uri) {
          pathParts.push(p.uri);
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
      const prefix = this.uri.endsWith('/') ? this.uri : this.uri + '/';
      const results: any[] = [];
      const seen = new Set<string>();

      for (const key of Object.keys(store)) {
        if (key.startsWith(prefix)) {
          const rest = key.slice(prefix.length);
          const firstPart = rest.split('/')[0];
          if (!seen.has(firstPart)) {
            seen.add(firstPart);
            if (rest.includes('/')) {
              results.push(new MockDirectory(this, firstPart));
            } else {
              results.push(new MockFile(this, firstPart));
            }
          }
        }
      }
      return results;
    }

    delete() {
      dirs.delete(this.uri);
      for (const dir of Array.from(dirs)) {
        if (dir.startsWith(`${this.uri}/`)) {
          dirs.delete(dir);
        }
      }
      for (const key of Object.keys(store)) {
        if (key.startsWith(`${this.uri}/`)) {
          delete store[key];
        }
      }
    }
  }

  const documentRoot = 'file:///mock/documents';
  const cacheRoot = 'file:///mock/cache';
  dirs.add(documentRoot);
  dirs.add(cacheRoot);

  const mockPaths = {
    get document() {
      return new MockDirectory(documentRoot);
    },
    get cache() {
      return new MockDirectory(cacheRoot);
    },
  };

  return {
    File: MockFile,
    Directory: MockDirectory,
    Paths: mockPaths,
    __resetStore: () => {
      for (const key of Object.keys(store)) delete store[key];
      dirs.clear();
      dirs.add(documentRoot);
      dirs.add(cacheRoot);
    },
    __getStore: () =>
      Object.fromEntries(Object.entries(store).map(([key, value]) => [key, decoder.decode(value)])),
  };
});

export const mockReadWorkspaceFile = jest.fn();
export const mockWriteWorkspaceFile = jest.fn();
export const mockListWorkspaceDirectory = jest.fn();

jest.mock('../../src/services/workspaces/files', () => {
  const actual = jest.requireActual('../../src/services/workspaces/files');
  return {
    ...actual,
    readWorkspaceFile: (...args: any[]) => mockReadWorkspaceFile(...args),
    writeWorkspaceFile: (...args: any[]) => mockWriteWorkspaceFile(...args),
    listWorkspaceDirectory: (...args: any[]) => mockListWorkspaceDirectory(...args),
  };
});

export const mockSettingsState: {
  workspaceTargets: any[];
} = {
  workspaceTargets: [],
};

jest.mock('../../src/store/useSettingsStore', () => ({
  useSettingsStore: {
    getState: () => ({
      activeProviderId: 'openai',
      providers: [
        {
          id: 'openai',
          name: 'OpenAI',
          baseUrl: 'https://api.openai.com/v1',
          apiKey: '',
          model: 'gpt-image-2',
          enabled: true,
        },
      ],
      workspaceTargets: mockSettingsState.workspaceTargets,
    }),
  },
}));

export const mockChatStoreState: { conversations: any[] } = {
  conversations: [],
};

jest.mock('../../src/store/useChatStore', () => ({
  useChatStore: {
    getState: () => mockChatStoreState,
  },
}));

jest.mock('../../src/services/storage/SecureStorage', () => ({
  getProviderApiKey: jest.fn().mockResolvedValue('sk-image'),
}));

jest.mock('../../src/services/media/imageGeneration', () => ({
  generateImage: jest.fn().mockResolvedValue({
    status: 'generated',
    providerId: 'openai',
    model: 'gpt-image-2',
    mimeType: 'image/png',
    fileUri: 'file:///mock/cache/generated.png',
  }),
  editImage: jest.fn().mockResolvedValue({
    status: 'edited',
    providerId: 'openai',
    model: 'gpt-image-2',
    mimeType: 'image/png',
    fileUri: 'file:///mock/cache/edited.png',
    sourceCount: 1,
  }),
}));

jest.mock('../../src/services/memory/embeddings', () => ({
  hybridSearch: jest.fn().mockResolvedValue([]),
}));

jest.mock('../../src/services/memory/sqlite-store', () => ({
  indexMemoryToSqlite: jest.fn().mockResolvedValue(0),
  sqliteHybridSearch: jest.fn().mockResolvedValue([]),
}));

jest.mock('../../src/engine/tools/native/executor', () => ({
  executeNativeTool: jest.fn().mockImplementation((name: string) => {
    if (name === 'notification_send') {
      return Promise.resolve(
        JSON.stringify({
          status: 'notification_displayed',
          id: 'notification-id',
          title: 'Test',
          body: 'Hello',
        }),
      );
    }
    return Promise.resolve(JSON.stringify({ status: 'ok' }));
  }),
}));

jest.mock('../../src/services/security/audit', () => ({
  logToolCall: jest.fn(),
}));

jest.mock('../../src/services/remote/approvalStore', () => ({
  needsApprovalWithContext: jest.fn(() => false),
  requestToolApproval: jest.fn(),
}));

export const mockPermissionOverrides = new Map<string, boolean>();

jest.mock('../../src/services/security/permissions', () => ({
  useToolPermissionsStore: {
    getState: () => ({
      isAllowed: (name: string) => mockPermissionOverrides.get(name) ?? true,
      setPermission: (name: string, allowed: boolean) => {
        mockPermissionOverrides.set(name, allowed);
      },
      reset: () => {
        mockPermissionOverrides.clear();
      },
    }),
  },
}));

export let __resetStore: () => void;
export let __getStore: () => Record<string, string>;
export let executeTool: (
  name: string,
  argsString: string,
  conversationId: string,
  context?: Record<string, unknown>,
) => Promise<string>;
export let loadMemory: (conversationId: string) => Promise<string | null>;
export let executeNativeTool: jest.Mock;
export let generateImage: jest.Mock;
export let editImage: jest.Mock;
export let hybridSearch: jest.Mock;
export let indexMemoryToSqlite: jest.Mock;
export let sqliteHybridSearch: jest.Mock;
export let registerSkill: (skill: Skill) => void;
export let unregisterSkill: (id: string) => void;
export let clearAllSurfaces: () => void;
export let getSurface: (surfaceId: string) => any;
export let executePython: jest.Mock;
export const REMOTE_WORKSPACE_TARGET = {
  id: 'workspace-target-1',
  name: 'Repo Workspace',
  rootPath: '/workspace/repo',
  provider: 'code-server',
  baseUrl: 'https://code.example.com',
  enabled: true,
} as const;

function loadTestModules() {
  ({ __resetStore, __getStore } = require('expo-file-system'));
  ({ executeTool, loadMemory } = require('../../src/engine/tools/index'));
  ({ executeNativeTool } = require('../../src/engine/tools/native/executor'));
  ({ generateImage, editImage } = require('../../src/services/media/imageGeneration'));
  ({ hybridSearch } = require('../../src/services/memory/embeddings'));
  ({ indexMemoryToSqlite, sqliteHybridSearch } = require('../../src/services/memory/sqlite-store'));
  ({ registerSkill, unregisterSkill } = require('../../src/services/skills/manager'));
  ({ clearAllSurfaces, getSurface } = require('../../src/services/canvas/renderer'));
  ({ executePython } = require('../../src/services/python/pyodideBridge'));
}

beforeEach(() => {
  jest.resetModules();
  loadTestModules();
  __resetStore();
  jest.clearAllMocks();
  mockChatStoreState.conversations = [];
  mockSettingsState.workspaceTargets = [];
  mockReadWorkspaceFile.mockReset();
  mockWriteWorkspaceFile.mockReset();
  mockListWorkspaceDirectory.mockReset();
  executePython.mockResolvedValue({ success: true, output: '42' });
  hybridSearch.mockReset();
  hybridSearch.mockResolvedValue([]);
  indexMemoryToSqlite.mockReset();
  indexMemoryToSqlite.mockResolvedValue(0);
  sqliteHybridSearch.mockReset();
  sqliteHybridSearch.mockResolvedValue([]);
  mockPermissionOverrides.clear();
  clearAllSurfaces();
  const { useSchedulerStore } = require('../../src/services/scheduler/store');
  useSchedulerStore.setState({ jobs: [] });
});
