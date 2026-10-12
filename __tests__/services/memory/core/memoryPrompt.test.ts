jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../../../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import { closeMemoryDb } from '../../../../src/services/memory/database';
import { resetMemoryCoreSchemaCacheForTests } from '../../../../src/services/memory/core/memorySchema';
import { addMemoryItem } from '../../../../src/services/memory/core/memoryItemsStore';
import { indexMemoryTurn } from '../../../../src/services/memory/core/memoryTurnsStore';
import {
  buildMemoryPromptSection,
  MEMORY_PROMPT_MAX_CHARS,
  MEMORY_PROMPT_TURN_LIMIT,
} from '../../../../src/services/memory/core/memoryPrompt';

const expoSqlite = require('expo-sqlite') as { __resetExpoSqliteForTests: () => void };
const HOME = 'conv-1';
const DAY = Date.UTC(2026, 8, 14);

function remember(text: string, extra: Partial<Parameters<typeof addMemoryItem>[0]> = {}): string {
  const result = addMemoryItem({ text, conversationId: 'conv-1', now: DAY, ...extra });
  if (result.status !== 'created') throw new Error(`not created: ${result.status}`);
  return result.item.id;
}

beforeEach(() => {
  closeMemoryDb();
  expoSqlite.__resetExpoSqliteForTests();
  resetMemoryCoreSchemaCacheForTests();
});

afterAll(() => {
  closeMemoryDb();
});

describe('memory prompt section', () => {
  it('shows pinned memories and the ones matching the request, dated and with ids', () => {
    const name = remember('The user’s name is Mohamed', { pinned: true });
    const sister = remember('Sara (the user’s sister) lives in Porto');
    remember('Prefers window seats');

    const section = buildMemoryPromptSection({
      conversationId: HOME,
      latestUserMessage: 'Book a visit to my sister Sara',
      inRequestUserMessageIds: [],
    });

    expect(section?.itemIds).toEqual([name, sister]);
    expect(section?.text).toContain(`- (2026-09-14) The user’s name is Mohamed [id: ${name}]`);
    expect(section?.text).toContain(
      `- (2026-09-14) Sara (the user’s sister) lives in Porto [id: ${sister}]`,
    );
    expect(section?.text).not.toContain('window seats');
  });

  it('recalls matching rounds the request does not carry, dated', () => {
    indexMemoryTurn({
      conversationId: 'conv-old',
      userMessageId: 'u-old',
      userText: 'Plan a weekend in Lisbon with my partner',
      replyText: 'Day one: Alfama and Belém.',
      at: DAY,
    });
    indexMemoryTurn({
      conversationId: 'conv-1',
      userMessageId: 'u-now',
      userText: 'Lisbon again?',
      replyText: 'Sure.',
      at: DAY,
    });

    const section = buildMemoryPromptSection({
      conversationId: HOME,
      latestUserMessage: 'What was the Lisbon weekend plan?',
      inRequestUserMessageIds: ['u-now'],
    });

    expect(section?.text).toContain('## Earlier exchanges');
    expect(section?.text).toContain(
      '- (2026-09-14) User: Plan a weekend in Lisbon with my partner\nAssistant: Day one: Alfama and Belém.',
    );
    expect(section?.text).not.toContain('Lisbon again?');
  });

  it('recalls a round from earlier in this conversation once the request no longer carries it', () => {
    indexMemoryTurn({
      conversationId: 'conv-1',
      userMessageId: 'u-archived',
      userText: 'The cabin entrance is the blue door on the left',
      replyText: 'Noted: blue door on the left.',
      at: DAY,
    });
    indexMemoryTurn({
      conversationId: 'conv-1',
      userMessageId: 'u-recent',
      userText: 'Which cabin door was it, the blue one?',
      replyText: 'The blue door on the left.',
      at: DAY + 1,
    });

    const section = buildMemoryPromptSection({
      conversationId: HOME,
      latestUserMessage: 'Which cabin door do I use?',
      inRequestUserMessageIds: ['u-recent', 'u-latest'],
    });

    expect(section?.turnIds).toEqual(['u-archived']);
    expect(section?.text).toContain('The cabin entrance is the blue door on the left');
  });

  // LongMemEval multi-session questions ("how many …", "in total") need a round from each
  // earlier conversation that mentions the subject; with only three rounds shown, every one
  // of them was present for 62% of the 133 oracle questions.
  it('recalls the rounds of each earlier conversation an aggregating question needs', () => {
    const days = [5, 9, 13, 17, 21, 25];
    days.forEach((day, index) => {
      indexMemoryTurn({
        conversationId: HOME,
        userMessageId: `u-${index}`,
        userText: `I picked up another item of clothing from the dry cleaner today (${index + 1}).`,
        replyText: 'Noted.',
        at: Date.UTC(2026, 7, day),
      });
    });

    const section = buildMemoryPromptSection({
      conversationId: HOME,
      latestUserMessage: 'How many items of clothing did I pick up from the dry cleaner?',
      inRequestUserMessageIds: [],
    });

    expect(MEMORY_PROMPT_TURN_LIMIT).toBeGreaterThanOrEqual(days.length);
    expect([...(section?.turnIds ?? [])].sort()).toEqual(days.map((_, index) => `u-${index}`));
  });

  it('leaves sensitive memories and past rounds out even when they match', () => {
    remember('Sara’s phone is +31 6 12345678');
    indexMemoryTurn({
      conversationId: 'conv-old',
      userMessageId: 'u-old',
      userText: 'Save Sara’s phone +31 6 12345678',
      replyText: 'Saved.',
      at: DAY,
    });

    expect(
      buildMemoryPromptSection({
        conversationId: HOME,
        latestUserMessage: 'Call Sara’s phone',
        inRequestUserMessageIds: [],
      }),
    ).toBeNull();
  });

  it('is absent when nothing is pinned or relevant', () => {
    remember('Prefers window seats');

    expect(
      buildMemoryPromptSection({
        conversationId: HOME,
        latestUserMessage: 'hi',
        inRequestUserMessageIds: [],
      }),
    ).toBeNull();
  });

  it('stays within its size budget', () => {
    for (let index = 0; index < 20; index += 1) {
      remember(`Pinned note ${index} ${'x'.repeat(1_500)}`, { pinned: true });
    }

    const section = buildMemoryPromptSection({
      conversationId: HOME,
      latestUserMessage: 'anything',
      inRequestUserMessageIds: [],
    });

    expect(section!.text.length).toBeLessThanOrEqual(MEMORY_PROMPT_MAX_CHARS);
    expect(section!.itemIds.length).toBeGreaterThan(0);
  });
});
