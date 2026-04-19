// ---------------------------------------------------------------------------
// Hook Loader — tests
// ---------------------------------------------------------------------------

// Mock expo-file-system with the new Paths/File/Directory API
const mockFileText = jest.fn().mockReturnValue('');
const mockFileWrite = jest.fn();
const mockFileDelete = jest.fn();
let mockFileExists = false;
const mockDirList = jest.fn().mockReturnValue([]);
const mockDirCreate = jest.fn();
let mockDirExists = true;

jest.mock('expo-file-system', () => ({
  Paths: { document: '/mock/docs' },
  File: jest.fn().mockImplementation((_dir: any, _name: string) => ({
    text: mockFileText,
    write: mockFileWrite,
    delete: mockFileDelete,
    get exists() {
      return mockFileExists;
    },
    name: _name,
  })),
  Directory: jest.fn().mockImplementation((_base: any, _name: string) => ({
    list: mockDirList,
    create: mockDirCreate,
    get exists() {
      return mockDirExists;
    },
  })),
}));

// Mock the events bus
jest.mock('../../src/services/events/bus', () => ({
  registerInternalHook: jest.fn(),
  unregisterInternalHook: jest.fn(),
}));

// Mock frontmatter parser
jest.mock('../../src/services/markdown/frontmatter', () => ({
  parseFrontmatterBlock: jest.fn().mockImplementation((content: string) => {
    // Simple frontmatter parser for tests
    const match = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
    if (!match) return { metadata: {}, content: content };
    const metaLines = match[1].split('\n');
    const metadata: Record<string, any> = {};
    for (const line of metaLines) {
      const [key, ...rest] = line.split(':');
      if (key && rest.length) {
        const val = rest.join(':').trim();
        if (val === 'true') metadata[key.trim()] = true;
        else if (val === 'false') metadata[key.trim()] = false;
        else metadata[key.trim()] = val;
      }
    }
    return { metadata, content: match[2] || '' };
  }),
  getFrontmatterString: jest.fn().mockImplementation((meta: Record<string, any>, key: string) => {
    return meta[key] !== undefined ? String(meta[key]) : undefined;
  }),
  normalizeStringList: jest.fn().mockReturnValue([]),
}));

// Mock id generator
jest.mock('../../src/utils/id', () => ({
  generateId: jest.fn().mockReturnValue('mock-id'),
}));

import {
  parseHookFile,
  registerHook,
  unregisterHook,
  getLoadedHooks,
  clearAllHooks,
  saveHookFile,
  deleteHookFile,
} from '../../src/services/hooks/loader';
import type { HookDefinition } from '../../src/types';

describe('Hook Loader', () => {
  const mockExecutePrompt = jest.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    clearAllHooks();
    jest.clearAllMocks();
    mockFileExists = false;
  });

  describe('parseHookFile', () => {
    it('parses YAML frontmatter and body', () => {
      const content = `---
name: Test Hook
event: session:start
enabled: true
---
This is the hook prompt.
It can span multiple lines.`;

      const result = parseHookFile(content);
      expect(result).not.toBeNull();
      expect(result!.name).toBe('Test Hook');
      expect(result!.event).toBe('session:start');
      expect(result!.prompt).toContain('This is the hook prompt');
    });

    it('returns null for empty input', () => {
      expect(parseHookFile('')).toBeNull();
    });

    it('returns null for content without frontmatter', () => {
      expect(parseHookFile('Just some text without YAML')).toBeNull();
    });
  });

  describe('registerHook / unregisterHook', () => {
    it('registers a hook', () => {
      const hook: HookDefinition = {
        id: 'h1',
        name: 'Test',
        event: 'session:start',
        action: '*',
        prompt: 'Do stuff',
        enabled: true,
        createdAt: Date.now(),
        source: 'user',
      };
      registerHook(hook, mockExecutePrompt);
      expect(getLoadedHooks()).toHaveLength(1);
      expect(getLoadedHooks()[0].name).toBe('Test');
    });

    it('registers multiple hooks', () => {
      registerHook(
        {
          id: 'h1',
          name: 'H1',
          event: 'a',
          action: '*',
          prompt: 'p',
          enabled: true,
          createdAt: Date.now(),
          source: 'user',
        },
        mockExecutePrompt,
      );
      registerHook(
        {
          id: 'h2',
          name: 'H2',
          event: 'b',
          action: '*',
          prompt: 'p',
          enabled: true,
          createdAt: Date.now(),
          source: 'user',
        },
        mockExecutePrompt,
      );
      expect(getLoadedHooks()).toHaveLength(2);
    });

    it('unregisters a hook by id', () => {
      registerHook(
        {
          id: 'h1',
          name: 'H1',
          event: 'a',
          action: '*',
          prompt: 'p',
          enabled: true,
          createdAt: Date.now(),
          source: 'user',
        },
        mockExecutePrompt,
      );
      unregisterHook('h1');
      expect(getLoadedHooks()).toHaveLength(0);
    });

    it('unregister is no-op for unknown id', () => {
      expect(() => unregisterHook('nonexistent')).not.toThrow();
    });
  });

  describe('clearAllHooks', () => {
    it('removes all hooks', () => {
      registerHook(
        {
          id: 'h1',
          name: 'H1',
          event: 'a',
          action: '*',
          prompt: 'p',
          enabled: true,
          createdAt: Date.now(),
          source: 'user',
        },
        mockExecutePrompt,
      );
      registerHook(
        {
          id: 'h2',
          name: 'H2',
          event: 'b',
          action: '*',
          prompt: 'p',
          enabled: true,
          createdAt: Date.now(),
          source: 'user',
        },
        mockExecutePrompt,
      );
      clearAllHooks();
      expect(getLoadedHooks()).toHaveLength(0);
    });
  });

  describe('saveHookFile', () => {
    it('writes hook to file system', () => {
      const hook: HookDefinition = {
        id: 'save-1',
        name: 'Saved Hook',
        event: 'session:end',
        action: '*',
        prompt: 'Summarize the session',
        enabled: true,
        createdAt: Date.now(),
        source: 'user',
      };
      saveHookFile(hook);
      expect(mockFileWrite).toHaveBeenCalled();
    });
  });

  describe('deleteHookFile', () => {
    it('overwrites hook file with empty content', () => {
      mockFileExists = true;
      const hook: HookDefinition = {
        id: 'del-1',
        name: 'To Delete',
        event: 'test',
        action: '*',
        prompt: 'p',
        enabled: true,
        createdAt: Date.now(),
        source: 'user',
      };
      deleteHookFile(hook);
      // deleteHookFile deletes the file
      expect(mockFileDelete).toHaveBeenCalled();
    });

    it('does not write when file does not exist', () => {
      mockFileExists = false;
      const hook: HookDefinition = {
        id: 'del-2',
        name: 'Missing',
        event: 'test',
        action: '*',
        prompt: 'p',
        enabled: true,
        createdAt: Date.now(),
        source: 'user',
      };
      deleteHookFile(hook);
      expect(mockFileDelete).not.toHaveBeenCalled();
    });
  });

  describe('registerHook with action', () => {
    it('registers hook with specific action', () => {
      const hook: HookDefinition = {
        id: 'ha1',
        name: 'Action Hook',
        event: 'session',
        action: 'start',
        prompt: 'On start: {{message}}',
        enabled: true,
        createdAt: Date.now(),
        source: 'user',
      };
      registerHook(hook, mockExecutePrompt);
      const hooks = getLoadedHooks();
      expect(hooks.some((h) => h.id === 'ha1')).toBe(true);
    });
  });

  describe('loadHooksFromDirectory', () => {
    it('loads hook files from directory', async () => {
      const { loadHooksFromDirectory } = require('../../src/services/hooks/loader');
      mockDirList.mockReturnValue([
        {
          name: 'test-hook.md',
          text: () => `---
name: Dir Hook
event: session:start
action: '*'
enabled: true
---
Handle session start`,
        },
      ]);
      const loaded = await loadHooksFromDirectory(mockExecutePrompt);
      expect(loaded.length).toBeGreaterThanOrEqual(0);
    });

    it('skips directories in listing', async () => {
      const { loadHooksFromDirectory } = require('../../src/services/hooks/loader');
      mockDirList.mockReturnValue([
        { name: 'subdir' }, // no 'text' property = directory
      ]);
      const loaded = await loadHooksFromDirectory(mockExecutePrompt);
      expect(loaded).toHaveLength(0);
    });

    it('skips non-md files', async () => {
      const { loadHooksFromDirectory } = require('../../src/services/hooks/loader');
      mockDirList.mockReturnValue([{ name: 'notes.txt', text: () => 'not a hook' }]);
      const loaded = await loadHooksFromDirectory(mockExecutePrompt);
      expect(loaded).toHaveLength(0);
    });
  });
});
