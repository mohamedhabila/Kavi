jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import { Directory, File, Paths } from 'expo-file-system';
import * as SQLite from 'expo-sqlite';
import { closeMemoryDb, getMemoryDb } from '../../../src/services/memory/database';
import { removeRetiredMemoryFileArtifacts } from '../../../src/services/memory/retiredMemoryArtifacts';

const expoFileSystem = jest.requireMock('expo-file-system') as {
  __resetStore: () => void;
};
const expoSqlite = jest.requireMock('expo-sqlite') as {
  __resetExpoSqliteForTests: () => void;
};

beforeEach(() => {
  closeMemoryDb();
  expoSqlite.__resetExpoSqliteForTests();
  expoFileSystem.__resetStore();
});

afterEach(() => {
  closeMemoryDb();
});

describe('retired memory artifact cleanup', () => {
  it('drops the retired chunk table before returning the canonical database', () => {
    const database = SQLite.openDatabaseSync('kavi-memory.db');
    database.execSync('CREATE TABLE memory_chunks (id TEXT PRIMARY KEY)');

    const canonicalDatabase = getMemoryDb();

    expect(
      canonicalDatabase.getFirstSync<{ name: string }>(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'memory_chunks'",
      ),
    ).toBeNull();
  });

  it('deletes only the retired Markdown memory directories', () => {
    const globalMemory = new Directory(Paths.document, 'global-memory');
    const conversationMemory = new Directory(Paths.document, 'conversation-memory');
    const unrelated = new Directory(Paths.document, 'workspace');
    globalMemory.create();
    conversationMemory.create();
    unrelated.create();
    const unrelatedFile = new File(unrelated, 'keep.txt');
    unrelatedFile.write('keep');

    removeRetiredMemoryFileArtifacts();

    expect(globalMemory.exists).toBe(false);
    expect(conversationMemory.exists).toBe(false);
    expect(unrelated.exists).toBe(true);
    expect(unrelatedFile.exists).toBe(true);
  });

  it('attempts every retired directory before reporting a deletion failure', () => {
    const globalMemory = new Directory(Paths.document, 'global-memory');
    const conversationMemory = new Directory(Paths.document, 'conversation-memory');
    globalMemory.create();
    conversationMemory.create();
    const originalDelete = Directory.prototype.delete;
    const deleteSpy = jest.spyOn(Directory.prototype, 'delete').mockImplementation(function () {
      if (this.name === 'global-memory') {
        throw new Error('directory busy');
      }
      return originalDelete.call(this);
    });

    expect(() => removeRetiredMemoryFileArtifacts()).toThrow('directory busy');

    expect(globalMemory.exists).toBe(true);
    expect(conversationMemory.exists).toBe(false);
    deleteSpy.mockRestore();
  });
});
