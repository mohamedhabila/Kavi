jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import { listFacts } from '../../../src/services/memory/facts/queries';
import { assemblePrompt } from '../../../src/services/memory/promptAssembly';
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
  expoSqlite.__resetExpoSqliteForTests();
});

function toolMessage(payload: Record<string, unknown>, id: string): Message {
  return {
    id,
    role: 'tool',
    content: JSON.stringify(payload),
    timestamp: 1,
    toolCallId: id,
  };
}

describe('structured procedure traces - target context', () => {
  it('preserves descendant labels and peer names for target nodes without own names', () => {
    recordStructuredObservationsFromMessages({
      conversationId: 'conv-procedure-target-context',
      threadId: 'conv-procedure-target-context',
      sourceRunId: 'run-procedure-target-context',
      now: 10,
      messages: [
        toolMessage(
          {
            state_index: 4,
            url: 'https://workflow.example.test/list',
            action: "click('13')",
            accessibility_tree: [
              "RootWebArea 'qworkflow-surface'",
              "\tmain 'qworkflow-surface'",
              "\t\t[9] button 'qaction-menu', clickable, visible",
              "\t\t[10] list '', visible",
              "\t\t\t[11] listitem '', visible",
              "\t\t\t\tStaticText 'qdelete-option'",
              "\t\t\t[12] listitem '', visible",
              "\t\t\t\tStaticText 'qstatus-option'",
              "\t\t\t[13] listitem '', visible",
              "\t\t\t\tStaticText 'qupdate-option'",
            ].join('\n'),
          },
          'tool-procedure-target-context',
        ),
      ],
    });

    const procedureFact = listFacts({
      memoryKind: 'procedure',
      originConversationId: 'conv-procedure-target-context',
    })[0];
    const procedure = JSON.parse(procedureFact.objectText);

    expect(procedure.steps[0].targetControl).toEqual({
      nodeId: '13',
      role: 'listitem',
      name: 'qupdate-option',
      peerNames: ['qdelete-option', 'qstatus-option', 'qupdate-option'],
    });
    expect(procedure.steps[0].surfaceLabels).toContain('qworkflow-surface');

    const promptText = assemblePrompt({
      basePrompt: 'base',
      retrievedFacts: [procedureFact],
    })
      .sections.map((section) => section.text)
      .join('\n');

    expect(promptText).toContain('qupdate-option');
    expect(promptText).toContain('qstatus-option');
    expect(promptText).toContain('qworkflow-surface');
  });
});
