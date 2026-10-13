// ---------------------------------------------------------------------------
// useChatScreenConversationState — effective mode fallback
// ---------------------------------------------------------------------------
// Covers only the conversation-mode fallback: an explicit conversation mode wins, else
// the caller's default (the settings store's defaultConversationMode, which always has
// a value).

import { renderHook } from '@testing-library/react-native';
import { useChatScreenConversationState } from '../../../src/screens/chatScreen/useChatScreenConversationState';
import type { Conversation } from '../../../src/types/conversation';

function baseParams(overrides: Partial<Parameters<typeof useChatScreenConversationState>[0]> = {}) {
  return {
    activeConversation: undefined,
    activeModel: null,
    activeProviderId: null,
    defaultConversationMode: 'chitchat' as const,
    hasForegroundRequest: false,
    hasActiveRecoveryOperation: false,
    hasLiveBackgroundWorker: false,
    providers: [],
    ...overrides,
  };
}

describe('useChatScreenConversationState effective mode fallback', () => {
  it('uses the default conversation mode when the conversation has none', () => {
    const { result } = renderHook(() =>
      useChatScreenConversationState(baseParams({ defaultConversationMode: 'agentic' })),
    );

    expect(result.current.effectiveMode).toBe('agentic');
    expect(result.current.isAgenticMode).toBe(true);
  });

  it("prefers the active conversation's own mode over the default", () => {
    const activeConversation = { id: 'conv-1', mode: 'agentic' } as unknown as Conversation;
    const { result } = renderHook(() =>
      useChatScreenConversationState(
        baseParams({ activeConversation, defaultConversationMode: 'chitchat' }),
      ),
    );

    expect(result.current.effectiveMode).toBe('agentic');
  });
});
