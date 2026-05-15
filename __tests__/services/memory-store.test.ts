// ---------------------------------------------------------------------------
// Tests — Memory Store
// ---------------------------------------------------------------------------

jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import {
  appendConversationMemory,
  readGlobalMemory,
  readConversationMemory,
  writeGlobalMemory,
  writeConversationMemory,
  appendGlobalMemory,
  readDailyMemory,
  appendDailyMemory,
  clearConversationMemory,
  getConversationMemoryForSystemPrompt,
  listDailyMemoryFiles,
  getMemoryForSystemPrompt,
  searchMemory,
  flushToMemory,
  clearAllMemory,
} from '../../src/services/memory/store';

// The expo-file-system mock is in jest.setup.ts but uses the OLD API.
// The memory store uses the NEW Paths/File/Directory API; we mock it here.

const mockFileState = new Map<string, string>();

jest.mock('expo-file-system', () => {
  class MockFile {
    _path: string;
    constructor(...parts: any[]) {
      if (parts.length === 2) {
        this._path = `${parts[0]._path ?? parts[0]}/${parts[1]}`;
      } else {
        this._path = parts[0];
      }
    }
    get name() {
      return this._path.split('/').pop() ?? '';
    }
    get exists() {
      return mockFileState.has(this._path);
    }
    text() {
      return mockFileState.get(this._path) ?? '';
    }
    write(content: string) {
      mockFileState.set(this._path, content);
    }
  }

  class MockDirectory {
    _path: string;
    constructor(...parts: any[]) {
      if (parts.length === 2) {
        this._path = `${parts[0]._path ?? parts[0]}/${parts[1]}`;
      } else {
        this._path = parts[0];
      }
    }
    get exists() {
      return true;
    }
    create() {}
    delete() {
      for (const key of mockFileState.keys()) {
        if (key.startsWith(this._path)) mockFileState.delete(key);
      }
    }
    list() {
      const entries: MockFile[] = [];
      for (const key of mockFileState.keys()) {
        if (key.startsWith(this._path + '/') && !key.slice(this._path.length + 1).includes('/')) {
          entries.push(new MockFile(key));
        }
      }
      return entries;
    }
  }

  return {
    Paths: { document: '/mock/documents' },
    File: MockFile,
    Directory: MockDirectory,
    documentDirectory: 'file:///mock/documents/',
    getInfoAsync: jest.fn().mockResolvedValue({ exists: false }),
    makeDirectoryAsync: jest.fn().mockResolvedValue(undefined),
    readAsStringAsync: jest.fn().mockResolvedValue(''),
    writeAsStringAsync: jest.fn().mockResolvedValue(undefined),
    readDirectoryAsync: jest.fn().mockResolvedValue([]),
    deleteAsync: jest.fn().mockResolvedValue(undefined),
  };
});

beforeEach(() => {
  mockFileState.clear();
});

describe('Global Memory (MEMORY.md)', () => {
  it('readGlobalMemory returns null when no file', async () => {
    expect(await readGlobalMemory()).toBeNull();
  });

  it('writeGlobalMemory + readGlobalMemory round-trip', async () => {
    writeGlobalMemory('# My Memory\n\nSome facts.');
    expect(await readGlobalMemory()).toBe('# My Memory\n\nSome facts.');
  });

  it('appendGlobalMemory appends to existing', async () => {
    writeGlobalMemory('First');
    await appendGlobalMemory('Second');
    expect(await readGlobalMemory()).toBe('First\n\nSecond');
  });

  it('appendGlobalMemory creates when empty', async () => {
    await appendGlobalMemory('First entry');
    expect(await readGlobalMemory()).toBe('First entry');
  });
});

describe('Conversation Memory', () => {
  it('readConversationMemory returns null when no file', async () => {
    expect(await readConversationMemory('conv-1')).toBeNull();
  });

  it('writeConversationMemory + readConversationMemory round-trip', async () => {
    writeConversationMemory('conv-1', '# Task Notes\n\nUse the shared plan.');
    expect(await readConversationMemory('conv-1')).toBe('# Task Notes\n\nUse the shared plan.');
  });

  it('appendConversationMemory appends to the existing conversation scope', async () => {
    writeConversationMemory('conv-1', 'First');
    await appendConversationMemory('conv-1', 'Second');
    expect(await readConversationMemory('conv-1')).toBe('First\n\nSecond');
  });

  it('clearConversationMemory removes only the requested conversation memory', async () => {
    writeConversationMemory('conv-1', 'Conversation one');
    writeConversationMemory('conv-2', 'Conversation two');

    clearConversationMemory('conv-1');

    expect(await readConversationMemory('conv-1')).toBeNull();
    expect(await readConversationMemory('conv-2')).toBe('Conversation two');
  });
});

describe('getMemoryForSystemPrompt', () => {
  it('returns null when no memory', async () => {
    expect(await getMemoryForSystemPrompt()).toBeNull();
  });

  it('returns full memory when under limit', async () => {
    writeGlobalMemory('Line 1\nLine 2');
    expect(await getMemoryForSystemPrompt()).toBe('Line 1\nLine 2');
  });

  it('truncates when over maxLines', async () => {
    const lines = Array.from({ length: 300 }, (_, i) => `Line ${i}`);
    writeGlobalMemory(lines.join('\n'));
    const result = await getMemoryForSystemPrompt(200);
    expect(result).toContain('Line 0');
    expect(result).toContain('[Memory truncated');
    expect(result!.split('\n').length).toBeLessThan(300);
  });
});

describe('getConversationMemoryForSystemPrompt', () => {
  it('returns null when no conversation memory exists', async () => {
    expect(await getConversationMemoryForSystemPrompt('conv-1')).toBeNull();
  });

  it('returns the conversation memory when under the line limit', async () => {
    writeConversationMemory('conv-1', 'Line 1\nLine 2');
    expect(await getConversationMemoryForSystemPrompt('conv-1')).toBe('Line 1\nLine 2');
  });

  it('truncates conversation memory for prompt injection', async () => {
    const lines = Array.from({ length: 180 }, (_, i) => `Line ${i}`);
    writeConversationMemory('conv-1', lines.join('\n'));

    const result = await getConversationMemoryForSystemPrompt('conv-1', 100);
    expect(result).toContain('Line 0');
    expect(result).toContain('[Memory truncated');
    expect(result!.split('\n').length).toBeLessThan(180);
  });
});

describe('searchMemory', () => {
  it('returns empty when no memory', async () => {
    expect(await searchMemory('test')).toEqual([]);
  });

  it('finds matches in global memory', async () => {
    writeGlobalMemory('## React\n\nReact is a framework\n\n## Python\n\nPython is great');
    const results = await searchMemory('React');
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].source).toBe('MEMORY.md');
  });

  it('returns score based on token match ratio', async () => {
    writeGlobalMemory('hello world foo bar');
    const results = await searchMemory('hello');
    expect(results[0].score).toBeGreaterThan(0);
  });

  it('searches with multiple tokens', async () => {
    writeGlobalMemory('## TypeScript\n\nTypeScript is great for building apps');
    const results = await searchMemory('TypeScript building');
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].score).toBe(1); // both tokens match
  });

  it('searches daily memories', async () => {
    await appendDailyMemory('Meeting notes about React Native', '2025-01-15');
    const results = await searchMemory('React Native');
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].source).toContain('daily/');
  });

  it('searches conversation memory when requested', async () => {
    writeConversationMemory('conv-1', '## Workflow\n\nConversation-scoped build fix');

    const results = await searchMemory('build fix', {
      scope: 'conversation',
      conversationId: 'conv-1',
    });

    expect(results.length).toBeGreaterThan(0);
    expect(results[0].scope).toBe('conversation');
    expect(results[0].source).toBe('conversation/MEMORY.md');
  });

  it('searches both conversation and global memory when scope is all', async () => {
    writeConversationMemory('conv-1', 'Conversation-only deployment note');
    writeGlobalMemory('Durable account preference');

    const results = await searchMemory('note preference', {
      scope: 'all',
      conversationId: 'conv-1',
    });

    expect(results.some((entry) => entry.scope === 'conversation')).toBe(true);
    expect(results.some((entry) => entry.scope === 'global')).toBe(true);
  });

  it('sorts results by score descending', async () => {
    writeGlobalMemory('## TypeScript\n\nTypeScript is a language\n\n## Other\n\nSomething else');
    await appendDailyMemory('TypeScript and React are great TypeScript tools', '2025-01-15');
    const results = await searchMemory('TypeScript');
    expect(results.length).toBeGreaterThan(1);
    expect(results[0].score).toBeGreaterThanOrEqual(results[results.length - 1].score);
  });

  it('returns no matches for unrelated queries', async () => {
    writeGlobalMemory('hello world');
    const results = await searchMemory('zzzzzzz');
    expect(results.length).toBe(0);
  });
});

describe('Daily Memory', () => {
  it('readDailyMemory returns null when no file', async () => {
    expect(await readDailyMemory('2025-01-01')).toBeNull();
  });

  it('appendDailyMemory + readDailyMemory round-trip', async () => {
    await appendDailyMemory('Entry 1', '2025-01-10');
    expect(await readDailyMemory('2025-01-10')).toContain('Entry 1');
  });

  it('appendDailyMemory appends with separator', async () => {
    await appendDailyMemory('First', '2025-01-10');
    await appendDailyMemory('Second', '2025-01-10');
    const content = await readDailyMemory('2025-01-10');
    expect(content).toContain('First');
    expect(content).toContain('Second');
    expect(content).toContain('---');
  });

  it('listDailyMemoryFiles returns sorted list', async () => {
    await appendDailyMemory('a', '2025-01-05');
    await appendDailyMemory('b', '2025-01-10');
    await appendDailyMemory('c', '2025-01-01');
    const files = listDailyMemoryFiles();
    expect(files.length).toBe(3);
    // Reversed sort: newest first
    expect(files[0]).toBe('2025-01-10');
    expect(files[2]).toBe('2025-01-01');
  });

  it('listDailyMemoryFiles returns empty when no files', () => {
    expect(listDailyMemoryFiles()).toEqual([]);
  });
});

describe('flushToMemory', () => {
  it('does nothing for empty facts', async () => {
    await flushToMemory([]);
    // No daily memory should be created (nothing to search)
    expect(await searchMemory('Session Notes')).toEqual([]);
  });

  it('writes facts as bullet points to daily memory', async () => {
    await flushToMemory(['Fact one', 'Fact two']);
    // Search for the content across all memories
    const results = await searchMemory('Fact one');
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].snippet).toContain('- Fact one');
  });

  it('writes session notes header', async () => {
    await flushToMemory(['Important insight']);
    const results = await searchMemory('Session Notes');
    expect(results.length).toBeGreaterThan(0);
  });
});

describe('clearAllMemory', () => {
  it('clears all memory files', async () => {
    writeGlobalMemory('some content');
    clearAllMemory();
    expect(await readGlobalMemory()).toBeNull();
  });

  it('clears daily memories too', async () => {
    await appendDailyMemory('daily content', '2025-01-15');
    writeGlobalMemory('global content');
    writeConversationMemory('conv-1', 'conversation content');
    clearAllMemory();
    expect(await readGlobalMemory()).toBeNull();
    expect(await readConversationMemory('conv-1')).toBeNull();
    expect(listDailyMemoryFiles()).toEqual([]);
  });
});
