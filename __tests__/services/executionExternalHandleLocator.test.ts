jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import {
  closeExecutionJournalDb,
  getExecutionJournalDb,
} from '../../src/services/executionJournal/database';
import { decodeExecutionExternalHandleRow } from '../../src/services/executionJournal/decoders';
import { registerExecutionExternalHandle } from '../../src/services/executionJournal/mutations';
import {
  insertSchemaCheckpoint,
  insertSchemaEffect,
  insertSchemaHandle,
  insertSchemaRun,
  seedCompleteSchemaRun,
} from '../helpers/executionJournalSchemaFixtures';
import {
  DIGEST_A,
  seedPlannedFixtureEffect,
  startFixtureEffect,
} from '../helpers/executionJournalMutationFixtures';

const sqliteMock = jest.requireMock('expo-sqlite') as { __resetExpoSqliteForTests: () => void };

const mobileLocator = (suffix: string) => ({
  version: 1 as const,
  kind: 'mobile_controller_handoff' as const,
  handoffId: `mch_${suffix.repeat(32)}`,
  controllerId: 'mobile-controller-1',
  controllerContractVersion: 1,
  capabilityDigest: `sha256:${'a'.repeat(64)}` as const,
  actionDigest: `sha256:${'b'.repeat(64)}` as const,
  beforeObservationId: 'observation-1',
  beforeObservationDigest: `sha256:${'c'.repeat(64)}` as const,
  expiresAt: 60_000,
});

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

describe('execution external handle locator storage', () => {
  it('decodes GitHub repositories only from canonical locator JSON', () => {
    const database = getExecutionJournalDb();
    seedCompleteSchemaRun(database);
    database.runSync('DELETE FROM execution_external_handles');
    insertSchemaHandle(database, {
      handle_kind: 'github_workflow_run',
      locator_json: JSON.stringify({
        version: 1,
        kind: 'github_workflow_run',
        repository: 'OpenAI/Kavi-Mobile',
        workflowRunId: '12345',
        credentialRef: 'GITHUB_TOKEN',
      }),
    });
    expect(() =>
      decodeExecutionExternalHandleRow(
        database.getFirstSync('SELECT * FROM execution_external_handles'),
      ),
    ).toThrow('execution_journal_malformed_row:external_handle:locator');

    database.runSync('DELETE FROM execution_external_handles');
    insertSchemaHandle(database, {
      handle_kind: 'github_workflow_run',
      locator_json: JSON.stringify({
        version: 1,
        kind: 'github_workflow_run',
        repository: 'openai/kavi-mobile',
        workflowRunId: '12345',
        credentialRef: 'GITHUB_TOKEN',
      }),
    });
    expect(
      decodeExecutionExternalHandleRow(
        database.getFirstSync('SELECT * FROM execution_external_handles'),
      ).locator,
    ).toEqual({
      version: 1,
      kind: 'github_workflow_run',
      repository: 'openai/kavi-mobile',
      workflowRunId: '12345',
      credentialRef: 'GITHUB_TOKEN',
    });
  });

  it('allows at most one unresolved mobile handoff per run', () => {
    const database = getExecutionJournalDb();
    insertSchemaRun(database);
    insertSchemaCheckpoint(database);
    insertSchemaEffect(database);
    insertSchemaEffect(database, { id: 'effect-2', tool_call_id: 'tool-call-2', attempt: 2 });
    insertSchemaHandle(database, {
      handle_kind: 'mobile_controller_handoff',
      locator_json: JSON.stringify(mobileLocator('a')),
    });
    expect(() =>
      insertSchemaHandle(database, {
        id: 'handle-2',
        effect_id: 'effect-2',
        handle_kind: 'mobile_controller_handoff',
        locator_json: JSON.stringify(mobileLocator('b')),
      }),
    ).toThrow();

    database.runSync(
      `UPDATE execution_external_handles
       SET status = 'failed', updated_at = 11, last_attempted_at = 11,
           last_verified_at = 11
       WHERE id = 'handle-1'`,
    );
    expect(() =>
      insertSchemaHandle(database, {
        id: 'handle-2',
        effect_id: 'effect-2',
        handle_kind: 'mobile_controller_handoff',
        locator_json: JSON.stringify(mobileLocator('b')),
        created_at: 11,
        updated_at: 11,
        last_attempted_at: 11,
      }),
    ).not.toThrow();
  });

  it('round-trips bounded mobile identity and rejects payload extensions', () => {
    seedPlannedFixtureEffect();
    startFixtureEffect();
    const locator = mobileLocator('a');
    expect(
      registerExecutionExternalHandle({
        id: 'handle-mobile',
        monitorId: 'monitor-mobile',
        runId: 'run-1',
        effectId: 'effect-1',
        expectedControlEpoch: 0,
        locator,
        sourceToolNameDigest: DIGEST_A,
        status: 'pending',
        createdAt: 15,
      }),
    ).toEqual(expect.objectContaining({ locator, status: 'pending' }));

    const stored = getExecutionJournalDb().getFirstSync<{ locator_json: string }>(
      'SELECT locator_json FROM execution_external_handles WHERE id = ?',
      'handle-mobile',
    );
    expect(stored?.locator_json).toBe(JSON.stringify(locator));
    expect(stored?.locator_json).not.toMatch(/claimToken|"action"|screenshot|"text"/u);
    expect(() =>
      registerExecutionExternalHandle({
        id: 'handle-mobile-extra',
        monitorId: 'monitor-mobile-extra',
        runId: 'run-1',
        effectId: 'effect-1',
        expectedControlEpoch: 0,
        locator: { ...mobileLocator('b'), action: 'raw' } as never,
        sourceToolNameDigest: DIGEST_A,
        status: 'pending',
        createdAt: 16,
      }),
    ).toThrow('execution_journal_invalid_external_handle_locator');
  });
});
