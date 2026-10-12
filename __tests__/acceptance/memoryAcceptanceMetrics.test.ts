// ---------------------------------------------------------------------------
// Memory acceptance (Tier 2, `npm run eval:memory`)
// ---------------------------------------------------------------------------
// The memory contract end to end through the product entry points: a closed turn is
// captured (past-turn index + background extraction with a scripted model), the next
// request's memory section and the three memory tools see the result, corrections replace,
// sensitive memories stay out of the automatic prompt, credentials are never stored and
// nothing is captured while memory is off.
// ---------------------------------------------------------------------------

jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import { closeMemoryDb } from '../../src/services/memory/database';
import { publishConversationTurnMemory } from '../../src/services/memory/core/memoryCapture';
import {
  __resetMemoryExtractionWorkerForTests,
  waitForMemoryExtractionIdle,
} from '../../src/services/memory/core/memoryExtractionWorker';
import {
  executeMemoryForget,
  executeMemoryRemember,
  executeMemorySearch,
} from '../../src/services/memory/core/memoryItemsTools';
import { prepareMemoryPromptSection } from '../../src/services/memory/core/memoryPrompt';
import { resetMemoryCoreSchemaCacheForTests } from '../../src/services/memory/core/memorySchema';
import { useSettingsStore } from '../../src/store/useSettingsStore';
import { useChatStore } from '../helpers/chatStoreHarness';

const expoSqlite = require('expo-sqlite') as { __resetExpoSqliteForTests: () => void };

type ExtractionScript = (prompt: string) => unknown[];

const extractionPrompts: string[] = [];
let script: ExtractionScript = () => [];
let sequence = 0;
let clock = 1_000;

function useExtraction(next: ExtractionScript): void {
  script = next;
}

function startConversation(): string {
  return useChatStore.getState().createConversation('provider', 'Be helpful.');
}

async function closeTurn(conversationId: string, user: string, reply: string): Promise<string> {
  sequence += 1;
  const userId = `user-${sequence}`;
  const replyId = `reply-${sequence}`;
  const store = useChatStore.getState();
  store.addMessage(conversationId, { id: userId, role: 'user', content: user, timestamp: ++clock });
  store.addMessage(conversationId, {
    id: replyId,
    role: 'assistant',
    content: reply,
    timestamp: ++clock,
    assistantMetadata: { kind: 'final', completionStatus: 'complete', finishReason: 'stop' },
  });
  publishConversationTurnMemory(conversationId, replyId);
  await expect(waitForMemoryExtractionIdle(5_000)).resolves.toBe(true);
  return userId;
}

function promptFor(conversationId: string, message: string): string {
  return (
    prepareMemoryPromptSection({
      conversationId,
      latestUserMessage: message,
      inRequestUserMessageIds: [],
    })?.text ?? ''
  );
}

function tool(conversationId: string) {
  const context = {
    conversationId,
    sourceMessageId: null,
    inRequestUserMessageIds: [],
    now: ++clock,
  };
  const parse = (outcome: { content: string }) => JSON.parse(outcome.content);
  return {
    remember: (args: Record<string, unknown>) => parse(executeMemoryRemember(args, context)),
    search: (query: string) => parse(executeMemorySearch({ query }, context)),
    forget: (id: string) => parse(executeMemoryForget({ id })),
  };
}

beforeEach(() => {
  closeMemoryDb();
  expoSqlite.__resetExpoSqliteForTests();
  resetMemoryCoreSchemaCacheForTests();
  useChatStore.setState({ conversations: [], activeConversationId: null });
  useSettingsStore.setState({ disableLongTermMemory: false });
  extractionPrompts.length = 0;
  script = () => [];
  __resetMemoryExtractionWorkerForTests({
    resolveModel: async () => async (prompt: string) => {
      extractionPrompts.push(prompt);
      return JSON.stringify({ operations: script(prompt) });
    },
    isForegroundActive: () => false,
    now: () => clock,
  });
});

afterAll(() => {
  __resetMemoryExtractionWorkerForTests();
  closeMemoryDb();
});

describe('memory acceptance', () => {
  it('recalls an earlier conversation in a new conversation', async () => {
    const earlier = startConversation();
    const userId = await closeTurn(
      earlier,
      'Plan a weekend in Lisbon with my partner, we love seafood',
      'Here is a two-day Lisbon plan with seafood dinners in Alfama.',
    );

    const later = startConversation();
    const section = prepareMemoryPromptSection({
      conversationId: later,
      latestUserMessage: 'What was that Lisbon weekend plan again?',
      inRequestUserMessageIds: [],
    });
    expect(section?.turnIds).toEqual([userId]);
    expect(section?.text).toContain('Alfama');
    expect(tool(later).search('Lisbon weekend').earlierConversations).toHaveLength(1);
  });

  it('remembers what extraction learned and applies a later correction', async () => {
    const first = startConversation();
    useExtraction(() => [{ op: 'add', id: null, text: 'Sara (the user’s sister) lives in Porto' }]);
    await closeTurn(first, 'My sister Sara moved to Porto last month.', 'Porto is lovely!');

    const second = startConversation();
    expect(promptFor(second, 'Where does my sister Sara live?')).toContain('lives in Porto');

    let storedId = '';
    useExtraction((prompt) => {
      storedId = /- (\S+): Sara \(the user’s sister\) lives in Porto/u.exec(prompt)?.[1] ?? '';
      return storedId
        ? [{ op: 'update', id: storedId, text: 'Sara (the user’s sister) lives in Lisbon' }]
        : [];
    });
    await closeTurn(second, 'Sara just moved again, to Lisbon.', 'Noted, Lisbon it is.');

    expect(storedId).not.toBe('');
    const prompt = promptFor(startConversation(), 'Where does my sister Sara live now?');
    expect(prompt).toContain('lives in Lisbon');
    expect(prompt).not.toContain('lives in Porto');
  });

  it('keeps a sensitive memory out of the automatic prompt but finds it when asked', () => {
    const conversation = startConversation();
    const tools = tool(conversation);

    expect(tools.remember({ content: 'Blood type is O negative', sensitive: true }).status).toBe(
      'saved',
    );

    expect(promptFor(startConversation(), 'What is my blood type?')).not.toContain('O negative');
    expect(tools.search('blood type').memories).toEqual([
      expect.objectContaining({ text: 'Blood type is O negative', sensitive: true }),
    ]);
  });

  it('never stores a credential', () => {
    const tools = tool(startConversation());
    const apiKey = `sk-proj-${'c'.repeat(24)}`;

    expect(tools.remember({ content: `My OpenAI key is ${apiKey}` })).toMatchObject({
      ok: false,
      error: 'restricted',
    });
    expect(tools.search('OpenAI key').memories).toEqual([]);
  });

  it('forgets a memory when asked', () => {
    const tools = tool(startConversation());
    const saved = tools.remember({ content: 'Prefers aisle seats on long flights' });

    expect(tools.forget(saved.memory.id).status).toBe('forgotten');
    expect(tools.search('aisle seats').memories).toEqual([]);
  });

  it('recalls memories in the language they were said in', () => {
    const tools = tool(startConversation());
    tools.remember({ content: 'أفضل وقت للاجتماعات هو الصباح الباكر' });
    tools.remember({ content: '週末は京都の実家に帰ります' });

    expect(promptFor(startConversation(), 'متى أفضل وقت للاجتماعات؟')).toContain('الصباح الباكر');
    expect(promptFor(startConversation(), '週末は京都に行く予定はある？')).toContain('実家');
  });

  it('captures nothing while memory is off', async () => {
    useSettingsStore.setState({ disableLongTermMemory: true });
    const conversation = startConversation();
    useExtraction(() => [{ op: 'add', id: null, text: 'Lives in Utrecht' }]);

    await closeTurn(conversation, 'I live in Utrecht.', 'Got it.');

    useSettingsStore.setState({ disableLongTermMemory: false });
    expect(extractionPrompts).toEqual([]);
    expect(promptFor(startConversation(), 'Where do I live, Utrecht?')).toBe('');
  });
});
