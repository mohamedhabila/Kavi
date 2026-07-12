jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import { closeMemoryDb, getMemoryDb } from '../../../src/services/memory/database';
import {
  ensureFactSchema,
  resetFactSchemaCacheForTests,
} from '../../../src/services/memory/schema';

const expoSqlite = require('expo-sqlite') as { __resetExpoSqliteForTests: () => void };

beforeEach(() => {
  closeMemoryDb();
  expoSqlite.__resetExpoSqliteForTests();
  resetFactSchemaCacheForTests();
});

afterEach(() => {
  closeMemoryDb();
  jest.restoreAllMocks();
});

function columnNames(table: string): string[] {
  return getMemoryDb()
    .getAllSync<{ name: string }>(`PRAGMA table_info(${table})`)
    .map((row) => row.name);
}

function indexNames(table: string): string[] {
  return getMemoryDb()
    .getAllSync<{ name: string }>(`PRAGMA index_list(${table})`)
    .map((row) => row.name);
}

describe('ingestion queue schema migration', () => {
  it('migrates ingestion jobs to bounded durable states without retaining raw errors', () => {
    ensureFactSchema();
    const freshIndexes = indexNames('memory_ingestion_jobs').sort();

    closeMemoryDb();
    expoSqlite.__resetExpoSqliteForTests();
    resetFactSchemaCacheForTests();
    getMemoryDb().execSync(`
      CREATE TABLE memory_ingestion_jobs (
        id TEXT PRIMARY KEY,
        thread_id TEXT NOT NULL,
        memory_conversation_id TEXT,
        task_id TEXT,
        source_start_message_id TEXT,
        source_end_message_id TEXT NOT NULL,
        reason TEXT NOT NULL DEFAULT 'turn_completed',
        status TEXT NOT NULL DEFAULT 'pending',
        attempt_count INTEGER NOT NULL DEFAULT 0,
        provider_enrichment INTEGER NOT NULL DEFAULT 1,
        error TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        completed_at INTEGER
      );
      INSERT INTO memory_ingestion_jobs VALUES
        ('pending-job', 'thread-1', NULL, NULL, 'u-1', 'a-1', 'turn_completed',
         'pending', 0, 1, 'raw provider response', 1, 2, NULL),
        ('stale-job', 'thread-2', 'memory-2', NULL, 'u-2', 'a-2', 'turn_completed',
         'processing', 2, 1, 'secret exception text', 3, 4, NULL),
        ('completed-job', 'thread-3', 'memory-3', NULL, 'u-3', 'a-3', 'turn_completed',
         'completed', 1, 1, 'old silent success', 5, 6, 7),
        ('duplicate-pending-job', 'thread-3', 'memory-3', NULL, 'u-3', 'a-3', 'turn_completed',
         'pending', 0, 1, 'duplicate callback', 5, 8, NULL);
    `);

    ensureFactSchema();

    expect(indexNames('memory_ingestion_jobs').sort()).toEqual(freshIndexes);
    expect(columnNames('memory_ingestion_jobs')).toEqual(
      expect.arrayContaining([
        'thread_title',
        'persona_id',
        'claim_token',
        'source_at',
        'provider_outcome',
        'outcome_code',
        'next_attempt_at',
        'lease_expires_at',
        'structural_completed_at',
        'source_run_id',
        'chat_provider_id',
        'chat_model',
        'prior_user_message_id',
      ]),
    );
    expect(
      getMemoryDb()
        .getAllSync<{ name: string; notnull: number }>('PRAGMA table_info(memory_ingestion_jobs)')
        .find((column) => column.name === 'memory_conversation_id')?.notnull,
    ).toBe(1);
    expect(columnNames('memory_ingestion_jobs')).not.toContain('error');
    expect(
      getMemoryDb().getAllSync<{
        id: string;
        status: string;
        provider_outcome: string | null;
        outcome_code: string | null;
        next_attempt_at: number | null;
        structural_completed_at: number | null;
        persona_id: string | null;
      }>(
        `SELECT id, status, provider_outcome, outcome_code, next_attempt_at, persona_id,
                structural_completed_at
           FROM memory_ingestion_jobs
          ORDER BY id`,
      ),
    ).toEqual([
      {
        id: 'completed-job',
        status: 'completed_structural',
        provider_outcome: 'structural_only',
        outcome_code: null,
        next_attempt_at: null,
        structural_completed_at: 7,
        persona_id: null,
      },
      {
        id: 'pending-job',
        status: 'failed',
        provider_outcome: null,
        outcome_code: 'persona_scope_missing',
        next_attempt_at: null,
        structural_completed_at: null,
        persona_id: null,
      },
      {
        id: 'stale-job',
        status: 'failed',
        provider_outcome: null,
        outcome_code: 'persona_scope_missing',
        next_attempt_at: null,
        structural_completed_at: null,
        persona_id: null,
      },
    ]);
    expect(() =>
      getMemoryDb().runSync(
        "UPDATE memory_ingestion_jobs SET outcome_code = 'raw exception text' WHERE id = 'pending-job'",
      ),
    ).toThrow();
    expect(() =>
      getMemoryDb().runSync(
        "UPDATE memory_ingestion_jobs SET status = 'completed' WHERE id = 'pending-job'",
      ),
    ).toThrow();
    expect(() =>
      getMemoryDb().runSync(
        "UPDATE memory_ingestion_jobs SET status = 'completed_structural' WHERE id = 'pending-job'",
      ),
    ).toThrow();
    expect(() =>
      getMemoryDb().runSync(
        `INSERT INTO memory_ingestion_jobs (
           id, thread_id, memory_conversation_id, source_end_message_id,
           created_at, updated_at
         ) VALUES ('invalid-null-memory', 'thread-null', NULL, 'assistant-null', 1, 1)`,
      ),
    ).toThrow();
  });

  it('rebuilds an intermediate queue schema without adopting unsealed active identity', () => {
    ensureFactSchema();
    closeMemoryDb();
    expoSqlite.__resetExpoSqliteForTests();
    resetFactSchemaCacheForTests();
    getMemoryDb().execSync(`
      CREATE TABLE memory_ingestion_jobs (
        id TEXT PRIMARY KEY,
        thread_id TEXT NOT NULL,
        thread_title TEXT,
        memory_conversation_id TEXT NOT NULL,
        persona_id TEXT,
        task_id TEXT,
        source_run_id TEXT,
        chat_provider_id TEXT,
        chat_model TEXT,
        source_start_message_id TEXT,
        source_end_message_id TEXT NOT NULL,
        source_at INTEGER,
        reason TEXT NOT NULL,
        status TEXT NOT NULL,
        attempt_count INTEGER NOT NULL,
        provider_enrichment INTEGER NOT NULL,
        provider_outcome TEXT,
        outcome_code TEXT,
        next_attempt_at INTEGER,
        lease_expires_at INTEGER,
        claim_token TEXT,
        structural_completed_at INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        completed_at INTEGER
      );
      INSERT INTO memory_ingestion_jobs (
        id, thread_id, thread_title, memory_conversation_id, persona_id, task_id,
        source_run_id, chat_provider_id, chat_model, source_start_message_id,
        source_end_message_id, source_at, reason, status, attempt_count,
        provider_enrichment, provider_outcome, outcome_code, next_attempt_at,
        lease_expires_at, claim_token, structural_completed_at, created_at, updated_at,
        completed_at
      ) VALUES
        ('valid-pending', 'thread-valid', NULL, 'root-valid', 'default', NULL,
         NULL, NULL, NULL, 'user-valid', 'assistant-valid', 10, 'turn_completed',
         'pending', 0, 1, NULL, NULL, 10, NULL, NULL, NULL, 10, 10, NULL),
        ('blank-root', 'thread-blank-root', NULL, '', 'default', NULL,
         NULL, NULL, NULL, 'user-blank-root', 'assistant-blank-root', 11,
         'turn_completed', 'pending', 0, 1, NULL, NULL, 11, NULL, NULL, NULL,
         11, 11, NULL),
        ('missing-source-clock', 'thread-missing-clock', NULL, 'root-missing-clock',
         'default', NULL, NULL, NULL, NULL, 'user-missing-clock',
         'assistant-missing-clock', NULL, 'turn_completed', 'pending', 0, 1,
         NULL, NULL, 12, NULL, NULL, NULL, 12, 12, NULL),
        ('provider-pair-mismatch', 'thread-provider-mismatch', NULL,
         'root-provider-mismatch', 'default', NULL, NULL, NULL, 'orphan-model',
         'user-provider-mismatch', 'assistant-provider-mismatch', 13,
         'turn_completed', 'pending', 0, 1, NULL, NULL, 13, NULL, NULL, NULL,
         13, 13, NULL),
        ('invalid-policy', 'thread-invalid-policy', NULL, 'root-invalid-policy',
         'default', NULL, NULL, NULL, NULL, 'user-invalid-policy',
         'assistant-invalid-policy', 14, 'future_reason', 'pending', 0, 2,
         NULL, NULL, 14, NULL, NULL, NULL, 14, 14, NULL),
        ('existing-invalid', 'thread-existing-invalid', NULL, 'root-existing-invalid',
         'default', NULL, NULL, NULL, NULL, 'user-existing-invalid',
         'assistant-existing-invalid', 15, 'manual', 'failed', 1, 0, NULL,
         'source_identity_invalid', NULL, NULL, NULL, NULL, 15, 15, 15),
        ('existing-conflict', 'thread-existing-conflict', NULL, 'root-existing-conflict',
         'default', NULL, NULL, NULL, NULL, 'user-existing-conflict',
         'assistant-existing-conflict', 16, 'manual', 'failed', 1, 0, NULL,
         'source_identity_conflict', NULL, NULL, NULL, NULL, 16, 16, 16);
    `);

    ensureFactSchema();

    expect(
      getMemoryDb().getAllSync<{
        id: string;
        status: string;
        outcome_code: string | null;
        memory_conversation_id: string;
        source_at: number;
        reason: string;
        provider_enrichment: number;
        chat_provider_id: string | null;
        chat_model: string | null;
      }>(
        `SELECT id, status, outcome_code, memory_conversation_id, source_at, reason,
                provider_enrichment, chat_provider_id, chat_model
           FROM memory_ingestion_jobs
          ORDER BY id`,
      ),
    ).toEqual([
      {
        id: 'blank-root',
        status: 'failed',
        outcome_code: 'source_identity_invalid',
        memory_conversation_id: 'thread-blank-root',
        source_at: 11,
        reason: 'turn_completed',
        provider_enrichment: 1,
        chat_provider_id: null,
        chat_model: null,
      },
      {
        id: 'existing-conflict',
        status: 'failed',
        outcome_code: 'source_identity_conflict',
        memory_conversation_id: 'root-existing-conflict',
        source_at: 16,
        reason: 'manual',
        provider_enrichment: 0,
        chat_provider_id: null,
        chat_model: null,
      },
      {
        id: 'existing-invalid',
        status: 'failed',
        outcome_code: 'source_identity_invalid',
        memory_conversation_id: 'root-existing-invalid',
        source_at: 15,
        reason: 'manual',
        provider_enrichment: 0,
        chat_provider_id: null,
        chat_model: null,
      },
      {
        id: 'invalid-policy',
        status: 'failed',
        outcome_code: 'source_identity_invalid',
        memory_conversation_id: 'root-invalid-policy',
        source_at: 14,
        reason: 'manual',
        provider_enrichment: 0,
        chat_provider_id: null,
        chat_model: null,
      },
      {
        id: 'missing-source-clock',
        status: 'failed',
        outcome_code: 'source_identity_invalid',
        memory_conversation_id: 'root-missing-clock',
        source_at: 12,
        reason: 'turn_completed',
        provider_enrichment: 1,
        chat_provider_id: null,
        chat_model: null,
      },
      {
        id: 'provider-pair-mismatch',
        status: 'failed',
        outcome_code: 'source_identity_invalid',
        memory_conversation_id: 'root-provider-mismatch',
        source_at: 13,
        reason: 'turn_completed',
        provider_enrichment: 1,
        chat_provider_id: null,
        chat_model: null,
      },
      {
        id: 'valid-pending',
        status: 'failed',
        outcome_code: 'source_identity_invalid',
        memory_conversation_id: 'root-valid',
        source_at: 10,
        reason: 'turn_completed',
        provider_enrichment: 1,
        chat_provider_id: null,
        chat_model: null,
      },
    ]);
  });
});
