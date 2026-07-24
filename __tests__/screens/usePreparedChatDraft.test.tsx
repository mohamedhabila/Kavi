import { renderHook } from '@testing-library/react-native';
import { usePreparedChatDraft } from '../../src/screens/usePreparedChatDraft';

const preparedDraft = {
  requestId: 'request-1',
  conversationId: 'conversation-1',
  source: 'delegated-work-retry' as const,
  text: 'Please retry the delegated work.',
};

describe('usePreparedChatDraft', () => {
  it('applies a valid draft once when its source conversation is active', () => {
    const onApplyText = jest.fn();
    const onConsumed = jest.fn();
    const { rerender } = renderHook(
      ({ composerText }) =>
        usePreparedChatDraft({
          activeConversationId: 'conversation-1',
          composerText,
          editingMessageId: null,
          onApplyText,
          onConsumed,
          preparedDraft,
        }),
      { initialProps: { composerText: '' } },
    );

    expect(onApplyText).toHaveBeenCalledTimes(1);
    expect(onApplyText).toHaveBeenCalledWith(preparedDraft.text);
    expect(onConsumed).toHaveBeenCalledWith('request-1', 'applied');

    rerender({ composerText: preparedDraft.text });
    expect(onApplyText).toHaveBeenCalledTimes(1);
    expect(onConsumed).toHaveBeenCalledTimes(1);
  });

  it('waits for the intended conversation instead of drafting in another chat', () => {
    const onApplyText = jest.fn();
    const onConsumed = jest.fn();
    const { rerender } = renderHook(
      ({ activeConversationId }) =>
        usePreparedChatDraft({
          activeConversationId,
          composerText: '',
          editingMessageId: null,
          onApplyText,
          onConsumed,
          preparedDraft,
        }),
      { initialProps: { activeConversationId: 'conversation-2' } },
    );

    expect(onApplyText).not.toHaveBeenCalled();
    rerender({ activeConversationId: 'conversation-1' });
    expect(onApplyText).toHaveBeenCalledWith(preparedDraft.text);
  });

  it.each([
    { composerText: 'Keep my draft', editingMessageId: null },
    { composerText: '', editingMessageId: 'message-1' },
  ])('preserves existing composition state %#', ({ composerText, editingMessageId }) => {
    const onApplyText = jest.fn();
    const onConsumed = jest.fn();

    renderHook(() =>
      usePreparedChatDraft({
        activeConversationId: 'conversation-1',
        composerText,
        editingMessageId,
        onApplyText,
        onConsumed,
        preparedDraft,
      }),
    );

    expect(onApplyText).not.toHaveBeenCalled();
    expect(onConsumed).toHaveBeenCalledWith('request-1', 'preserved_existing');
  });

  it('ignores malformed navigation data', () => {
    const onApplyText = jest.fn();
    const onConsumed = jest.fn();

    renderHook(() =>
      usePreparedChatDraft({
        activeConversationId: 'conversation-1',
        composerText: '',
        editingMessageId: null,
        onApplyText,
        onConsumed,
        preparedDraft: { ...preparedDraft, source: 'unknown' },
      }),
    );

    expect(onApplyText).not.toHaveBeenCalled();
    expect(onConsumed).not.toHaveBeenCalled();
  });
});
