jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../../../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import { closeMemoryDb, getMemoryDb } from '../../../../src/services/memory/database';
import { addMemoryItem } from '../../../../src/services/memory/core/memoryItemsStore';
import { prepareMemoryPromptSection } from '../../../../src/services/memory/core/memoryPrompt';
import {
  latestMemoryPromptBuildId,
  listMemoryPromptBuilds,
  MEMORY_PROMPT_LOG_RETAINED_ROWS,
  recordMemoryPromptBuild,
} from '../../../../src/services/memory/core/memoryPromptLog';
import { resetMemoryCoreSchemaCacheForTests } from '../../../../src/services/memory/core/memorySchema';

const expoSqlite = require('expo-sqlite') as { __resetExpoSqliteForTests: () => void };

function build(conversationId: string, itemIds: string[] = []) {
  return { conversationId, at: 1, itemIds, turnIds: [], chars: 10, durationMs: 2 };
}

beforeEach(() => {
  closeMemoryDb();
  expoSqlite.__resetExpoSqliteForTests();
  resetMemoryCoreSchemaCacheForTests();
});

afterAll(() => {
  closeMemoryDb();
});

describe('memory prompt log', () => {
  it('records what each request was shown, per conversation and after a cursor', () => {
    recordMemoryPromptBuild(build('conv-1', ['mem_a']));
    const cursor = latestMemoryPromptBuildId();
    recordMemoryPromptBuild(build('conv-2', ['mem_b']));
    recordMemoryPromptBuild(build('conv-1', ['mem_c']));

    expect(
      listMemoryPromptBuilds({ conversationId: 'conv-1', afterId: cursor }).map(
        (row) => row.itemIds,
      ),
    ).toEqual([['mem_c']]);
    expect(listMemoryPromptBuilds({ conversationId: 'conv-1' })).toHaveLength(2);
  });

  it('keeps only the latest rows', () => {
    for (let index = 0; index < MEMORY_PROMPT_LOG_RETAINED_ROWS + 5; index += 1) {
      recordMemoryPromptBuild(build('conv-1'));
    }

    expect(listMemoryPromptBuilds({ conversationId: 'conv-1' })).toHaveLength(
      MEMORY_PROMPT_LOG_RETAINED_ROWS,
    );
  });

  it('never fails the request when the log cannot be written', () => {
    getMemoryDb();
    resetMemoryCoreSchemaCacheForTests();
    getMemoryDb().execSync('CREATE TABLE memory_prompt_log (id INTEGER PRIMARY KEY)');

    expect(() => recordMemoryPromptBuild(build('conv-1'))).not.toThrow();
  });

  it('logs the ids, size and timing of every prompt build, empty ones included', () => {
    prepareMemoryPromptSection({
      conversationId: 'conv-2',
      latestUserMessage: 'nothing stored',
      inRequestUserMessageIds: [],
    });
    const stored = addMemoryItem({
      text: 'Sara lives in Porto',
      conversationId: 'conv-1',
      pinned: true,
      now: 1,
    });
    const id = stored.status === 'created' ? stored.item.id : '';

    const section = prepareMemoryPromptSection({
      conversationId: 'conv-1',
      latestUserMessage: 'hello',
      inRequestUserMessageIds: [],
    });

    expect(listMemoryPromptBuilds({ conversationId: 'conv-1' })).toEqual([
      expect.objectContaining({ itemIds: [id], turnIds: [], chars: section!.text.length }),
    ]);
    expect(listMemoryPromptBuilds({ conversationId: 'conv-2' })).toEqual([
      expect.objectContaining({ itemIds: [], chars: 0 }),
    ]);
  });
});
