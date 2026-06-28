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

describe('structured observation label-value memory', () => {
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

  it('records structural context before label-value pairs without phrase rules', () => {
    recordStructuredObservationsFromMessages({
      conversationId: 'conv-label-value-context',
      threadId: 'conv-label-value-context',
      sourceRunId: 'run-label-value-context',
      now: 510,
      messages: [
        toolMessage({
          url: 'https://surface.example.test/qitem',
          accessibility_tree: [
            "RootWebArea 'qpage'",
            "\t[1] complementary '', visible",
            "\t\t[2] Section '', visible",
            "\t\t\t[3] paragraph '', visible",
            "\t\t\t\t[4] strong '', visible",
            "\t\t\t\t\tStaticText 'qmetric'",
            "\t\t\t\tStaticText 'qdelta'",
            "\t\t\t[5] heading 'qtarget:', visible",
            "\t\t\t[6] paragraph '', visible",
            "\t\t\t\tStaticText 'qvalue'",
          ].join('\n'),
        }),
      ],
    });

    const labelValue = listFacts({
      memoryKind: 'ui_filter_state',
      originConversationId: 'conv-label-value-context',
    }).map((fact) => JSON.parse(fact.objectText))[0];

    expect(labelValue).toMatchObject({
      label: 'qtarget',
      value: 'qvalue',
      nearbyTextBefore: expect.arrayContaining(['qmetric', 'qdelta']),
      sourceRunId: 'run-label-value-context',
    });
  });
});
