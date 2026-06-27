jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import { closeMemoryDb } from '../../../src/services/memory/sqlite-store';
import {
  ensureFactSchema,
  resetFactSchemaCacheForTests,
} from '../../../src/services/memory/schema';
import { listFacts } from '../../../src/services/memory/facts/queries';
import {
  recordStructuredObservationsFromEvidence,
  recordStructuredObservationsFromMessages,
} from '../../../src/services/memory/structuredObservations';
import type { Message } from '../../../src/types/message';

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

function toolMessage(payload: Record<string, unknown>): Message {
  return {
    id: 'tool-1',
    role: 'tool',
    content: JSON.stringify(payload),
    timestamp: 1,
    toolCallId: 'tc-1',
    toolCalls: [
      {
        id: 'tc-1',
        name: 'browser_observe',
        arguments: '{}',
        status: 'completed',
      },
    ],
  };
}

describe('structured observation memory', () => {
  it('records accessibility trees as typed UI inventory and outcome memories', () => {
    const result = recordStructuredObservationsFromMessages({
      conversationId: 'conv-ui',
      threadId: 'conv-ui',
      taskId: 'task-ui',
      sourceRunId: 'run-ui',
      sourceTurnId: 'assistant-1',
      now: 100,
      messages: [
        toolMessage({
          status: 'completed',
          outcome: 'success',
          url: 'https://app.example.test/settings',
          action: 'click("save")',
          accessibility_tree:
            "RootWebArea 'Settings', focused\n\t[10] button 'Save', clickable, visible\n\t[11] textbox 'Display name', editable, visible",
        }),
      ],
    });

    expect(result.factIds.length).toBeGreaterThanOrEqual(2);
    const inventories = listFacts({ memoryKind: 'ui_inventory', originTaskId: 'task-ui' });
    const outcomes = listFacts({ memoryKind: 'outcome', originTaskId: 'task-ui' });
    const inventory = inventories.find((fact) => fact.predicate === 'ui_inventory');

    expect(inventories).toHaveLength(1);
    expect(outcomes).toHaveLength(1);
    expect(inventory?.objectText).toContain('Save');
    expect(inventories.every((fact) => fact.scope === 'session')).toBe(true);
    expect(inventories.every((fact) => fact.memoryKind === 'ui_inventory')).toBe(true);
    expect(inventory?.attributes).toMatchObject({
      surfaceId: 'surface:https://app.example.test',
      url: 'https://app.example.test/settings',
      nodeCount: 3,
      controlCount: 2,
      textEntryCount: 1,
    });
    expect(() => JSON.parse(inventory!.objectText)).not.toThrow();
  });

  it('records label-control field relations and complete page inventories', () => {
    recordStructuredObservationsFromMessages({
      conversationId: 'conv-ui-graph',
      threadId: 'conv-ui-graph',
      sourceRunId: 'run-ui-graph',
      now: 400,
      messages: [
        toolMessage({
          url: 'https://forum.example.test/submit',
          accessibility_tree: [
            "RootWebArea 'Submit'",
            "\t[1] link 'Home', clickable, visible",
            "\t[2] searchbox 'Search query', clickable, visible",
            "\t[10] LabelText '', visible",
            "\t\tStaticText 'Title'",
            "\t\tStaticText '*'",
            "\t[11] textbox 'Title This field is required.', visible, required",
            "\t[12] LabelText '', visible",
            "\t\tStaticText 'Body'",
            "\t[13] textbox 'Body', visible",
            "\t[14] checkbox 'Formatting help +', clickable, checked='false'",
            "\t[15] LabelText '', visible",
            "\t\tStaticText 'Destination'",
            "\t\tStaticText '*'",
            "\t[16] combobox 'general' value='general', clickable, hasPopup='menu'",
            "\t\t[161] option 'general', selected=True",
            "\t\t[162] option 'news', selected=False",
            "\t[17] button 'Create submission', clickable, visible",
            "\t[18] LabelText 'Decorative helper', clickable, visible",
          ].join('\n'),
        }),
      ],
    });

    const fields = listFacts({
      memoryKind: 'ui_field',
      originConversationId: 'conv-ui-graph',
    }).map((fact) => JSON.parse(fact.objectText));
    const inventory = listFacts({
      memoryKind: 'ui_inventory',
      originConversationId: 'conv-ui-graph',
    })[0];
    const inventoryObject = JSON.parse(inventory.objectText);

    expect(fields.map((field) => field.label)).toEqual(['Title', 'Body', 'Destination']);
    expect(fields.map((field) => field.role)).toEqual(['textbox', 'textbox', 'combobox']);
    expect(fields[2]).toMatchObject({
      label: 'Destination',
      controlName: 'general',
      value: 'general',
      options: ['general', 'news'],
      required: true,
    });
    expect(inventoryObject).toMatchObject({
      controlCount: 9,
      textEntryCount: 2,
      searchControlCount: 1,
      fieldLabels: ['Title', 'Body', 'Destination'],
    });
    expect(
      inventoryObject.controls.find(
        (control: { role?: string; name?: string }) =>
          control.role === 'combobox' && control.name === 'general',
      ),
    ).toMatchObject({ options: ['general', 'news'] });
    expect(inventoryObject.controls.some((control: { name?: string }) => control.name === 'Formatting help +')).toBe(
      true,
    );
    expect(inventoryObject.controls.some((control: { role?: string }) => control.role === 'LabelText')).toBe(
      false,
    );
    expect(inventoryObject.controlNames).toEqual(
      expect.arrayContaining(['Home', 'Search query', 'Title This field is required.', 'Body']),
    );
    expect(inventoryObject.searchControls).toEqual([
      expect.objectContaining({ role: 'searchbox', name: 'Search query' }),
    ]);
    expect(inventoryObject.textEntryControls).toEqual([
      expect.objectContaining({ role: 'textbox', label: 'Title' }),
      expect.objectContaining({ role: 'textbox', label: 'Body' }),
    ]);
  });

  it('records generic label-value state for active filters without phrase rules', () => {
    recordStructuredObservationsFromMessages({
      conversationId: 'conv-filter-state',
      threadId: 'conv-filter-state',
      sourceRunId: 'run-filter-state',
      now: 500,
      messages: [
        toolMessage({
          url: 'https://admin.example.test/orders',
          accessibility_tree: [
            "RootWebArea 'Orders'",
            "\tStaticText 'Order state:'",
            "\tStaticText 'Archived'",
            "\t[10] button 'Clear active state', clickable",
            "\t[11] textbox 'Search by keyword', value='Avery', clickable",
            "\t[12] button 'Filters', clickable",
          ].join('\n'),
        }),
      ],
    });

    const labelValues = listFacts({
      memoryKind: 'ui_filter_state',
      originConversationId: 'conv-filter-state',
    }).map((fact) => JSON.parse(fact.objectText));

    expect(labelValues).toEqual([
      expect.objectContaining({
        label: 'Order state',
        value: 'Archived',
        sourceRunId: 'run-filter-state',
      }),
    ]);
  });

  it('preserves controls in source order inside compact inventories', () => {
    const result = recordStructuredObservationsFromMessages({
      conversationId: 'conv-form',
      threadId: 'conv-form',
      sourceRunId: 'run-form',
      now: 300,
      messages: [
        toolMessage({
          url: 'https://forum.example.test/submit',
          accessibility_tree: [
            "RootWebArea 'Submit'",
            "\t[1] link 'Home', clickable, visible",
            "\t[2] link 'Forums', clickable, visible",
            "\t[10] textbox 'Title', editable, visible",
            "\t[11] textbox 'Body', editable, visible",
            "\t[12] combobox 'Forum', clickable, visible",
            "\t[13] button 'Create submission', clickable, visible",
          ].join('\n'),
        }),
      ],
    });

    expect(result.factIds.length).toBeGreaterThanOrEqual(1);
    const inventories = listFacts({
      memoryKind: 'ui_inventory',
      originConversationId: 'conv-form',
    });
    const inventory = JSON.parse(inventories[0].objectText);

    expect(inventory.controls.map((control: { name: string }) => control.name)).toEqual([
      'Home',
      'Forums',
      'Title',
      'Body',
      'Forum',
      'Create submission',
    ]);
  });

  it('records compact table column values from accessibility grids', () => {
    recordStructuredObservationsFromMessages({
      conversationId: 'conv-table',
      threadId: 'conv-table',
      sourceRunId: 'run-table',
      now: 350,
      messages: [
        toolMessage({
          url: 'https://admin.example.test/orders',
          accessibility_tree: [
            "RootWebArea 'Orders'",
            "\t[1] table ''",
            "\t\t[2] row ''",
            "\t\t\t[3] columnheader 'Reference'",
            "\t\t\t[4] columnheader 'State'",
            "\t\t[5] row ''",
            "\t\t\t[6] gridcell '000001'",
            "\t\t\t[7] gridcell 'Closed'",
            "\t\t[8] row ''",
            "\t\t\t[9] gridcell '000002'",
            "\t\t\t[10] gridcell 'Open'",
          ].join('\n'),
        }),
      ],
    });

    const inventory = JSON.parse(
      listFacts({
        memoryKind: 'ui_inventory',
        originConversationId: 'conv-table',
      })[0].objectText,
    );

    expect(inventory.tables).toEqual([
      expect.objectContaining({
        role: 'table',
        columnLabels: ['Reference', 'State'],
        rowCount: 3,
        columnValueSamples: expect.arrayContaining([
          { column: 'State', values: ['Closed', 'Open'] },
        ]),
      }),
    ]);
  });

  it('consumes structured evidence and records typed memories', () => {
    const evidence =
      'agent:' +
      JSON.stringify({
        kind: 'state',
        trajectory_id: 'traj-1',
        state_index: 2,
        outcome: 'failure',
        url: 'https://app.example.test/search',
        accessibility_tree: "[7] searchbox 'Query', clickable, visible",
      });

    const result = recordStructuredObservationsFromEvidence({
      evidence: [evidence],
      conversationId: 'conv-evidence',
      threadId: 'conv-evidence',
      sourceRunId: 'run-evidence',
      now: 200,
    });

    expect(result.consumedEvidence).toEqual([evidence]);
    expect(listFacts({ memoryKind: 'ui_inventory', originConversationId: 'conv-evidence' })).toHaveLength(
      1,
    );
    expect(
      listFacts({ memoryKind: 'outcome', originConversationId: 'conv-evidence' }),
    ).toHaveLength(1);
  });
});
