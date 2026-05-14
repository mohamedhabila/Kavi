// ---------------------------------------------------------------------------
// Tests — SQLite Memory Store
// ---------------------------------------------------------------------------

// Mock expo-sqlite (synchronous API in expo-sqlite ~55)
const mockRunSync = jest.fn().mockReturnValue({ changes: 0 });
const mockGetFirstSync = jest.fn().mockReturnValue(null);
const mockGetAllSync = jest.fn().mockReturnValue([]);
const mockExecSync = jest.fn();
const mockCloseSync = jest.fn();

jest.mock('expo-sqlite', () => ({
  openDatabaseSync: jest.fn(() => ({
    runSync: mockRunSync,
    getFirstSync: mockGetFirstSync,
    getAllSync: mockGetAllSync,
    execSync: mockExecSync,
    closeSync: mockCloseSync,
  })),
}));

// Mock embeddings module
jest.mock('../../src/services/memory/embeddings', () => ({
  cosineSimilarity: jest.fn().mockReturnValue(0.9),
  getEmbeddingCached: jest.fn().mockResolvedValue([0.1, 0.2, 0.3]),
  temporalDecay: jest.fn().mockReturnValue(0.8),
}));

// Mock file-based memory store
jest.mock('../../src/services/memory/store', () => ({
  readConversationMemory: jest.fn().mockResolvedValue(null),
  readGlobalMemory: jest.fn().mockResolvedValue('# Section 1\nSome memory content'),
  listDailyMemoryFiles: jest.fn().mockReturnValue(['2026-03-25']),
  readDailyMemory: jest.fn().mockResolvedValue('Daily note content'),
  searchMemory: jest.fn().mockResolvedValue([]),
}));

import {
  getMemoryDb,
  closeMemoryDb,
  insertChunk,
  updateChunkEmbedding,
  getChunksWithoutEmbeddings,
  getAllChunks,
  getChunkCount,
  deleteChunksBySource,
  clearAllChunks,
  batchEmbedChunks,
  indexMemoryToSqlite,
  sqliteHybridSearch,
} from '../../src/services/memory/sqlite-store';

beforeEach(() => {
  // Reset the db singleton by closing it
  closeMemoryDb();
  mockRunSync.mockReset();
  mockGetFirstSync.mockReset();
  mockGetAllSync.mockReset();
  mockExecSync.mockReset();
  mockCloseSync.mockReset();
  mockGetFirstSync.mockReturnValue(null);
  mockGetAllSync.mockReturnValue([]);
  mockRunSync.mockReturnValue({ changes: 0 });
});

describe('getMemoryDb', () => {
  it('returns a database instance', () => {
    const db = getMemoryDb();
    expect(db).toBeDefined();
    expect(db.runSync).toBeDefined();
  });

  it('creates schema on first call', () => {
    getMemoryDb();
    expect(mockExecSync).toHaveBeenCalledWith(
      expect.stringContaining('CREATE TABLE IF NOT EXISTS memory_chunks'),
    );
  });

  it('reuses same instance on subsequent calls', () => {
    const db1 = getMemoryDb();
    const schemaCallCount = mockExecSync.mock.calls.length;
    const db2 = getMemoryDb();
    expect(db1).toBe(db2);
    expect(mockExecSync).toHaveBeenCalledTimes(schemaCallCount);
  });
});

describe('insertChunk', () => {
  it('inserts a chunk and returns true', () => {
    const result = insertChunk('test-source', 'some content', Date.now());
    expect(result).toBe(true);
    expect(mockRunSync).toHaveBeenCalledWith(
      expect.stringContaining('INSERT'),
      'test-source',
      'some content',
      expect.any(String), // content_hash
      null, // embedding
      expect.any(Number), // timestamp
      expect.any(Number), // indexed_at
      'global',
      null,
      null,
      null,
      'global:test-source',
      'memory_file',
      1,
    );
  });

  it('returns false on error', () => {
    mockRunSync.mockImplementationOnce(() => {
      throw new Error('constraint');
    });
    closeMemoryDb(); // force re-init
    // After close, re-opening will call execSync, then runSync will throw
    const result = insertChunk('test-source', 'duplicate content', Date.now());
    expect(result).toBe(false);
  });
});

describe('updateChunkEmbedding', () => {
  it('updates embedding for given id', () => {
    getMemoryDb();
    updateChunkEmbedding(1, [0.1, 0.2, 0.3]);
    expect(mockRunSync).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE'),
      expect.stringContaining('[0.1,0.2,0.3]'),
      expect.any(Number),
      1,
    );
  });
});

describe('getChunksWithoutEmbeddings', () => {
  it('returns chunks missing embeddings', () => {
    mockGetAllSync.mockReturnValueOnce([
      {
        id: 1,
        source: 's1',
        content: 'text1',
        content_hash: 'h1',
        embedding: null,
        timestamp: 1000,
        indexed_at: 2000,
      },
      {
        id: 2,
        source: 's2',
        content: 'text2',
        content_hash: 'h2',
        embedding: null,
        timestamp: 1001,
        indexed_at: 2001,
      },
    ]);

    const chunks = getChunksWithoutEmbeddings(10);
    expect(chunks).toHaveLength(2);
    expect(chunks[0].id).toBe(1);
    expect(chunks[0].embedding).toBeNull();
  });
});

describe('getAllChunks', () => {
  it('returns all stored chunks', () => {
    mockGetAllSync.mockReturnValueOnce([
      {
        id: 1,
        source: 's1',
        content: 'text1',
        content_hash: 'h1',
        embedding: '[0.1,0.2]',
        timestamp: 1000,
        indexed_at: 2000,
      },
    ]);

    const chunks = getAllChunks();
    expect(chunks).toHaveLength(1);
    expect(chunks[0].embedding).toEqual([0.1, 0.2]);
  });
});

describe('getChunkCount', () => {
  it('returns count from database', () => {
    mockGetFirstSync.mockReturnValueOnce({ count: 42 });
    const count = getChunkCount();
    expect(count).toBe(42);
  });

  it('returns 0 when no rows', () => {
    mockGetFirstSync.mockReturnValueOnce(null);
    const count = getChunkCount();
    expect(count).toBe(0);
  });
});

describe('deleteChunksBySource', () => {
  it('deletes by source and returns change count', () => {
    mockRunSync.mockReturnValueOnce({ changes: 3 });
    const deleted = deleteChunksBySource('test-source');
    expect(deleted).toBe(3);
    expect(mockRunSync).toHaveBeenCalledWith(expect.stringContaining('DELETE'), 'test-source');
  });
});

describe('clearAllChunks', () => {
  it('deletes all records', () => {
    clearAllChunks();
    expect(mockRunSync).toHaveBeenCalledWith('DELETE FROM memory_chunks');
  });
});

describe('batchEmbedChunks', () => {
  it('embeds and reports progress', async () => {
    mockGetAllSync.mockReturnValueOnce([
      {
        id: 1,
        source: 's1',
        content: 'text1',
        content_hash: 'h1',
        embedding: null,
        timestamp: 1000,
        indexed_at: 2000,
      },
    ]);

    const progressCb = jest.fn();
    const config = { provider: 'openai', apiKey: 'test', model: 'text-embedding-3-small' } as any;

    const count = await batchEmbedChunks(config, progressCb);
    expect(count).toBe(1);
    expect(progressCb).toHaveBeenCalledWith(1, 1);
  });

  it('returns 0 when no chunks need embedding', async () => {
    mockGetAllSync.mockReturnValueOnce([]);
    const count = await batchEmbedChunks({} as any);
    expect(count).toBe(0);
  });
});

describe('indexMemoryToSqlite', () => {
  it('reads memory files and inserts chunks', async () => {
    const count = await indexMemoryToSqlite();
    expect(count).toBeGreaterThan(0);
    expect(mockRunSync).toHaveBeenCalled();
  });

  it('indexes conversation memory when requested', async () => {
    const { readConversationMemory } = require('../../src/services/memory/store');
    readConversationMemory.mockResolvedValueOnce('# Conversation\nScoped note');

    const count = await indexMemoryToSqlite(undefined, undefined, {
      scope: 'conversation',
      conversationId: 'conv-1',
    });

    expect(count).toBeGreaterThan(0);
    expect(mockRunSync).toHaveBeenCalledWith(
      expect.stringContaining('INSERT'),
      'conversation/conv-1/MEMORY.md',
      '# Conversation\nScoped note',
      expect.any(String),
      null,
      expect.any(Number),
      expect.any(Number),
      'conversation',
      'conv-1',
      null,
      null,
      'conversation:conv-1:MEMORY.md',
      'memory_file',
      1,
    );
  });
});

describe('sqliteHybridSearch', () => {
  it('returns scored results', async () => {
    mockGetAllSync.mockReturnValueOnce([
      {
        id: 1,
        source: 'notes.md',
        content: 'relevant content',
        content_hash: 'h1',
        embedding: '[0.1,0.2]',
        timestamp: Date.now(),
        indexed_at: Date.now(),
      },
    ]);

    const results = await sqliteHybridSearch('relevant', {});
    expect(Array.isArray(results)).toBe(true);
  });

  it('filters sqlite search results to conversation scope when requested', async () => {
    mockGetAllSync.mockReturnValueOnce([
      {
        id: 1,
        source: 'conversation/MEMORY.md',
        content: 'conversation scoped note',
        content_hash: 'h1',
        embedding: '[0.1,0.2]',
        timestamp: Date.now(),
        indexed_at: Date.now(),
        scope: 'conversation',
        conversation_id: 'conv-1',
        source_key: 'conversation:conv-1:MEMORY.md',
        source_kind: 'memory_file',
        version: 1,
        deleted_at: null,
      },
      {
        id: 2,
        source: 'MEMORY.md',
        content: 'global durable note',
        content_hash: 'h2',
        embedding: '[0.2,0.3]',
        timestamp: Date.now(),
        indexed_at: Date.now(),
        scope: 'global',
        conversation_id: null,
        source_key: 'global:MEMORY.md',
        source_kind: 'memory_file',
        version: 1,
        deleted_at: null,
      },
      {
        id: 3,
        source: 'conversation/conv-2/MEMORY.md',
        content: 'other conversation scoped note',
        content_hash: 'h3',
        embedding: '[0.2,0.4]',
        timestamp: Date.now(),
        indexed_at: Date.now(),
        scope: 'conversation',
        conversation_id: 'conv-2',
        source_key: 'conversation:conv-2:MEMORY.md',
        source_kind: 'memory_file',
        version: 1,
        deleted_at: null,
      },
    ]);

    const results = await sqliteHybridSearch(
      'scoped note',
      {},
      {
        scope: 'conversation',
        conversationId: 'conv-1',
      },
    );

    expect(results).toHaveLength(1);
    expect(results[0].scope).toBe('conversation');
    expect(results[0].source).toBe('conversation/MEMORY.md');
  });

  it('returns an empty result instead of legacy text fallback when no chunks exist', async () => {
    mockGetAllSync.mockReturnValue([]);

    const { searchMemory } = require('../../src/services/memory/store');
    searchMemory.mockResolvedValueOnce([{ source: 'file.md', snippet: 'text result', score: 0.8 }]);

    const results = await sqliteHybridSearch('query', {});

    expect(results).toEqual([]);
    expect(searchMemory).not.toHaveBeenCalled();
  });
});
