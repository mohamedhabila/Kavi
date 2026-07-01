// ---------------------------------------------------------------------------
// Tests — Same-state workflow support recall
// ---------------------------------------------------------------------------

jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import { upsertEntity } from '../../../src/services/memory/entities';
import { recallFactsForQuery } from '../../../src/services/memory/factRecall';
import { recordFact } from '../../../src/services/memory/facts/mutations';
import {
  ensureFactSchema,
  resetFactSchemaCacheForTests,
} from '../../../src/services/memory/schema';
import { closeMemoryDb } from '../../../src/services/memory/sqlite-store';

const expoSqlite = require('expo-sqlite') as { __resetExpoSqliteForTests: () => void };

beforeEach(() => {
  closeMemoryDb();
  expoSqlite.__resetExpoSqliteForTests();
  resetFactSchemaCacheForTests();
  ensureFactSchema();
});

afterEach(() => {
  closeMemoryDb();
  expoSqlite.__resetExpoSqliteForTests();
});

describe('recallFactsForQuery - same-state workflow support', () => {
  it('adds same-state structured UI support for selected action outcomes', async () => {
    const corpus = upsertEntity({ name: 'same-state-outcome-support-corpus', type: 'concept' });
    const sourceRunId = 'run-same-state-outcome-support';
    const outcome = recordFact({
      subjectId: corpus.id,
      predicate: 'selected_action_result',
      objectText: JSON.stringify({
        action: 'tap(qaction)',
        thought: 'qstateanchor qsurface',
        sourceRunId,
        stateIndex: '4',
        visibleTextSnippets: [{ text: 'qstateanchor qsurface' }],
      }),
      sourceRunId,
      memoryKind: 'outcome',
      attributes: { stateIndex: 4 },
      now: 1_000,
    }).fact;
    const optionField = recordFact({
      subjectId: corpus.id,
      predicate: 'same_state_options',
      objectText: JSON.stringify({
        role: 'button',
        name: 'qcontrol',
        options: ['qchoice-a', 'qchoice-b', 'qchoice-c'],
        expanded: true,
        sourceRunId,
        stateIndex: '4',
      }),
      sourceRunId,
      memoryKind: 'ui_field',
      attributes: { stateIndex: 4 },
      now: 2_000,
    }).fact;

    const facts = await recallFactsForQuery('qstateanchor qsurface', {
      limit: 12,
      threshold: 0.01,
      candidatePoolLimit: 40,
      now: 3_000,
    });
    const selectedIds = facts.map((fact) => fact.id);

    expect(selectedIds).toContain(outcome.id);
    expect(selectedIds).toContain(optionField.id);
  });
});
