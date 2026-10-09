// ---------------------------------------------------------------------------
// Tests - useChatStore: renameConversation
// ---------------------------------------------------------------------------

jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import { useChatStore } from '../../helpers/chatStoreHarness';
import { MAX_CONVERSATION_TITLE_GRAPHEMES } from '../../../src/store/chatStoreConversationActions';

function titleOf(id: string): string | undefined {
  return useChatStore.getState().conversations.find((conversation) => conversation.id === id)
    ?.title;
}

describe('useChatStore renameConversation', () => {
  it('sets the title, collapsing whitespace and trimming the ends', () => {
    const id = useChatStore.getState().createConversation('p1', 's');

    useChatStore.getState().renameConversation(id, '  Trip\n  planning\t2027 ');

    expect(titleOf(id)).toBe('Trip planning 2027');
  });

  it('ignores a title that is only whitespace', () => {
    const id = useChatStore.getState().createConversation('p1', 's');
    useChatStore.getState().renameConversation(id, 'Budget');

    useChatStore.getState().renameConversation(id, ' \n\t ');

    expect(titleOf(id)).toBe('Budget');
  });

  it('bounds the title by graphemes without splitting one', () => {
    const id = useChatStore.getState().createConversation('p1', 's');
    const family = '👨‍👩‍👧';

    useChatStore
      .getState()
      .renameConversation(id, family.repeat(MAX_CONVERSATION_TITLE_GRAPHEMES + 5));

    const segments = Array.from(new Intl.Segmenter().segment(titleOf(id)!), (part) => part.segment);
    expect(segments.length).toBeGreaterThan(0);
    expect(segments.length).toBeLessThanOrEqual(MAX_CONVERSATION_TITLE_GRAPHEMES);
    expect(segments.every((segment) => segment === family)).toBe(true);
  });

  it('renames only the named conversation and leaves an unknown id alone', () => {
    const first = useChatStore.getState().createConversation('p1', 's');
    const second = useChatStore.getState().createConversation('p2', 's');
    const secondTitle = titleOf(second);

    useChatStore.getState().renameConversation(first, 'Renamed');
    useChatStore.getState().renameConversation('missing', 'Ghost');

    expect(titleOf(first)).toBe('Renamed');
    expect(titleOf(second)).toBe(secondTitle);
    expect(useChatStore.getState().conversations).toHaveLength(2);
  });

  it('keeps a user title when the first message arrives', () => {
    const id = useChatStore.getState().createConversation('p1', 's');
    useChatStore.getState().renameConversation(id, 'My plans');

    useChatStore.getState().addMessage(id, { role: 'user', content: 'Plan a weekend in Lisbon' });

    expect(titleOf(id)).toBe('My plans');
  });
});
