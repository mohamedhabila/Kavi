jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import { upsertEntity } from '../../../src/services/memory/entities';
import { recordFact } from '../../../src/services/memory/facts/mutations';
import { listFactsForSourceRunForwardWindows } from '../../../src/services/memory/facts/queries';
import type { MemoryFact } from '../../../src/services/memory/facts/types';
import { insertWorkflowUiSupport } from '../../../src/services/memory/factRecallWorkflowUiSupport';
import type { ScoredFact } from '../../../src/services/memory/factRecallTypes';
import { countLexicalUnits } from '../../../src/services/memory/ranking/lexical';
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

function scoredFact(fact: MemoryFact): ScoredFact {
  return {
    fact,
    score: 1,
    textScore: 1,
    lexicalScore: 1,
    pinnedBoost: 0,
    decayMultiplier: 1,
    scopeBoost: 0,
    reinforcementBoost: 0,
    importanceScore: 0,
    retrievabilityScore: 0,
    quotedUiControlBoost: 0,
    surfaceLabelBoost: 0,
    surfaceIdentityScore: 0,
    visibleTextEvidenceBoost: 0,
    relevanceScore: 1,
  };
}

describe('listFactsForSourceRunForwardWindows', () => {
  it('keeps precise state facts available alongside broad state inventories', () => {
    const corpus = upsertEntity({ name: 'state-kind-window-corpus', type: 'concept' });
    const inventory = recordFact({
      subjectId: corpus.id,
      predicate: 'ui_inventory',
      objectText: JSON.stringify({
        controlNames: ['qstatewindow-coarse'],
        url: 'https://mobile.example.test/thread',
        sourceRunId: 'run-state-kind-window',
        stateIndex: '2',
      }),
      sourceRunId: 'run-state-kind-window',
      memoryKind: 'ui_inventory',
      attributes: { stateIndex: 2 },
      retrievability: 0.99,
      now: 1_000,
    }).fact;
    const preciseField = recordFact({
      subjectId: corpus.id,
      predicate: 'ui_field',
      objectText: JSON.stringify({
        role: 'button',
        controlName: 'qstatewindow-precise',
        options: ['qstatewindow-alpha', 'qstatewindow-beta'],
        expanded: true,
        url: 'https://mobile.example.test/thread',
        sourceRunId: 'run-state-kind-window',
        stateIndex: '2',
      }),
      sourceRunId: 'run-state-kind-window',
      memoryKind: 'ui_field',
      attributes: { stateIndex: 2 },
      retrievability: 0.6,
      now: 1_100,
    }).fact;

    const selectedIds = listFactsForSourceRunForwardWindows(
      [{ sourceRunId: 'run-state-kind-window', stateIndex: 1 }],
      {
        memoryKind: ['ui_inventory', 'ui_field'],
        forwardRadius: 4,
        limit: 8,
        stateLimit: 8,
      },
    ).map((fact) => fact.id);

    expect(selectedIds).toContain(inventory.id);
    expect(selectedIds).toContain(preciseField.id);
  });

  it('keeps adjacent action-result continuations with an admitted action support fact', () => {
    const corpus = upsertEntity({ name: 'action-continuation-window-corpus', type: 'concept' });
    const sourceRunId = 'run-action-continuation-window';
    const anchor = recordFact({
      subjectId: corpus.id,
      predicate: 'ui_field',
      objectText: JSON.stringify({
        role: 'button',
        controlName: 'qactionwindow-anchor',
        sourceRunId,
        stateIndex: '0',
      }),
      sourceRunId,
      memoryKind: 'ui_field',
      attributes: { stateIndex: 0 },
      now: 1_000,
    }).fact;
    const firstAction = recordFact({
      subjectId: corpus.id,
      predicate: 'ui_action_result',
      objectText: JSON.stringify({
        action: 'qactionwindow-anchor qactionwindow-first',
        thought: 'qactionwindow-anchor qactionwindow-first',
        sourceRunId,
        stateIndex: '1',
        previousStateIndex: '0',
      }),
      sourceRunId,
      memoryKind: 'outcome',
      attributes: { stateIndex: 1, previousStateIndex: 0 },
      now: 1_100,
    }).fact;
    const continuation = recordFact({
      subjectId: corpus.id,
      predicate: 'ui_action_result',
      objectText: JSON.stringify({
        action: 'qactionwindow-second',
        thought: 'qactionwindow-second',
        sourceRunId,
        stateIndex: '2',
        previousStateIndex: '1',
      }),
      sourceRunId,
      memoryKind: 'outcome',
      attributes: { stateIndex: 2, previousStateIndex: 1 },
      now: 1_200,
    }).fact;
    const sameStateUiField = recordFact({
      subjectId: corpus.id,
      predicate: 'ui_field',
      objectText: JSON.stringify({
        role: 'button',
        controlName: 'qactionwindow-second-surface',
        sourceRunId,
        stateIndex: '2',
      }),
      sourceRunId,
      memoryKind: 'ui_field',
      attributes: { stateIndex: 2 },
      retrievability: 1,
      now: 1_300,
    }).fact;

    const query = 'qactionwindow-anchor';
    const lexicalUnits = Array.from(countLexicalUnits(query).keys());
    const unitWeights = new Map(lexicalUnits.map((unit) => [unit, 1]));
    const selected = [anchor];
    const seenIds = new Set([anchor.id]);
    const scoredById = new Map([[anchor.id, scoredFact(anchor)]]);

    insertWorkflowUiSupport({
      selected,
      seenIds,
      seenUiSupportDiversityKeys: new Set(),
      seenUiSupportDiversitySourceKeys: new Set(),
      scoredById,
      scored: [scoredFact(anchor)],
      limit: 4,
      reservedSupportSlots: 3,
      candidateScopes: undefined,
      options: {},
      scoringQueryUnits: new Set(lexicalUnits),
      recallLexicalUnits: lexicalUnits,
      unitWeights,
      query,
      anchorUnitSets: [],
      alwaysIncludePinned: false,
      now: 2_000,
      addSelectedSupportFact: (fact, supportLimit) => {
        if (seenIds.has(fact.id) || selected.length >= supportLimit) return false;
        seenIds.add(fact.id);
        selected.push(fact);
        return true;
      },
    });

    const selectedIds = selected.map((fact) => fact.id);

    expect(selectedIds).toContain(firstAction.id);
    expect(selectedIds).toContain(continuation.id);
    expect(selectedIds).not.toContain(sameStateUiField.id);
  });
});
