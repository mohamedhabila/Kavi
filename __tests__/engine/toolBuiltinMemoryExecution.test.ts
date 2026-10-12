jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import {
  ALL_BUILTIN_TOOL_DEFINITIONS,
  MEMORY_FORGET_TOOL,
  MEMORY_REMEMBER_TOOL,
  MEMORY_SEARCH_TOOL,
} from '../../src/engine/tools/builtin-definitions';
import { executeToolCatalog } from '../../src/engine/tools/builtin-tool-catalog';
import { executeBuiltinMemoryTool } from '../../src/engine/tools/toolBuiltinMemoryExecution';
import { createConversationFileContext } from '../../src/engine/tools/toolWorkspaceFiles';
import type { ToolExecutionContext } from '../../src/engine/tools/toolExecutionContext';
import { closeMemoryDb } from '../../src/services/memory/database';
import { getMemoryItem } from '../../src/services/memory/core/memoryItemsStore';
import { resetMemoryCoreSchemaCacheForTests } from '../../src/services/memory/core/memorySchema';
import { useSettingsStore } from '../../src/store/useSettingsStore';
import type { ToolRuntimeOutcome } from '../../src/types/toolRuntimeOutcome';

const expoSqlite = require('expo-sqlite') as { __resetExpoSqliteForTests: () => void };

const MEMORY_TOOLS = [MEMORY_REMEMBER_TOOL, MEMORY_SEARCH_TOOL, MEMORY_FORGET_TOOL];

function run(
  name: string,
  args: Record<string, unknown>,
  options: { conversationId?: string; context?: ToolExecutionContext } = {},
): Promise<ToolRuntimeOutcome | null> {
  const conversationId = options.conversationId ?? 'thread-1';
  return executeBuiltinMemoryTool({
    name,
    args,
    conversationId,
    workspaceConversationId: conversationId,
    conversationFileContext: createConversationFileContext(conversationId),
    context: options.context,
  });
}

/** The tool result, plus `outcome`: whether the runtime saw the call complete or fail. */
async function json(outcome: Promise<ToolRuntimeOutcome | null>): Promise<any> {
  const resolved = await outcome;
  if (!resolved) throw new Error('memory tool was not routed');
  return { outcome: resolved.status, ...JSON.parse(resolved.content) };
}

beforeEach(() => {
  closeMemoryDb();
  expoSqlite.__resetExpoSqliteForTests();
  resetMemoryCoreSchemaCacheForTests();
  useSettingsStore.setState({ disableLongTermMemory: false });
});

afterAll(() => {
  closeMemoryDb();
});

describe('memory tool definitions', () => {
  it('registers remember, search and forget with flat strict schemas', () => {
    const registered = new Set(ALL_BUILTIN_TOOL_DEFINITIONS.map((tool) => tool.name));
    for (const tool of MEMORY_TOOLS) {
      expect(registered.has(tool.name)).toBe(true);
      expect(tool.input_schema.additionalProperties).toBe(false);
      for (const property of Object.values(tool.input_schema.properties ?? {})) {
        expect(['string', 'integer', 'boolean']).toContain((property as { type: string }).type);
      }
    }
    expect([...registered].filter((name) => name.startsWith('memory_')).sort()).toEqual([
      'memory_forget',
      'memory_remember',
      'memory_search',
    ]);
  });

  it('keeps deleting a memory behind approval', () => {
    expect(MEMORY_FORGET_TOOL.contract).toMatchObject({
      sideEffects: ['destructive'],
      riskHints: expect.arrayContaining(['requires_approval']),
    });
  });

  it('lists the memory tools under the memory category', async () => {
    const outcome = await executeToolCatalog({ category: 'memory' });
    const listed = JSON.stringify(JSON.parse(outcome.content));
    for (const tool of MEMORY_TOOLS) expect(listed).toContain(tool.name);
  });
});

describe('memory tool execution', () => {
  it('ignores tools that are not memory tools', async () => {
    await expect(run('web_search', { query: 'x' })).resolves.toBeNull();
  });

  it('remembers in the memory conversation and records the user message it came from', async () => {
    const context: ToolExecutionContext = {
      memoryConversationId: 'memory-1',
      currentUserMessage: { id: 'user-7', text: 'My sister Sara lives in Porto' },
    };

    const saved = await json(
      run('memory_remember', { content: 'Sara, the user’s sister, lives in Porto' }, { context }),
    );
    const found = await json(run('memory_search', { query: 'Sara Porto' }, { context }));

    expect(saved).toMatchObject({ outcome: 'completed', ok: true, status: 'saved' });
    expect(getMemoryItem(saved.memory.id)).toMatchObject({
      sourceConversationId: 'memory-1',
      sourceMessageId: 'user-7',
    });
    expect(found.memories.map((memory: { id: string }) => memory.id)).toEqual([saved.memory.id]);
  });

  // Traced on the GLM 5.3 Flash suite (direct-locomo-temporal-conversation-memory and
  // multi-turn-memory-preference): the model saved the user's facts with scope
  // "conversation", so they were held back from every later request. Kavi is one
  // conversation; a memory applies everywhere, whatever extra argument the model sends.
  it('finds and forgets a memory from any conversation, even one saved with a scope', async () => {
    const saved = await json(
      run(
        'memory_remember',
        { content: 'The draft lives in notes/plan.md', scope: 'conversation' },
        { conversationId: 'thread-a' },
      ),
    );

    const elsewhere = await json(
      run('memory_search', { query: 'draft notes plan' }, { conversationId: 'thread-b' }),
    );
    const forgotten = await json(
      run('memory_forget', { id: saved.memory.id }, { conversationId: 'thread-b' }),
    );

    expect(saved).toMatchObject({ outcome: 'completed', status: 'saved' });
    expect(saved.memory).not.toHaveProperty('scope');
    expect(elsewhere.memories.map((memory: { id: string }) => memory.id)).toEqual([
      saved.memory.id,
    ]);
    expect(forgotten).toMatchObject({ outcome: 'completed', status: 'forgotten' });
    expect(getMemoryItem(saved.memory.id)).toBeNull();
  });

  it('refuses to remember or search while memory is off, but still forgets', async () => {
    const saved = await json(run('memory_remember', { content: 'Prefers window seats' }));
    useSettingsStore.setState({ disableLongTermMemory: true });

    const remember = await json(run('memory_remember', { content: 'Prefers aisle seats' }));
    const search = await json(run('memory_search', { query: 'seats' }));
    const forget = await json(run('memory_forget', { id: saved.memory.id }));

    expect(remember).toMatchObject({ outcome: 'failed', code: 'memory_disabled' });
    expect(search).toMatchObject({ outcome: 'failed', code: 'memory_disabled' });
    expect(forget).toMatchObject({ outcome: 'completed', status: 'forgotten' });
    expect(getMemoryItem(saved.memory.id)).toBeNull();
  });
});
