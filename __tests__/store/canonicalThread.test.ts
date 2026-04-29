// ---------------------------------------------------------------------------
// Tests — Single-Thread Collapse
// ---------------------------------------------------------------------------
//
// Pins the v6→v7 persist migration that marks one canonical conversation per
// (personaId|'__default__') group and flags the rest `archivedFromMigration`,
// plus the `getOrCreateCanonicalThread` store action which routes "new chat"
// affordances back to the persona's canonical thread instead of accumulating
// fresh conversations. Side threads must never be touched by either path.
// ---------------------------------------------------------------------------

import {
  collapseConversationsToCanonical,
  useChatStore,
} from '../../src/store/useChatStore';
import type { Conversation } from '../../src/types';

function makeConversation(overrides: Partial<Conversation>): Conversation {
  return {
    id: overrides.id ?? 'c',
    title: overrides.title ?? 'Chat',
    messages: overrides.messages ?? [],
    providerId: overrides.providerId ?? 'openai',
    systemPrompt: overrides.systemPrompt ?? '',
    createdAt: overrides.createdAt ?? 0,
    updatedAt: overrides.updatedAt ?? 0,
    personaId: overrides.personaId,
    mode: overrides.mode,
    isSideThread: overrides.isSideThread,
    parentConversationId: overrides.parentConversationId,
    isCanonical: overrides.isCanonical,
    archivedFromMigration: overrides.archivedFromMigration,
  } as Conversation;
}

describe('collapseConversationsToCanonical (v6→v7)', () => {
  it('marks the most recently updated conversation per persona as canonical', () => {
    const out = collapseConversationsToCanonical([
      makeConversation({ id: 'a', personaId: 'researcher', updatedAt: 100 }),
      makeConversation({ id: 'b', personaId: 'researcher', updatedAt: 300 }),
      makeConversation({ id: 'c', personaId: 'researcher', updatedAt: 200 }),
    ]);
    const byId = Object.fromEntries(out.map((c) => [c.id, c]));
    expect(byId.b.isCanonical).toBe(true);
    expect(byId.a.archivedFromMigration).toBe(true);
    expect(byId.c.archivedFromMigration).toBe(true);
    expect(byId.a.isCanonical).not.toBe(true);
    expect(byId.c.isCanonical).not.toBe(true);
  });

  it('treats missing/empty personaId as the __default__ group', () => {
    const out = collapseConversationsToCanonical([
      makeConversation({ id: 'a', updatedAt: 50 }),
      makeConversation({ id: 'b', personaId: '', updatedAt: 60 }),
    ]);
    const byId = Object.fromEntries(out.map((c) => [c.id, c]));
    expect(byId.b.isCanonical).toBe(true);
    expect(byId.a.archivedFromMigration).toBe(true);
  });

  it('keeps separate canonicals for different personas', () => {
    const out = collapseConversationsToCanonical([
      makeConversation({ id: 'r1', personaId: 'researcher', updatedAt: 10 }),
      makeConversation({ id: 'w1', personaId: 'writer', updatedAt: 20 }),
    ]);
    const byId = Object.fromEntries(out.map((c) => [c.id, c]));
    expect(byId.r1.isCanonical).toBe(true);
    expect(byId.w1.isCanonical).toBe(true);
    expect(byId.r1.archivedFromMigration).not.toBe(true);
    expect(byId.w1.archivedFromMigration).not.toBe(true);
  });

  it('never modifies side threads or rebrands archived rows', () => {
    const out = collapseConversationsToCanonical([
      makeConversation({ id: 'main', updatedAt: 100 }),
      makeConversation({
        id: 'side',
        updatedAt: 200,
        parentConversationId: 'main',
        isSideThread: true,
      }),
    ]);
    const byId = Object.fromEntries(out.map((c) => [c.id, c]));
    expect(byId.side.isSideThread).toBe(true);
    expect(byId.side.isCanonical).not.toBe(true);
    expect(byId.side.archivedFromMigration).not.toBe(true);
    expect(byId.main.isCanonical).toBe(true);
  });

  it('is idempotent — already-flagged input passes through unchanged', () => {
    const input = [
      makeConversation({
        id: 'a',
        personaId: 'researcher',
        updatedAt: 50,
        isCanonical: true,
      }),
      makeConversation({
        id: 'b',
        personaId: 'researcher',
        updatedAt: 100,
        archivedFromMigration: true,
      }),
    ];
    const out = collapseConversationsToCanonical(input);
    const byId = Object.fromEntries(out.map((c) => [c.id, c]));
    expect(byId.a.isCanonical).toBe(true);
    expect(byId.b.archivedFromMigration).toBe(true);
    expect(byId.b.isCanonical).not.toBe(true);
  });

  it('returns the input unchanged when given an empty array', () => {
    expect(collapseConversationsToCanonical([])).toEqual([]);
  });
});

describe('getOrCreateCanonicalThread', () => {
  beforeEach(() => {
    useChatStore.setState({
      conversations: [],
      activeConversationId: null,
      isLoading: false,
    });
  });

  it('creates a new canonical thread when none exists for the persona', () => {
    const id = useChatStore
      .getState()
      .getOrCreateCanonicalThread('openai', 'sys', 'gpt-x', { personaId: 'researcher' });
    const created = useChatStore.getState().conversations.find((c) => c.id === id);
    expect(created).toBeDefined();
    expect(created!.isCanonical).toBe(true);
    expect(created!.personaId).toBe('researcher');
    expect(created!.providerId).toBe('openai');
    expect(useChatStore.getState().activeConversationId).toBe(id);
  });

  it('returns the existing canonical thread for the persona instead of creating a new one', () => {
    const firstId = useChatStore
      .getState()
      .getOrCreateCanonicalThread('openai', 'sys', 'gpt-x', { personaId: 'researcher' });
    const secondId = useChatStore
      .getState()
      .getOrCreateCanonicalThread('openai', 'sys', 'gpt-x', { personaId: 'researcher' });
    expect(secondId).toBe(firstId);
    expect(useChatStore.getState().conversations).toHaveLength(1);
  });

  it('keeps separate canonical threads for different personas', () => {
    const a = useChatStore
      .getState()
      .getOrCreateCanonicalThread('openai', 'sys', 'gpt-x', { personaId: 'researcher' });
    const b = useChatStore
      .getState()
      .getOrCreateCanonicalThread('openai', 'sys', 'gpt-x', { personaId: 'writer' });
    expect(a).not.toBe(b);
    expect(useChatStore.getState().conversations).toHaveLength(2);
  });

  it('does not reuse archived or side-thread conversations as the canonical', () => {
    useChatStore.setState({
      conversations: [
        makeConversation({
          id: 'old',
          personaId: 'researcher',
          archivedFromMigration: true,
          updatedAt: 1,
        }),
        makeConversation({
          id: 'side',
          personaId: 'researcher',
          parentConversationId: 'old',
          isSideThread: true,
          updatedAt: 2,
        }),
      ],
    });
    const id = useChatStore
      .getState()
      .getOrCreateCanonicalThread('openai', 'sys', 'gpt-x', { personaId: 'researcher' });
    expect(id).not.toBe('old');
    expect(id).not.toBe('side');
    const created = useChatStore.getState().conversations.find((c) => c.id === id);
    expect(created!.isCanonical).toBe(true);
  });

  it('honors activate=false to keep the previously active conversation', () => {
    useChatStore.setState({ activeConversationId: 'pinned' });
    const id = useChatStore
      .getState()
      .getOrCreateCanonicalThread('openai', 'sys', undefined, {
        personaId: 'researcher',
        activate: false,
      });
    expect(useChatStore.getState().activeConversationId).toBe('pinned');
    expect(id).toBeTruthy();
  });
});
