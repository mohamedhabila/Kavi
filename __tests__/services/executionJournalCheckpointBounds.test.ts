jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import {
  closeExecutionJournalDb,
  getExecutionJournalDb,
} from '../../src/services/executionJournal/database';
import { appendExecutionCheckpoint } from '../../src/services/executionJournal/mutations';
import { MAX_EXECUTION_CHECKPOINTS_PER_RUN } from '../../src/services/executionJournal/types';
import {
  DIGEST_C,
  seedExecutionRun,
  startExecutionRun,
} from '../helpers/executionJournalMutationFixtures';

const sqliteMock = jest.requireMock('expo-sqlite') as { __resetExpoSqliteForTests: () => void };

beforeEach(() => {
  try {
    closeExecutionJournalDb();
  } catch {}
  sqliteMock.__resetExpoSqliteForTests();
});

afterEach(() => {
  try {
    closeExecutionJournalDb();
  } catch {}
});

it('fails closed at the bounded checkpoint history limit without truncating recovery state', () => {
  seedExecutionRun();
  startExecutionRun();
  const append = (sequence: number, id = `checkpoint-${sequence}`) =>
    appendExecutionCheckpoint({
      id,
      runId: 'run-1',
      expectedControlEpoch: 0,
      taskId: 'task-1',
      goalId: 'goal-1',
      phase: 'work',
      boundary: 'safe_yield',
      stateRefId: `state-${sequence}`,
      stateDigest: DIGEST_C,
      resumeStrategy: 'replay_safe',
      approvalState: 'not_required',
      permissionState: 'granted',
      createdAt: 12,
    });

  for (let sequence = 1; sequence < MAX_EXECUTION_CHECKPOINTS_PER_RUN; sequence += 1) {
    append(sequence);
  }

  expect(() => append(MAX_EXECUTION_CHECKPOINTS_PER_RUN, 'checkpoint-overflow')).toThrow(
    'execution_journal_checkpoint_limit_exceeded',
  );
  expect(
    getExecutionJournalDb().getFirstSync<{ count: number }>(
      'SELECT COUNT(*) AS count FROM execution_checkpoints WHERE run_id = ?',
      'run-1',
    )?.count,
  ).toBe(MAX_EXECUTION_CHECKPOINTS_PER_RUN);
});
