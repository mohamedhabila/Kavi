import type * as SQLite from 'expo-sqlite';
import {
  effectRow,
  handleRow,
  insertCheckpoint,
  insertRun,
} from '../../src/services/executionJournal/mutationStore';
import type {
  ExecutionEffectRecord,
  ExecutionExternalHandleRecord,
} from '../../src/services/executionJournal/types';
import {
  RECOVERY_DIGEST_D,
  recoveryCheckpoint,
  recoveryEffect,
  recoveryHandle,
  recoveryInitialCheckpoint,
  recoveryRun,
} from './executionRecoveryFixtures';

export type ExecutionJournalTestDb = SQLite.SQLiteDatabase;

export function insertRecoveryEffect(
  database: ExecutionJournalTestDb,
  effect: ExecutionEffectRecord,
): void {
  database.runSync(
    `INSERT INTO execution_effects (
       id, run_id, checkpoint_id, tool_call_id, tool_name_digest, effect_class,
       idempotency_class, idempotency_key_digest, request_digest, outcome_digest,
       status, retry_policy, attempt, created_at, started_at, completed_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ...Object.values(effectRow(effect)),
  );
}

export function insertRecoveryHandle(
  database: ExecutionJournalTestDb,
  handle: ExecutionExternalHandleRecord,
): void {
  database.runSync(
    `INSERT INTO execution_external_handles (
       id, run_id, effect_id, handle_kind, locator_version, expo_project_id,
       github_repository, workflow_run_id, credential_ref,
       source_tool_name_digest, status, created_at, updated_at, last_verified_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ...Object.values(handleRow(handle)),
  );
}

export function seedOrderedRecoveryGraph(
  database: ExecutionJournalTestDb,
  reverseInsertionOrder = false,
): void {
  const run = recoveryRun({ status: 'running', updatedAt: 40 });
  const checkpoints = [
    recoveryInitialCheckpoint(),
    recoveryCheckpoint({ boundary: 'before_effect' }),
  ];
  const effects = [
    recoveryEffect('started', {
      id: 'effect-a',
      toolCallId: 'tool-call-a',
      idempotencyKeyDigest: RECOVERY_DIGEST_D,
      createdAt: 30,
      startedAt: 31,
      updatedAt: 31,
    }),
    recoveryEffect('started', {
      id: 'effect-b',
      toolCallId: 'tool-call-b',
      idempotencyKeyDigest: 'e'.repeat(64),
      createdAt: 31,
      startedAt: 32,
      updatedAt: 32,
    }),
  ];
  const handles = [
    recoveryHandle('pending', {
      id: 'handle-a',
      effectId: 'effect-a',
      locator: {
        version: 1,
        kind: 'expo_workflow_run',
        projectId: 'project-1',
        workflowRunId: 'workflow-run-a',
        credentialRef: 'EXPO_TOKEN',
      },
      createdAt: 35,
      updatedAt: 35,
      lastVerifiedAt: null,
    }),
    recoveryHandle('pending', {
      id: 'handle-b',
      effectId: 'effect-b',
      locator: {
        version: 1,
        kind: 'expo_workflow_run',
        projectId: 'project-1',
        workflowRunId: 'workflow-run-b',
        credentialRef: 'EXPO_TOKEN',
      },
      createdAt: 36,
      updatedAt: 36,
      lastVerifiedAt: null,
    }),
  ];
  const ordered = <T>(records: T[]): T[] =>
    reverseInsertionOrder ? [...records].reverse() : records;

  insertRun(database, run);
  for (const checkpoint of ordered(checkpoints)) insertCheckpoint(database, checkpoint);
  for (const effect of ordered(effects)) insertRecoveryEffect(database, effect);
  for (const handle of ordered(handles)) insertRecoveryHandle(database, handle);
}

export function seedOwnedRecoveryRun(
  database: ExecutionJournalTestDb,
  runId: string,
): { initialCheckpointId: string; workCheckpointId: string } {
  const suffix = runId.replace(/^run-/u, '');
  const taskId = `task-${suffix}`;
  const goalId = `goal-${suffix}`;
  const run = recoveryRun({
    id: runId,
    conversationId: `conversation-${suffix}`,
    threadId: `thread-${suffix}`,
    taskId,
    goalId,
    requestMessageId: `message-${suffix}`,
    status: 'running',
  });
  const initialCheckpointId = `checkpoint-${suffix}-0`;
  const workCheckpointId = `checkpoint-${suffix}-1`;
  insertRun(database, run);
  insertCheckpoint(
    database,
    recoveryInitialCheckpoint({
      id: initialCheckpointId,
      runId,
      taskId,
      goalId,
    }),
  );
  insertCheckpoint(
    database,
    recoveryCheckpoint({
      id: workCheckpointId,
      runId,
      taskId,
      goalId,
      boundary: 'before_effect',
    }),
  );
  return { initialCheckpointId, workCheckpointId };
}
