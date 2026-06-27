jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import {
  ensureFactSchema,
  resetFactSchemaCacheForTests,
} from '../../../src/services/memory/schema';
import { upsertEntity } from '../../../src/services/memory/entities';
import { recordFact } from '../../../src/services/memory/facts/mutations';
import { recallFactsForQuery } from '../../../src/services/memory/factRecall';
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
});

describe('recallFactsForQuery — UI observation context expansion', () => {
  it('includes the exact page inventory for a matched affordance state', async () => {
    const surface = upsertEntity({ name: 'surface:https://forum.example.test', type: 'surface' });
    const inventory = recordFact({
      subjectId: surface.id,
      predicate: 'ui_inventory',
      objectText: JSON.stringify({
        controlNames: ['Global navigation', 'Sidebar action'],
        url: 'https://forum.example.test/f/general',
        sourceRunId: 'run-ui-context',
        stateIndex: '4',
      }),
      memoryKind: 'ui_inventory',
      sourceRunId: 'run-ui-context',
      attributes: {
        url: 'https://forum.example.test/f/general',
        stateIndex: '4',
      },
      retrievability: 0.86,
    });
    recordFact({
      subjectId: surface.id,
      predicate: 'ui_affordance',
      objectText: JSON.stringify({
        role: 'DisclosureTriangle',
        name: 'Hide this forum',
        url: 'https://forum.example.test/f/general',
        sourceRunId: 'run-ui-context',
        stateIndex: '4',
      }),
      memoryKind: 'ui_affordance',
      sourceRunId: 'run-ui-context',
      attributes: {
        url: 'https://forum.example.test/f/general',
        stateIndex: '4',
      },
      retrievability: 0.98,
    });

    const facts = await recallFactsForQuery('Hide this forum', {
      memoryKind: ['ui_affordance', 'ui_inventory'],
      limit: 2,
    });

    expect(facts.map((fact) => fact.id)).toContain(inventory.fact.id);
  });

  it('deduplicates repeated UI inventories by page schema rather than volatile values', async () => {
    const surface = upsertEntity({ name: 'surface:https://forum.example.test', type: 'surface' });
    const first = recordFact({
      subjectId: surface.id,
      predicate: 'ui_inventory',
      objectText: JSON.stringify({
        controlNames: ['Home', 'Search', 'Submit'],
        fieldLabels: ['Search query'],
        searchControls: [{ name: 'Search', value: 'first' }],
      }),
      memoryKind: 'ui_inventory',
      sourceRunId: 'run-schema-dedupe',
      attributes: { url: 'https://forum.example.test/search', stateIndex: '1' },
      now: 1,
    }).fact;
    recordFact({
      subjectId: surface.id,
      predicate: 'ui_inventory',
      objectText: JSON.stringify({
        controlNames: ['Home', 'Search', 'Submit'],
        fieldLabels: ['Search query'],
        searchControls: [{ name: 'Search', value: 'second' }],
      }),
      memoryKind: 'ui_inventory',
      sourceRunId: 'run-schema-dedupe',
      attributes: { url: 'https://forum.example.test/search', stateIndex: '2' },
      now: 2,
    });

    const facts = await recallFactsForQuery('Search Submit', {
      memoryKind: 'ui_inventory',
      limit: 4,
      threshold: 0,
    });

    expect(
      facts.filter((fact) => fact.id === first.id || fact.sourceRunId === 'run-schema-dedupe'),
    ).toHaveLength(1);
  });
});
