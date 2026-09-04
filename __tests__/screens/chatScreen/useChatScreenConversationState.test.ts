// ---------------------------------------------------------------------------
// useChatScreenConversationState — effective mode fallback
// ---------------------------------------------------------------------------
// Covers only the conversation-mode fallback chain: an explicit conversation
// mode wins, then the caller-supplied default, then chitchat (Phase 1 flipped
// the ultimate fallback from 'agentic' to 'chitchat' so a brand-new chat
// starts in chitchat mode by default).

import { renderHook } from '@testing-library/react-native';
import { useChatScreenConversationState } from '../../../src/screens/chatScreen/useChatScreenConversationState';
import type { Conversation } from '../../../src/types/conversation';

function baseParams(overrides: Partial<Parameters<typeof useChatScreenConversationState>[0]> = {}) {
  return {
    activeConversation: undefined,
    activeModel: null,
    activeProviderId: null,
    defaultConversationMode: undefined as unknown as Conversation['mode'],
    hasForegroundRequest: false,
    hasActiveRecoveryOperation: false,
    hasLiveBackgroundWorker: false,
    providers: [],
    ...overrides,
  };
}

describe('useChatScreenConversationState effective mode fallback', () => {
  it('falls back to chitchat when neither the conversation nor the caller default supplies a mode', () => {
    const { result } = renderHook(() => useChatScreenConversationState(baseParams()));

    expect(result.current.effectiveMode).toBe('chitchat');
    expect(result.current.isAgenticMode).toBe(false);
  });

  it('uses the caller-supplied default conversation mode over the chitchat fallback', () => {
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
