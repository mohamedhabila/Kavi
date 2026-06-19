import { render, within } from '@testing-library/react-native';
import { MessageBubble, installMessageBubbleTestHarness, makeMessage } from '../helpers/messageBubbleHarness';

describe('MessageBubble status and tool states', () => {
  installMessageBubbleTestHarness();

  it('should not show actions when streaming', () => {
    const msg = makeMessage({ role: 'assistant', content: 'Streaming...' });
    const { queryByTestId } = render(<MessageBubble message={msg} isStreaming={true} />);
    expect(queryByTestId('icon-Copy')).toBeNull();
  });

  it('should show streaming dot when content is empty and streaming', () => {
    const msg = makeMessage({ role: 'assistant', content: '' });
    const { getByLabelText } = render(<MessageBubble message={msg} isStreaming={true} />);
    expect(getByLabelText('Assistant is typing')).toBeTruthy();
  });

  it('should show error badge for error messages', () => {
    const msg = makeMessage({ role: 'assistant', content: 'Failed', isError: true });
    const { getByText } = render(<MessageBubble message={msg} />);
    expect(getByText('Error')).toBeTruthy();
  });

  it('should render reasoning block for assistant with reasoning', () => {
    const msg = makeMessage({
      role: 'assistant',
      content: 'Answer',
      reasoning: 'Let me think about this...',
    });
    const { getByText } = render(<MessageBubble message={msg} />);
    // ThinkingBlock shows "Thinking" label
    expect(getByText('Thinking')).toBeTruthy();
  });

  it('should hide the inline reasoning block when assistant reasoning is only a placeholder', () => {
    const msg = makeMessage({
      role: 'assistant',
      content: '',
      reasoning: '…',
    });
    const { getByLabelText, queryByTestId, queryByText } = render(
      <MessageBubble message={msg} isStreaming={true} />,
    );

    expect(queryByTestId('assistant-inline-reasoning')).toBeNull();
    expect(queryByText('Thinking...')).toBeNull();
    expect(getByLabelText('Assistant is typing')).toBeTruthy();
  });

  it('should hide the inline reasoning block for synthetic tool-status reasoning', () => {
    const msg = makeMessage({
      role: 'assistant',
      content: 'Answer',
      reasoning: 'Using read_file…',
    });
    const { getByText, queryByTestId, queryByText } = render(<MessageBubble message={msg} />);

    expect(queryByTestId('assistant-inline-reasoning')).toBeNull();
    expect(queryByText('Thinking')).toBeNull();
    expect(getByText('Answer')).toBeTruthy();
  });

  it('should render assistant reasoning inline within the response bubble content', () => {
    const msg = makeMessage({
      role: 'assistant',
      content: 'Answer',
      reasoning: 'Let me think about this...',
    });
    const { getByTestId, getByText, queryByTestId } = render(<MessageBubble message={msg} />);

    const contentContainer = getByTestId('assistant-content-container');

    expect(queryByTestId('assistant-reasoning-surface')).toBeNull();
    expect(within(contentContainer).getByTestId('assistant-inline-reasoning')).toBeTruthy();
    expect(getByText('Thinking')).toBeTruthy();
    expect(getByText('Answer')).toBeTruthy();
  });

  it('should render streaming reasoning inline ahead of the response content', () => {
    const msg = makeMessage({
      role: 'assistant',
      content: 'Answer',
      reasoning: 'Need plan',
    });
    const { getByTestId, getByText, queryByTestId } = render(
      <MessageBubble message={msg} isStreaming={true} />,
    );

    const contentContainer = getByTestId('assistant-content-container');

    expect(queryByTestId('assistant-reasoning-surface')).toBeNull();
    expect(within(contentContainer).getByTestId('assistant-inline-reasoning')).toBeTruthy();
    expect(within(contentContainer).getByText('Thinking...')).toBeTruthy();
    expect(within(contentContainer).getByTestId('message-streaming-text')).toBeTruthy();
    expect(within(contentContainer).queryByText('Need plan')).toBeNull();
    expect(getByText('Thinking...')).toBeTruthy();
  });

  it('should render tool calls in assistant messages', () => {
    const msg = makeMessage({
      role: 'assistant',
      content: 'Done',
      toolCalls: [
        {
          id: 'tc1',
          name: 'read_file',
          arguments: '{"path":"test.txt"}',
          status: 'completed',
          result: 'file contents',
        },
      ],
    });
    const { getByText } = render(<MessageBubble message={msg} />);
    expect(getByText('Read File')).toBeTruthy();
  });

  it('should render grouped assistant rounds as one bubble with inline tool order', () => {
    const msg = makeMessage({ role: 'assistant', content: 'Combined response' });
    const { getByText } = render(
      <MessageBubble
        message={msg}
        responseSegments={[
          {
            id: 'segment-1',
            messageId: 'assistant-1',
            content: 'First round',
            toolCalls: [
              {
                id: 'tc1',
                name: 'read_file',
                arguments: '{"path":"test.txt"}',
                status: 'completed',
                result: 'file contents',
              },
            ],
            timestamp: Date.now(),
          },
          {
            id: 'segment-2',
            messageId: 'assistant-2',
            content: 'Second round',
            timestamp: Date.now(),
          },
        ]}
      />,
    );

    expect(getByText('First round')).toBeTruthy();
    expect(getByText('Read File')).toBeTruthy();
    expect(getByText('Second round')).toBeTruthy();
  });

  it('should render a repeated tool status update only once across grouped assistant segments', () => {
    const msg = makeMessage({ role: 'assistant', content: 'Combined response' });
    const { getByText, queryAllByText } = render(
      <MessageBubble
        message={msg}
        responseSegments={[
          {
            id: 'segment-1',
            messageId: 'assistant-1',
            content: 'Checking the file.',
            toolCalls: [
              {
                id: 'tc1',
                name: 'read_file',
                arguments: '{"path":"test.txt"}',
                status: 'pending',
              },
            ],
            timestamp: Date.now(),
          },
          {
            id: 'segment-2',
            messageId: 'assistant-2',
            content: '',
            toolCalls: [
              {
                id: 'tc1',
                name: 'read_file',
                arguments: '{"path":"test.txt"}',
                status: 'running',
                progressText: 'Reading source',
              },
            ],
            timestamp: Date.now() + 1,
          },
          {
            id: 'segment-3',
            messageId: 'assistant-3',
            content: 'Found the issue.',
            toolCalls: [
              {
                id: 'tc1',
                name: 'read_file',
                arguments: '{"path":"test.txt"}',
                status: 'completed',
                result: 'file contents',
              },
            ],
            timestamp: Date.now() + 2,
          },
        ]}
      />,
    );

    expect(getByText('Checking the file.')).toBeTruthy();
    expect(getByText('Found the issue.')).toBeTruthy();
    expect(queryAllByText('Read File')).toHaveLength(1);
  });

  it('should show a working banner while assistant response is streaming', () => {
    const msg = makeMessage({
      role: 'assistant',
      content: 'Creating the files now.',
      toolCalls: [
        {
          id: 'tc1',
          name: 'write_file',
          arguments: '{"path":"game/index.html"}',
          status: 'running',
        },
      ],
    });
    const { getAllByText, getByTestId } = render(<MessageBubble message={msg} isStreaming />);
    expect(getByTestId('assistant-bubble-status-pill')).toBeTruthy();
    expect(getAllByText('Creating game/index.html').length).toBeGreaterThan(0);
  });

  it('should clamp line-heavy streaming content to a recent preview', () => {
    const msg = makeMessage({
      role: 'assistant',
      content: Array.from({ length: 60 }, (_, index) => `line ${index}`).join('\n'),
    });
    const { getByTestId, getByText, queryByText } = render(
      <MessageBubble message={msg} isStreaming />,
    );

    expect(getByTestId('message-streaming-text')).toBeTruthy();
    expect(getByText(/line 59/)).toBeTruthy();
    expect(queryByText(/line 0/)).toBeNull();
  });

  it('should render visual decorations for message effects', () => {
    const msg = makeMessage({ role: 'assistant', content: 'Celebrate', effectId: 'confetti' });
    const { getByTestId } = render(<MessageBubble message={msg} />);
    expect(getByTestId('message-effect-confetti')).toBeTruthy();
  });
});
