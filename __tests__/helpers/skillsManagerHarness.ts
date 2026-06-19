import {
  useSkillsStore,
  parseSkillManifest,
  registerSkill,
  unregisterSkill,
  getLoadedSkill,
  getAllLoadedSkills,
  getSkillToolDefinitions,
  parseSkillToolName,
  executeSkillTool,
  activateSkill,
  deactivateSkill,
  activateEnabledSkills,
  getSkillSystemPrompts,
  isSkillCompatible,
  filterToolsByInvocationPolicy,
} from '../../src/services/skills/manager';
import { useSettingsStore } from '../../src/store/useSettingsStore';
import type { Skill, SkillEntry, SkillMetadata } from '../../src/services/skills/types';
import type { ToolDefinition } from '../../src/types/tool';

jest.mock('../../src/services/ssh/connector', () => ({
  getSshTargetReadiness: (target: any) => ({
    launchable: Boolean(target?.enabled && target?.host && target?.username),
    reason: target?.enabled ? 'ready' : 'disabled',
  }),
  getSshTargetLabel: (target: any) => `${target?.host || 'unknown'}:${target?.port || 22}`,
}));

jest.mock('expo-file-system', () => {
  const store: Record<string, string | Uint8Array> = {};
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
    const normalizedUri = normalizeUri(uri);
    const pieces = normalizedUri.split('/');
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
      return this.uri in store;
    }

    async text() {
      const value = store[this.uri];
      if (typeof value === 'string') {
        return value;
      }
      if (value instanceof Uint8Array) {
        return new TextDecoder().decode(value);
      }
      return '';
    }

    async bytes() {
      const value = store[this.uri];
      if (value instanceof Uint8Array) {
        return value;
      }
      if (typeof value === 'string') {
        return new TextEncoder().encode(value);
      }
      return new Uint8Array(0);
    }

    write(content: string | Uint8Array) {
      ensureParents(this.uri);
      store[this.uri] = content;
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
  dirs.add(documentRoot);

  return {
    File: MockFile,
    Directory: MockDirectory,
    documentDirectory: `${documentRoot}/`,
    Paths: {
      get document() {
        return new MockDirectory(documentRoot);
      },
    },
    makeDirectoryAsync: jest.fn(async (uri: string) => {
      const normalizedUri = normalizeUri(uri);
      dirs.add(normalizedUri);
      ensureParents(normalizedUri);
    }),
    writeAsStringAsync: jest.fn(async (uri: string, content: string) => {
      const normalizedUri = normalizeUri(uri);
      ensureParents(normalizedUri);
      store[normalizedUri] = content;
    }),
    readAsStringAsync: jest.fn(async (uri: string) => store[normalizeUri(uri)] || ''),
    getInfoAsync: jest.fn(async (uri: string) => {
      const normalizedUri = normalizeUri(uri);
      return {
        exists: normalizedUri in store || dirs.has(normalizedUri),
        isDirectory: dirs.has(normalizedUri),
      };
    }),
    readDirectoryAsync: jest.fn(async (uri: string) => {
      const normalizedUri = normalizeUri(uri);
      return new MockDirectory(normalizedUri).list().map((entry) => entry.name);
    }),
    deleteAsync: jest.fn(async (uri: string) => {
      const normalizedUri = normalizeUri(uri);
      delete store[normalizedUri];
      new MockDirectory(normalizedUri).delete();
    }),
    __resetStore: () => {
      for (const key of Object.keys(store)) {
        delete store[key];
      }
      dirs.clear();
      dirs.add(documentRoot);
    },
    __getStore: () => store,
  };
});

const { __resetStore, __getStore } = require('expo-file-system');

export {
  useSkillsStore,
  parseSkillManifest,
  registerSkill,
  unregisterSkill,
  getLoadedSkill,
  getAllLoadedSkills,
  getSkillToolDefinitions,
  parseSkillToolName,
  executeSkillTool,
  activateSkill,
  deactivateSkill,
  activateEnabledSkills,
  getSkillSystemPrompts,
  isSkillCompatible,
  filterToolsByInvocationPolicy,
  useSettingsStore,
};
export type { Skill, SkillEntry, SkillMetadata, ToolDefinition };

export function resetSkillsManagerTestState() {
  useSkillsStore.setState({ entries: [] });
  useSettingsStore.setState({
    mcpServers: [],
    sshTargets: [],
    workspaceTargets: [],
  });
  for (const skill of getAllLoadedSkills()) {
    unregisterSkill(skill.id);
  }
  __resetStore();
}

export function getMockFileSystemStore(): Record<string, string | Uint8Array> {
  return __getStore();
}

export function makeEntry(overrides: Partial<SkillEntry> & { id: string }): SkillEntry {
  return {
    metadata: {
      name: 'Test Skill',
      description: 'A test skill',
      version: '1.0.0',
      author: 'tester',
      tags: [],
      invocationPolicy: 'auto',
      tools: ['do_thing'],
    },
    enabled: true,
    installedAt: Date.now(),
    source: {
      source: 'clawhub',
      id: 'hub-1',
      url: 'https://clawhub.ai/api/v1/skills/hub-1/file?path=SKILL.md',
      version: '1.0.0',
    },
    ...overrides,
  };
}
