import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { Clipboard, MessageBubble, installMessageBubbleTestHarness, makeMessage, shareTextExport } from '../helpers/messageBubbleHarness';

describe('MessageBubble actions', () => {
  installMessageBubbleTestHarness();

  it('should strip leaked internal Gemini history text when copying assistant content', () => {
    const msg = makeMessage({
      role: 'assistant',
      content: [
        '[Historical context: assistant called tool "tool_catalog" with arguments {}]',
        '[Historical context: tool "tool_catalog" returned: giant blob]',
        'Clean answer.',
      ].join('\n'),
    });
    const { getByTestId } = render(<MessageBubble message={msg} />);

    fireEvent.press(getByTestId('icon-Copy').parent || getByTestId('icon-Copy'));
    expect(Clipboard.setStringAsync).toHaveBeenCalledWith('Clean answer.');
  });

  it('should copy message content on copy press', () => {
    const msg = makeMessage({ content: 'Copy me' });
    const { getByTestId } = render(<MessageBubble message={msg} />);
    const copyIcon = getByTestId('icon-Copy');
    fireEvent.press(copyIcon.parent || copyIcon);
    expect(Clipboard.setStringAsync).toHaveBeenCalledWith('Copy me');
  });

  it('should show edit button for user messages', () => {
    const onEdit = jest.fn();
    const msg = makeMessage({ role: 'user', content: 'Edit me' });
    const { getByTestId } = render(<MessageBubble message={msg} onEdit={onEdit} />);
    const editIcon = getByTestId('icon-Edit2');
    expect(editIcon).toBeTruthy();
    fireEvent.press(editIcon.parent || editIcon);
    expect(onEdit).toHaveBeenCalledWith('msg1', 'Edit me');
  });

  it('should show retry button for assistant messages', () => {
    const onRetry = jest.fn();
    const msg = makeMessage({ role: 'assistant', content: 'Retry me' });
    const { getByTestId } = render(<MessageBubble message={msg} onRetry={onRetry} />);
    const retryIcon = getByTestId('icon-RotateCcw');
    fireEvent.press(retryIcon.parent || retryIcon);
    expect(onRetry).toHaveBeenCalledWith('msg1');
  });

  it('should share an assistant response transcript', async () => {
    const msg = makeMessage({ role: 'assistant', content: 'Share me' });
    const { getByTestId } = render(<MessageBubble message={msg} />);

    fireEvent.press(getByTestId('icon-Share2').parent || getByTestId('icon-Share2'));

    await waitFor(() => {
      expect(shareTextExport).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining('Share me'),
          mimeType: 'text/markdown',
        }),
      );
    });
  });

  it('should use retryMessageId when retrying a merged assistant response', () => {
    const onRetry = jest.fn();
    const msg = makeMessage({ role: 'assistant', content: 'Retry me' });
    const { getByTestId } = render(
      <MessageBubble message={msg} onRetry={onRetry} retryMessageId="assistant-tail" />,
    );

    fireEvent.press(getByTestId('icon-RotateCcw').parent || getByTestId('icon-RotateCcw'));
    expect(onRetry).toHaveBeenCalledWith('assistant-tail');
  });
});
