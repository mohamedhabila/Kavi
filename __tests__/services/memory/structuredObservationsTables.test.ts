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
import { recordStructuredObservationsFromMessages } from '../../../src/services/memory/structuredObservations';
import { fitObjectTextForStorage } from '../../../src/services/memory/structuredObservationCompaction';
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

describe('structured observation table memory', () => {
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

  it('separates table cell values from interactive table controls', () => {
    recordStructuredObservationsFromMessages({
      conversationId: 'conv-table-controls',
      threadId: 'conv-table-controls',
      sourceRunId: 'run-table-controls',
      now: 355,
      messages: [
        toolMessage({
          url: 'https://admin.example.test/orders',
          accessibility_tree: [
            "RootWebArea 'Orders'",
            "\t[1] table ''",
            "\t\t[2] row ''",
            "\t\t\t[3] columnheader 'Product'",
            "\t\t\t[4] columnheader 'Quantity'",
            "\t\t\t[5] columnheader 'Action'",
            "\t\t[6] row ''",
            "\t\t\t[7] gridcell 'qstatic-product'",
            "\t\t\t[8] gridcell '2'",
            "\t\t\t[9] gridcell ''",
            "\t\t\t\t[10] button 'qopen-row', clickable, visible",
          ].join('\n'),
        }),
      ],
    });

    const inventory = JSON.parse(
      listFacts({
        memoryKind: 'ui_inventory',
        originConversationId: 'conv-table-controls',
      })[0].objectText,
    );

    expect(inventory.tables[0]).toMatchObject({
      rowSamples: [{ Product: 'qstatic-product', Quantity: '2', Action: 'qopen-row' }],
      interactiveControlCount: 1,
      interactiveControls: [{ index: 10, role: 'button', name: 'qopen-row' }],
    });
    expect(inventory.tables[0].interactiveControls).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'qstatic-product' })]),
    );
  });

  it('preserves sparse table positions and structural summary rows', () => {
    recordStructuredObservationsFromMessages({
      conversationId: 'conv-sparse-table',
      threadId: 'conv-sparse-table',
      sourceRunId: 'run-sparse-table',
      now: 360,
      messages: [
        toolMessage({
          url: 'https://admin.example.test/order-status',
          accessibility_tree: [
            "RootWebArea 'Order Status'",
            "\t[1] table ''",
            "\t\t[2] row ''",
            "\t\t\t[3] columnheader 'Description'",
            "\t\t\t[4] columnheader 'Delivery Date'",
            "\t\t\t[5] columnheader 'Stage'",
            "\t\t\t[6] columnheader 'Price (ea.)'",
            "\t\t\t[7] columnheader 'Quantity'",
            "\t\t\t[8] columnheader 'Total'",
            "\t\t[9] row ''",
            "\t\t\t[10] gridcell 'Loaner Laptop'",
            "\t\t\t[11] gridcell '2026-02-18'",
            "\t\t\t[12] gridcell 'Waiting for Approval'",
            "\t\t\t[13] gridcell ''",
            "\t\t\t[14] gridcell '5'",
            "\t\t\t[15] gridcell ''",
            "\t\t[16] row ''",
            "\t\t\t[17] gridcell ''",
            "\t\t\t[18] gridcell 'Total'",
            "\t\t\t[19] gridcell '-'",
          ].join('\n'),
        }),
      ],
    });

    const inventory = JSON.parse(
      listFacts({
        memoryKind: 'ui_inventory',
        originConversationId: 'conv-sparse-table',
      })[0].objectText,
    );
    const table = inventory.tables[0];
    const itemRow = table.rowSamples.find(
      (row: Record<string, string>) => row.Description === 'Loaner Laptop',
    );

    expect(itemRow).toMatchObject({
      Description: 'Loaner Laptop',
      'Delivery Date': '2026-02-18',
      Stage: 'Waiting for Approval',
      Quantity: '5',
    });
    expect(itemRow).not.toHaveProperty('Price (ea.)');
    expect(itemRow).not.toHaveProperty('Total');
    expect(table.rowSamples).toEqual(expect.arrayContaining([{ Total: '-' }]));
    expect(table.columnValueSamples).toEqual(
      expect.arrayContaining([{ column: 'Total', values: ['-'] }]),
    );
  });

  it('keeps long status values in extracted table rows', () => {
    recordStructuredObservationsFromMessages({
      conversationId: 'conv-status-table',
      threadId: 'conv-status-table',
      sourceRunId: 'run-status-table-extract',
      now: 365,
      messages: [
        toolMessage({
          url: 'https://admin.example.test/order-status',
          accessibility_tree: [
            "RootWebArea 'Order Status'",
            "\t[1] table ''",
            "\t\t[2] row ''",
            "\t\t\t[3] columnheader 'Description'",
            "\t\t\t[4] columnheader 'Delivery Date'",
            "\t\t\t[5] columnheader 'Stage'",
            "\t\t[6] row ''",
            "\t\t\t[7] gridcell 'Macbook Pro'",
            "\t\t\t[8] gridcell '2025-11-08'",
            "\t\t\t[9] gridcell 'Waiting for Approval (In progress) Request Approved (Request Approved) Dept. Head Approval - 2 Days (Pending - has not started) CIO Approval - 2 Days (Pending - has not started) Order Fulfillment - 4 Days (Pending - has not started) Backordered - 14 Days (Pending - has not started) Deployment - 1 Day (Pending - has not started) Completed (Pending - has not started)'",
          ].join('\n'),
        }),
      ],
    });

    const inventory = JSON.parse(
      listFacts({
        memoryKind: 'ui_inventory',
        originConversationId: 'conv-status-table',
      })[0].objectText,
    );
    const row = inventory.tables[0].rowSamples[0];

    expect(row).toMatchObject({
      Description: 'Macbook Pro',
      'Delivery Date': '2025-11-08',
      Stage: expect.stringContaining('Deployment - 1 Day'),
    });
    expect(row.Stage).toContain('Completed');
  });

  it('extracts data rows that contain nested layout tables', () => {
    recordStructuredObservationsFromMessages({
      conversationId: 'conv-nested-status-table',
      threadId: 'conv-nested-status-table',
      sourceRunId: 'run-nested-status-table',
      now: 366,
      messages: [
        toolMessage({
          url: 'https://admin.example.test/order-status',
          accessibility_tree: [
            "RootWebArea 'Order Status'",
            "\t[1] table ''",
            "\t\t[2] rowgroup ''",
            "\t\t\t[3] row ''",
            "\t\t\t\t[4] columnheader 'Description'",
            "\t\t\t\t[5] columnheader 'Delivery Date'",
            "\t\t\t\t[6] columnheader 'Stage'",
            "\t\t\t\t[7] columnheader 'Price (ea.)'",
            "\t\t\t\t[8] columnheader 'Quantity'",
            "\t\t\t\t[9] columnheader 'Total'",
            "\t\t[10] rowgroup ''",
            "\t\t\t[11] row ''",
            "\t\t\t\t[12] gridcell 'Macbook Pro'",
            "\t\t\t\t[13] gridcell '2025-11-08'",
            "\t\t\t\t[14] gridcell 'Toggle stage state display Waiting for Approval (In progress) Request Approved (Request Approved) Dept. Head Approval - 2 Days (Pending - has not started) CIO Approval - 2 Days (Pending - has not started) Order Fulfillment - 4 Days (Pending - has not started) Backordered - 14 Days (Pending - has not started) Deployment - 1 Day (Pending - has not started) Completed (Pending - has not started)'",
            "\t\t\t\t\t[15] LayoutTable ''",
            "\t\t\t\t\t\t[16] LayoutTableRow ''",
            "\t\t\t\t\t\t\t[17] LayoutTableCell 'Toggle stage state display'",
            "\t\t\t\t\t\t\t[18] LayoutTableCell 'Waiting for Approval (In progress) Request Approved (Request Approved) Dept. Head Approval - 2 Days (Pending - has not started) CIO Approval - 2 Days (Pending - has not started) Order Fulfillment - 4 Days (Pending - has not started) Backordered - 14 Days (Pending - has not started) Deployment - 1 Day (Pending - has not started) Completed (Pending - has not started)'",
            "\t\t\t\t[19] gridcell '$1,499.00 +$100.00 Annually'",
            "\t\t\t\t[20] gridcell '1'",
            "\t\t\t\t[21] gridcell '$1,499.00 +$100.00 Annually'",
          ].join('\n'),
        }),
      ],
    });

    const inventory = JSON.parse(
      listFacts({
        memoryKind: 'ui_inventory',
        originConversationId: 'conv-nested-status-table',
      })[0].objectText,
    );
    const row = inventory.tables[0].rowSamples.find(
      (candidate: Record<string, string>) => candidate.Description === 'Macbook Pro',
    );

    expect(row).toMatchObject({
      Description: 'Macbook Pro',
      'Delivery Date': '2025-11-08',
      Stage: expect.stringContaining('Order Fulfillment - 4 Days'),
      Quantity: '1',
    });
    expect(row.Stage).toContain('Completed');
  });

  it('keeps table summaries when compacting large UI inventories', () => {
    const compacted = JSON.parse(
      fitObjectTextForStorage(
        JSON.stringify({
          controlCount: 240,
          nodeCount: 900,
          url: 'https://admin.example.test/order-status',
          sourceRunId: 'run-sparse-table',
          stateIndex: '45',
          fieldLabels: Array.from({ length: 80 }, (_, index) => `field-${index}`),
          controlNames: Array.from({ length: 240 }, (_, index) => `control-${index}`),
          sections: Array.from({ length: 32 }, (_, index) => ({
            label: `section-${index}`,
            controlNames: [`control-${index}`],
          })),
          labelValues: Array.from({ length: 32 }, (_, index) => ({
            label: `label-${index}`,
            value: `value-${index}`,
          })),
          tables: [
            {
              index: 1,
              role: 'table',
              columnLabels: ['Description', 'Total'],
              rowCount: 2,
              interactiveControlCount: 0,
              interactiveControls: [],
              columnValueSamples: [{ column: 'Total', values: ['-'] }],
              rowSamples: [{ Total: '-' }],
            },
          ],
        }),
        900,
      ),
    );

    expect(compacted.tables).toEqual([
      expect.objectContaining({
        columnLabels: ['Description', 'Total'],
        interactiveControlCount: 0,
        rowSamples: [{ Total: '-' }],
      }),
    ]);
  });

  it('preserves dense status table rows when compacting large UI inventories', () => {
    const stageSequence =
      'Waiting for Approval (In progress) Request Approved (Request Approved) Dept. Head Approval - 2 Days (Pending - has not started) CIO Approval - 2 Days (Pending - has not started) Order Fulfillment - 4 Days (Pending - has not started) Backordered - 14 Days (Pending - has not started) Deployment - 1 Day (Pending - has not started) Completed (Pending - has not started)';
    const compacted = JSON.parse(
      fitObjectTextForStorage(
        JSON.stringify({
          controlCount: 260,
          nodeCount: 900,
          url: 'https://admin.example.test/order-status',
          sourceRunId: 'run-status-table',
          stateIndex: '15',
          fieldLabels: Array.from({ length: 80 }, (_, index) => `field-${index}`),
          controlNames: Array.from({ length: 260 }, (_, index) => `control-${index}`),
          sections: Array.from({ length: 48 }, (_, index) => ({
            label: `section-${index}`,
            controlNames: [`control-${index}`],
          })),
          actionControls: Array.from({ length: 80 }, (_, index) => ({
            role: index % 2 === 0 ? 'button' : 'link',
            name: `action-${index}`,
          })),
          roleCounts: { button: 80, link: 80, gridcell: 120 },
          tables: [
            {
              index: 87,
              role: 'table',
              columnLabels: [
                'Description',
                'Delivery Date',
                'Stage',
                'Price (ea.)',
                'Quantity',
                'Total',
              ],
              rowCount: 3,
              interactiveControlCount: 1,
              interactiveControls: [{ index: 14, role: 'button', name: 'Toggle stage state display' }],
              columnValueSamples: [
                { column: 'Description', values: ['Macbook Pro'] },
                { column: 'Delivery Date', values: ['2025-11-08'] },
                { column: 'Stage', values: [stageSequence] },
              ],
              rowSamples: [
                {
                  Description: 'Macbook Pro',
                  'Delivery Date': '2025-11-08',
                  Stage: stageSequence,
                  'Price (ea.)': '$1,499.00 +$100.00 Annually',
                  Quantity: '1',
                  Total: '$1,499.00 +$100.00 Annually',
                },
                { Total: '$1,499.00 +$100.00 Annually' },
              ],
            },
          ],
        }),
        2_200,
      ),
    );

    expect(compacted.tables).toEqual([
      expect.objectContaining({
          columnLabels: expect.arrayContaining(['Description', 'Delivery Date', 'Stage']),
          interactiveControls: [
            { index: 14, role: 'button', name: 'Toggle stage state display' },
          ],
          rowSamples: expect.arrayContaining([
          expect.objectContaining({
            Description: 'Macbook Pro',
            'Delivery Date': '2025-11-08',
            Stage: expect.stringContaining('Deployment - 1 Day'),
          }),
        ]),
      }),
    ]);
    expect(JSON.stringify(compacted).length).toBeLessThanOrEqual(2_200);
  });

  it('keeps later structural sections when compacting large UI inventories', () => {
    const payload = {
      controlCount: 180,
      nodeCount: 700,
      url: 'https://workflow.example.test/profile/edit',
      sourceRunId: 'run-section-compaction',
      stateIndex: '9',
      fieldLabels: Array.from({ length: 40 }, (_, index) => `field-${index}`),
      controlNames: Array.from({ length: 180 }, (_, index) => `control-${index}`),
      sections: [
        {
          label: 'qform-section',
          structuralPath: [{ role: 'main' }],
          controlNames: ['qbio', 'qformat-help', 'qsave'],
          textSnippets: ['qbio-text', 'qformat-copy'],
          controlCount: 3,
          firstControlIndex: 20,
        },
        {
          label: 'qpreview',
          structuralPath: [{ role: 'main' }, { role: 'Section' }],
          controlNames: ['qformat-help', 'qsave'],
          textSnippets: ['qbio-text', 'qformat-copy'],
          controlCount: 2,
          firstControlIndex: 30,
        },
        {
          label: 'qprofile-card',
          structuralPath: [{ role: 'complementary' }, { role: 'Section' }],
          controlNames: ['qprofile-link', 'qedit-profile'],
          textSnippets: ['qregistered', 'qcreated-at', 'qage', 'qstatus', 'qbio-text'],
          controlCount: 2,
          firstControlIndex: 50,
        },
        {
          label: 'qtools',
          structuralPath: [{ role: 'complementary' }, { role: 'Section' }],
          controlNames: ['qhidden', 'qtrash'],
          controlCount: 2,
          firstControlIndex: 60,
        },
      ],
      actionControls: Array.from({ length: 60 }, (_, index) => ({
        role: index % 2 === 0 ? 'button' : 'link',
        name: `action-${index}`,
      })),
    };
    const compacted = JSON.parse(fitObjectTextForStorage(JSON.stringify(payload), 3_600));

    expect(JSON.stringify(payload).length).toBeGreaterThan(3_600);
    expect(compacted.sections.map((section: { label: string }) => section.label)).toContain(
      'qprofile-card',
    );
    expect(
      compacted.sections.find((section: { label: string }) => section.label === 'qprofile-card'),
    ).toMatchObject({
      structuralPath: [{ role: 'complementary' }, { role: 'Section' }],
      textSnippets: expect.arrayContaining(['qbio-text']),
      controlNames: expect.arrayContaining(['qedit-profile']),
    });
  });

  it('keeps valued fields with adjacent controls when compacting large UI inventories', () => {
    const payload = {
      controlCount: 180,
      nodeCount: 700,
      url: 'https://workflow.example.test/form',
      sourceRunId: 'run-valued-field-compaction',
      stateIndex: '12',
      fieldLabels: Array.from({ length: 18 }, (_, index) => `field-${index}`),
      fields: Array.from({ length: 18 }, (_, index) => ({
        order: index,
        label: index === 9 ? 'qtarget-field' : `field-${index}`,
        role: index % 2 === 0 ? 'textbox' : 'combobox',
        controlName: index === 9 ? 'qtarget-field' : `field-${index}`,
        value: index === 9 ? 'qtarget-value' : index < 3 ? `value-${index}` : undefined,
        options: index === 9 ? ['qtarget-option'] : undefined,
        adjacentControls:
          index === 9
            ? [
                { role: 'button', name: 'qtarget-lookup' },
                { role: 'link', name: 'qtarget-open' },
              ]
            : undefined,
      })),
      controlNames: Array.from({ length: 180 }, (_, index) => `control-${index}`),
      sections: Array.from({ length: 30 }, (_, index) => ({
        label: `section-${index}`,
        controlNames: [`control-${index}`],
      })),
      actionControls: Array.from({ length: 80 }, (_, index) => ({
        role: 'button',
        name: `action-${index}`,
      })),
    };
    const compacted = JSON.parse(fitObjectTextForStorage(JSON.stringify(payload), 1_600));
    const targetField = compacted.fields.find(
      (field: { label?: string }) => field.label === 'qtarget-field',
    );

    expect(JSON.stringify(payload).length).toBeGreaterThan(1_600);
    expect(targetField).toMatchObject({
      label: 'qtarget-field',
      value: 'qtarget-value',
      adjacentControls: [
        { role: 'button', name: 'qtarget-lookup' },
        { role: 'link', name: 'qtarget-open' },
      ],
    });
  });

  it('preserves compact form field groups before broad page chrome under storage pressure', () => {
    const payload = {
      controlCount: 220,
      nodeCount: 900,
      url: 'https://workflow.example.test/configure',
      sourceRunId: 'run-group-field-compaction',
      stateIndex: '5',
      surfaceLabels: ['qsurface', 'qprimary'],
      fieldLabels: ['qfirst-group', 'qsecond-group', 'qquantity'],
      fields: [
        {
          order: 0,
          label: 'qfirst-group',
          role: 'radiogroup',
          controlName: 'qfirst-group',
          value: 'qfirst-option-1',
          options: ['qfirst-option-1', 'qfirst-option-2', 'qfirst-option-3', 'qfirst-option-4'],
        },
        {
          order: 1,
          label: 'qsecond-group',
          role: 'radiogroup',
          controlName: 'qsecond-group',
          value: 'qsecond-option-1',
          options: ['qsecond-option-1', 'qsecond-option-2'],
        },
        {
          order: 2,
          label: 'qquantity',
          role: 'combobox',
          controlName: 'qquantity',
          value: '1',
          options: ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10'],
        },
      ],
      controlNames: Array.from({ length: 220 }, (_, index) => `qcontrol-${index}`),
      sections: Array.from({ length: 40 }, (_, index) => ({
        label: `qsection-${index}`,
        controlNames: [`qcontrol-${index}`],
        textSnippets: [`qsnippet-${index}`],
      })),
      actionControls: Array.from({ length: 90 }, (_, index) => ({
        role: index % 2 === 0 ? 'button' : 'link',
        name: `qaction-${index}`,
      })),
      roleControls: {
        button: Array.from({ length: 30 }, (_, index) => ({
          role: 'button',
          name: `qbutton-${index}`,
        })),
      },
      contextRoleControls: Array.from({ length: 24 }, (_, index) => ({
        label: `qcontext-${index}`,
        roleControls: {
          button: [{ role: 'button', name: `qcontext-button-${index}` }],
        },
      })),
    };

    const compacted = JSON.parse(fitObjectTextForStorage(JSON.stringify(payload), 4_000));

    expect(JSON.stringify(payload).length).toBeGreaterThan(4_000);
    expect(compacted.fields.map((field: { label: string }) => field.label)).toEqual([
      'qfirst-group',
      'qsecond-group',
      'qquantity',
    ]);
    expect(compacted.fields[1]).toMatchObject({
      label: 'qsecond-group',
      options: ['qsecond-option-1', 'qsecond-option-2'],
    });
  });

  it('preserves ordered section controls when compact form fields have many options', () => {
    const payload = {
      controlCount: 160,
      nodeCount: 640,
      url: 'https://workflow.example.test/list',
      sourceRunId: 'run-section-order-field-options',
      stateIndex: '9',
      surfaceLabels: ['qlist-surface'],
      fieldLabels: ['qbulk-picker'],
      fields: [
        {
          order: 0,
          label: 'qbulk-picker',
          role: 'combobox',
          controlName: 'qbulk-picker',
          options: Array.from({ length: 60 }, (_, index) => `qbulk-option-${index}`),
        },
      ],
      sections: [
        {
          label: 'qordered-region',
          controlNames: ['qfirst-control', 'qtarget-left', 'qtarget-right', 'qlast-control'],
          controlCount: 40,
          firstControlIndex: 4,
        },
      ],
      controlNames: Array.from({ length: 160 }, (_, index) => `qcontrol-${index}`),
      actionControls: Array.from({ length: 80 }, (_, index) => ({
        role: 'button',
        name: `qaction-${index}`,
      })),
    };

    const compacted = JSON.parse(fitObjectTextForStorage(JSON.stringify(payload), 1_800));

    expect(JSON.stringify(payload).length).toBeGreaterThan(1_800);
    expect(compacted.sections[0].controlNames).toEqual([
      'qfirst-control',
      'qtarget-left',
      'qtarget-right',
      'qlast-control',
    ]);
    expect(compacted.fields[0]).toMatchObject({
      label: 'qbulk-picker',
      optionCount: 60,
    });
    expect(compacted.fields[0].options.length).toBeLessThanOrEqual(24);
  });
});
