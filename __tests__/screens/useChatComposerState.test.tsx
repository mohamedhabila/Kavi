import { act, renderHook } from '@testing-library/react-native';

import { getComposerDraftKey } from '../../src/screens/chatComposerDrafts';
import { useChatComposerState } from '../../src/screens/useChatComposerState';

describe('useChatComposerState', () => {
  it('keeps Exact text scoped to its conversation draft and clears it after send', () => {
    const setEditingContent = jest.fn();
    const { result, rerender } = renderHook(
      ({ conversationId }: { conversationId: string }) =>
        useChatComposerState({
          activeConversationId: conversationId,
          editingContent: undefined,
          editingMessageId: null,
          setEditingContent,
        }),
      { initialProps: { conversationId: 'conversation-1' } },
    );

    act(() => {
      result.current.handleComposerTextChange('ios-ux-proof.txt');
    });
    act(() => {
      result.current.handleComposerExactTextChange(true);
    });
    expect(result.current.composerExactText).toBe(true);

    rerender({ conversationId: 'conversation-2' });
    expect(result.current.composerExactText).toBe(false);

    rerender({ conversationId: 'conversation-1' });
    expect(result.current.composerExactText).toBe(true);
    expect(result.current.composerText).toBe('ios-ux-proof.txt');

    act(() => {
      result.current.clearComposerDraft(getComposerDraftKey('conversation-1'));
    });
    expect(result.current.composerExactText).toBe(false);
    expect(result.current.composerText).toBe('');
  });
});
