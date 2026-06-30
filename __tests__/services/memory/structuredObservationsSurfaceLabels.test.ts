jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import { listFacts } from '../../../src/services/memory/facts/queries';
import {
  ensureFactSchema,
  resetFactSchemaCacheForTests,
} from '../../../src/services/memory/schema';
import { closeMemoryDb } from '../../../src/services/memory/sqlite-store';
import { recordStructuredObservationsFromMessages } from '../../../src/services/memory/structuredObservations';
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

describe('structured observation surface labels', () => {
  it('records structural surface labels for UI inventory identity', () => {
    recordStructuredObservationsFromMessages({
      conversationId: 'conv-surface-labels',
      threadId: 'conv-surface-labels',
      sourceRunId: 'run-surface-labels',
      now: 120,
      messages: [
        toolMessage({
          url: 'https://app.example.test/catalog/item',
          accessibility_tree: [
            "RootWebArea 'Catalog'",
            "\t[1] group 'qcatalog-item-alpha'",
            "\t\t[2] group 'qconfiguration'",
            "\t\t\t[3] radio 'qoption-1', checked='false'",
            "\t\t\t[4] radio 'qoption-2', checked='true'",
          ].join('\n'),
        }),
      ],
    });

    const inventory = JSON.parse(
      listFacts({
        memoryKind: 'ui_inventory',
        originConversationId: 'conv-surface-labels',
      })[0].objectText,
    );

    expect(inventory.surfaceLabels).toEqual(
      expect.arrayContaining(['qcatalog-item-alpha', 'qconfiguration']),
    );
  });

  it('orders active content surface labels before repeated shell labels', () => {
    recordStructuredObservationsFromMessages({
      conversationId: 'conv-surface-label-order',
      threadId: 'conv-surface-label-order',
      sourceRunId: 'run-surface-label-order',
      now: 121,
      messages: [
        toolMessage({
          url: 'https://app.example.test/item',
          accessibility_tree: [
            "RootWebArea 'qroot'",
            "\t[1] navigation 'qshell-global'",
            "\t\t[2] link 'qshell-skip', clickable, visible",
            "\t\t[3] button 'qshell-menu', clickable, visible",
            "\t[4] main '', visible",
            "\t\t[5] region 'qactive-surface'",
            "\t\t\t[6] button 'qprimary-action', clickable, visible",
            "\t\t\t[7] textbox 'qactive-field', visible",
          ].join('\n'),
        }),
      ],
    });

    const inventory = JSON.parse(
      listFacts({
        memoryKind: 'ui_inventory',
        originConversationId: 'conv-surface-label-order',
      })[0].objectText,
    );

    expect(inventory.surfaceLabels[0]).toBe('qactive-surface');
    expect(inventory.surfaceLabels).toEqual(expect.arrayContaining(['qshell-global']));
  });
});
