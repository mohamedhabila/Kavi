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
import {
  recallFactsForQuery,
  recallScoredFactsForQuery,
} from '../../../src/services/memory/factRecall';
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

  it('annotates exact quoted control-label evidence for retrieved UI inventories', async () => {
    const surface = upsertEntity({ name: 'surface:https://app.example.test', type: 'surface' });
    recordFact({
      subjectId: surface.id,
      predicate: 'ui_inventory',
      objectText: JSON.stringify({
        controlNames: ['Archive Item', 'Share Item'],
        url: 'https://app.example.test/items/1',
        sourceRunId: 'run-ui-quoted-labels',
        stateIndex: '7',
      }),
      memoryKind: 'ui_inventory',
      sourceRunId: 'run-ui-quoted-labels',
      attributes: {
        url: 'https://app.example.test/items/1',
        stateIndex: '7',
      },
      retrievability: 0.98,
    });

    const facts = await recallFactsForQuery(
      'What happens after tapping "Archive Item" or "Delete Item"?',
      {
        memoryKind: 'ui_inventory',
        limit: 1,
        threshold: 0,
      },
    );

    expect(facts).toHaveLength(1);
    expect(facts[0].attributes.queryQuotedControlLabelEvidence).toEqual({
      matched: [{ requested: 'Archive Item', observed: 'Archive Item' }],
    });
  });

  it('annotates exact quoted control-label evidence for retrieved action-result memories', async () => {
    const surface = upsertEntity({ name: 'surface:https://app.example.test/actions', type: 'surface' });
    recordFact({
      subjectId: surface.id,
      predicate: 'ui_action_result',
      objectText: JSON.stringify({
        action: "click('qquoted-node')",
        thought: 'qquoted-action-result',
        actionControls: [{ nodeId: 'qquoted-node', role: 'button', name: 'qquoted-control' }],
        sourceRunId: 'run-action-result-quoted-labels',
        stateIndex: '4',
      }),
      memoryKind: 'outcome',
      sourceRunId: 'run-action-result-quoted-labels',
      attributes: {
        url: 'https://app.example.test/actions',
        stateIndex: '4',
      },
      retrievability: 0.98,
    });

    const facts = await recallFactsForQuery('What happens after tapping "qquoted-control"?', {
      memoryKind: 'outcome',
      limit: 1,
      threshold: 0,
    });

    expect(facts).toHaveLength(1);
    expect(facts[0].attributes.queryQuotedControlLabelEvidence).toEqual({
      matched: [{ requested: 'qquoted-control', observed: 'qquoted-control' }],
    });
  });

  it('prefers direct UI inventories with exact quoted control-label evidence', async () => {
    const surface = upsertEntity({ name: 'surface:https://app.example.test/actions', type: 'surface' });
    const exactLabelInventory = recordFact({
      subjectId: surface.id,
      predicate: 'ui_inventory',
      objectText: JSON.stringify({
        controlNames: ['qtarget qcontrol'],
        url: 'https://app.example.test/actions/exact',
        sourceRunId: 'run-ui-exact-label',
        stateIndex: '1',
      }),
      memoryKind: 'ui_inventory',
      sourceRunId: 'run-ui-exact-label',
      attributes: {
        url: 'https://app.example.test/actions/exact',
        stateIndex: '1',
      },
      retrievability: 0.98,
      now: 1_000,
    }).fact;
    recordFact({
      subjectId: surface.id,
      predicate: 'ui_inventory',
      objectText: JSON.stringify({
        controlNames: [
          'qtarget',
          'qcontrol',
          'qnoisealpha',
          'qnoisebeta',
          'qnoisegamma',
          'qnoisedelta',
        ],
        url: 'https://app.example.test/actions/near',
        sourceRunId: 'run-ui-near-label',
        stateIndex: '1',
      }),
      memoryKind: 'ui_inventory',
      sourceRunId: 'run-ui-near-label',
      attributes: {
        url: 'https://app.example.test/actions/near',
        stateIndex: '1',
      },
      retrievability: 0.98,
      now: 2_000,
    });

    const facts = await recallFactsForQuery(
      'qrequest "qtarget qcontrol" qnoisealpha qnoisebeta qnoisegamma qnoisedelta',
      {
        memoryKind: 'ui_inventory',
        limit: 1,
        threshold: 0,
      },
    );

    expect(facts[0].id).toBe(exactLabelInventory.id);
  });

  it('prefers the requested UI surface over a similar field schema on another surface', async () => {
    const surface = upsertEntity({ name: 'surface:https://app.example.test/catalog', type: 'surface' });
    const requestedSurface = recordFact({
      subjectId: surface.id,
      predicate: 'ui_inventory',
      objectText: JSON.stringify({
        surfaceLabels: ['qdeveloper qlaptop qmac'],
        fieldLabels: ['qadditional-software', 'qquantity'],
        fields: [
          { label: 'qadditional-software', role: 'checkbox' },
          { label: 'qquantity', role: 'combobox', options: ['1', '2'] },
        ],
        url: 'https://app.example.test/catalog/mac',
      }),
      memoryKind: 'ui_inventory',
      sourceRunId: 'run-requested-surface',
      attributes: { url: 'https://app.example.test/catalog/mac', stateIndex: '4' },
      retrievability: 0.98,
    }).fact;
    const similarSurface = recordFact({
      subjectId: surface.id,
      predicate: 'ui_inventory',
      objectText: JSON.stringify({
        surfaceLabels: ['qdevelopment qlaptop qpc'],
        fieldLabels: ['qdrive qsize', 'qstorage 250', 'qstorage 500'],
        fields: [
          { label: 'qdrive qsize', role: 'radio', contextLabels: ['qdevelopment qlaptop qpc'] },
          { label: 'qstorage 250', role: 'radio' },
          { label: 'qstorage 500', role: 'radio' },
        ],
        url: 'https://app.example.test/catalog/pc',
      }),
      memoryKind: 'ui_inventory',
      sourceRunId: 'run-similar-field-schema',
      attributes: { url: 'https://app.example.test/catalog/pc', stateIndex: '8' },
      retrievability: 0.98,
    }).fact;

    const facts = await recallFactsForQuery(
      'qdeveloper qlaptop qmac qdrive qsize qstorage',
      {
        memoryKind: 'ui_inventory',
        limit: 2,
        threshold: 0,
      },
    );

    expect(facts[0].id).toBe(requestedSurface.id);
    expect(facts.map((fact) => fact.id)).not.toContain(similarSurface.id);
  });

  it('uses action-result UI observations as surface evidence for recall', async () => {
    const surface = upsertEntity({ name: 'surface:https://app.example.test/shop', type: 'surface' });
    const actionResult = recordFact({
      subjectId: surface.id,
      predicate: 'ui_action_result',
      objectText: JSON.stringify({
        action: "click('qadd')",
        thought: 'qpost-action-observation',
        sections: [
          {
            label: 'qorder-panel',
            structuralPath: [{ role: 'main' }, { role: 'region', label: 'qrequested-product' }],
            textSnippets: ['qadded-notice'],
          },
        ],
        fields: [{ label: 'qquantity', role: 'spinbutton', value: '1' }],
      }),
      memoryKind: 'outcome',
      sourceRunId: 'run-action-result-ui',
      attributes: { stateIndex: '5' },
      retrievability: 0.98,
    }).fact;
    recordFact({
      subjectId: surface.id,
      predicate: 'ui_inventory',
      objectText: JSON.stringify({
        surfaceLabels: ['qunrelated-product'],
        fields: [{ label: 'qquantity', role: 'spinbutton', value: '9' }],
      }),
      memoryKind: 'ui_inventory',
      sourceRunId: 'run-unrelated-ui',
      attributes: { stateIndex: '2' },
      retrievability: 0.98,
    });

    const facts = await recallScoredFactsForQuery('qrequested-product qquantity qadded-notice', {
      memoryKind: ['outcome', 'ui_inventory'],
      limit: 2,
      threshold: 0,
    });

    expect(facts[0].fact.id).toBe(actionResult.id);
    expect(facts[0].surfaceIdentityScore).toBeGreaterThan(0.9);
  });

  it('does not prune relevant action-result memory behind stronger surface labels', async () => {
    const surface = upsertEntity({ name: 'surface:https://app.example.test/flow', type: 'surface' });
    const actionResult = recordFact({
      subjectId: surface.id,
      predicate: 'ui_action_result',
      objectText: JSON.stringify({
        action: "click('qsave')",
        thought: 'qtransition-target next action is available',
        surfaceLabels: ['qweak-surface'],
      }),
      memoryKind: 'outcome',
      sourceRunId: 'run-action-result-keep',
      retrievability: 0.98,
      now: 1,
    }).fact;
    recordFact({
      subjectId: surface.id,
      predicate: 'ui_inventory',
      objectText: JSON.stringify({
        surfaceLabels: ['qstrong-surface qtransition-target'],
      }),
      memoryKind: 'ui_inventory',
      sourceRunId: 'run-strong-surface',
      retrievability: 0.98,
      now: 2,
    });

    const facts = await recallScoredFactsForQuery('qstrong-surface qtransition-target', {
      memoryKind: ['outcome', 'ui_inventory'],
      limit: 2,
      threshold: 0,
    });

    expect(facts.map((entry) => entry.fact.id)).toContain(actionResult.id);
  });
});
