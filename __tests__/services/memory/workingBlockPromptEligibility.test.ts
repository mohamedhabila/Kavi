jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import {
  ensureFactSchema,
  resetFactSchemaCacheForTests,
} from '../../../src/services/memory/schema';
import { closeMemoryDb, getMemoryDb } from '../../../src/services/memory/sqlite-store';
import {
  buildWorkingBlockScopeKey,
  editPromptEligibleWorkingBlock,
  editWorkingBlock,
  getWorkingBlock,
} from '../../../src/services/memory/workingBlocks';

const expoSqlite = require('expo-sqlite') as { __resetExpoSqliteForTests: () => void };

beforeEach(() => {
  closeMemoryDb();
  expoSqlite.__resetExpoSqliteForTests();
  resetFactSchemaCacheForTests();
});

afterEach(() => {
  closeMemoryDb();
});

describe('working-block prompt eligibility', () => {
  it('migrates existing rows to untrusted instead of implicitly admitting them', () => {
    const db = getMemoryDb();
    db.execSync(`
      CREATE TABLE memory_working_blocks (
        label TEXT NOT NULL,
        scope_key TEXT NOT NULL,
        conversation_id TEXT,
        thread_id TEXT,
        task_id TEXT,
        content TEXT NOT NULL DEFAULT '',
        char_limit INTEGER NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (label, scope_key)
      );
    `);
    db.runSync(
      `INSERT INTO memory_working_blocks(
         label, scope_key, conversation_id, thread_id, task_id,
         content, char_limit, description, updated_at
       ) VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?)`,
      'active_focus',
      'conversation:migration-conversation|thread:migration-thread|task:',
      'migration-conversation',
      'migration-thread',
      'pre-policy-content',
      800,
      'legacy row',
      1_000,
    );

    ensureFactSchema();

    expect(
      getWorkingBlock('active_focus', {
        conversationId: 'migration-conversation',
        threadId: 'migration-thread',
      })?.promptEligibility,
    ).toBe('untrusted');
  });

  it('keeps generic writes untrusted and marks only the narrow structural writer trusted', () => {
    ensureFactSchema();
    const scope = { conversationId: 'working-conversation', threadId: 'working-thread' };

    expect(editWorkingBlock('active_focus', 'generic content', scope).promptEligibility).toBe(
      'untrusted',
    );
    expect(
      editPromptEligibleWorkingBlock('active_focus', 'structural content', scope).promptEligibility,
    ).toBe('trusted_structural');
  });

  it('rejects whitespace-normalized scope aliases instead of changing identity', () => {
    ensureFactSchema();
    expect(() =>
      buildWorkingBlockScopeKey({
        conversationId: ' exact-conversation',
        threadId: 'exact-thread',
      }),
    ).toThrow('working_block_conversation_id_invalid');
  });
});
