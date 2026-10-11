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
} from '../../../../src/services/memory/core/memoryPrompt';

const expoSqlite = require('expo-sqlite') as { __resetExpoSqliteForTests: () => void };
const HOME = { conversationId: 'conv-1' };
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
      visibility: HOME,
      latestUserMessage: 'Book a visit to my sister Sara',
    });

    expect(section?.itemIds).toEqual([name, sister]);
    expect(section?.text).toContain(`- (2026-09-14) The user’s name is Mohamed [id: ${name}]`);
    expect(section?.text).toContain(
      `- (2026-09-14) Sara (the user’s sister) lives in Porto [id: ${sister}]`,
    );
    expect(section?.text).not.toContain('window seats');
  });

  it('recalls matching rounds of other conversations, dated', () => {
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
      visibility: HOME,
      latestUserMessage: 'What was the Lisbon weekend plan?',
    });

    expect(section?.text).toContain('## Earlier conversations');
    expect(section?.text).toContain(
      '- (2026-09-14) User: Plan a weekend in Lisbon with my partner\nAssistant: Day one: Alfama and Belém.',
    );
    expect(section?.text).not.toContain('Lisbon again?');
  });

  it('leaves sensitive memories out even when they match', () => {
    remember('Sara’s phone is +31 6 12345678');

    expect(
      buildMemoryPromptSection({ visibility: HOME, latestUserMessage: 'Call Sara’s phone' }),
    ).toBeNull();
  });

  it('is absent when nothing is pinned or relevant', () => {
    remember('Prefers window seats');

    expect(buildMemoryPromptSection({ visibility: HOME, latestUserMessage: 'hi' })).toBeNull();
  });

  it('stays within its size budget', () => {
    for (let index = 0; index < 20; index += 1) {
      remember(`Pinned note ${index} ${'x'.repeat(1_500)}`, { pinned: true });
    }

    const section = buildMemoryPromptSection({ visibility: HOME, latestUserMessage: 'anything' });

    expect(section!.text.length).toBeLessThanOrEqual(MEMORY_PROMPT_MAX_CHARS);
    expect(section!.itemIds.length).toBeGreaterThan(0);
  });
});
