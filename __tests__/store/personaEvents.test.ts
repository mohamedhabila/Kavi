// ---------------------------------------------------------------------------
// Tests — Conversation persona-switch event log
// ---------------------------------------------------------------------------

import { useChatStore } from '../../src/store/useChatStore';

beforeEach(() => {
  useChatStore.setState({
    conversations: [],
    activeConversationId: null,
    isLoading: false,
  });
});

const seedConversationWithMessage = (personaId?: string) => {
  const convId = useChatStore.getState().createConversation('p1', 'sys');
  if (personaId) {
    useChatStore.setState((state) => ({
      conversations: state.conversations.map((c) =>
        c.id === convId ? { ...c, personaId } : c,
      ),
    }));
  }
  useChatStore.getState().addMessage(convId, {
    id: 'm1',
    role: 'user',
    content: 'hi',
  });
  return convId;
};

const personaEventsOf = (convId: string) =>
  useChatStore.getState().conversations.find((c) => c.id === convId)?.personaEvents ?? [];

describe('updatePersonaInConversation — personaEvents log', () => {
  it('does not record an event for an empty conversation (no messages)', () => {
    const convId = useChatStore.getState().createConversation('p1', 'sys');
    useChatStore.getState().updatePersonaInConversation(convId, 'work');
    expect(personaEventsOf(convId)).toEqual([]);
    const conv = useChatStore.getState().conversations.find((c) => c.id === convId);
    expect(conv?.personaId).toBe('work');
  });

  it('records a switch event when persona changes on a non-empty conversation', () => {
    const convId = seedConversationWithMessage('default');
    useChatStore.getState().updatePersonaInConversation(convId, 'work');
    const events = personaEventsOf(convId);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ from: 'default', to: 'work' });
    expect(typeof events[0].id).toBe('string');
    expect(typeof events[0].at).toBe('number');
  });

  it('does not record an event when the persona is unchanged', () => {
    const convId = seedConversationWithMessage('work');
    useChatStore.getState().updatePersonaInConversation(convId, 'work');
    expect(personaEventsOf(convId)).toEqual([]);
  });

  it('accumulates multiple switch events in order', () => {
    const convId = seedConversationWithMessage('default');
    useChatStore.getState().updatePersonaInConversation(convId, 'work');
    useChatStore.getState().updatePersonaInConversation(convId, 'personal');
    useChatStore.getState().updatePersonaInConversation(convId, 'work');
    const events = personaEventsOf(convId);
    expect(events.map((e) => `${e.from}->${e.to}`)).toEqual([
      'default->work',
      'work->personal',
      'personal->work',
    ]);
  });

  it('only updates the targeted conversation', () => {
    const convA = seedConversationWithMessage('default');
    const convB = seedConversationWithMessage('default');
    useChatStore.getState().updatePersonaInConversation(convA, 'work');
    expect(personaEventsOf(convA)).toHaveLength(1);
    expect(personaEventsOf(convB)).toEqual([]);
  });

  it('records `from` as undefined when conversation has no prior personaId', () => {
    const convId = seedConversationWithMessage(); // no personaId set
    useChatStore.getState().updatePersonaInConversation(convId, 'work');
    const events = personaEventsOf(convId);
    expect(events).toHaveLength(1);
    expect(events[0].from).toBeUndefined();
    expect(events[0].to).toBe('work');
  });
});
