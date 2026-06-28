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
        rowSamples: [{ Total: '-' }],
      }),
    ]);
  });
});
