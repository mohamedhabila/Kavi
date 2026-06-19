import { render, fireEvent } from '@testing-library/react-native';
import { MessageBubble, installMessageBubbleTestHarness, makeMessage } from '../helpers/messageBubbleHarness';

describe('MessageBubble content rendering', () => {
  installMessageBubbleTestHarness();

  it('should render user message', () => {
    const { getByText } = render(<MessageBubble message={makeMessage()} />);
    expect(getByText('Hello world')).toBeTruthy();
  });

  it('should render assistant message', () => {
    const msg = makeMessage({ role: 'assistant', content: 'Hi there!' });
    const { getByText } = render(<MessageBubble message={msg} />);
    expect(getByText('Hi there!')).toBeTruthy();
  });

  it('should render the upgraded assistant bubble chrome', () => {
    const msg = makeMessage({ role: 'assistant', content: 'Styled answer' });
    const { getByTestId, getByText } = render(<MessageBubble message={msg} />);

    expect(getByTestId('assistant-bubble-chrome')).toBeTruthy();
    expect(getByText('Assistant')).toBeTruthy();
    expect(getByText('Styled answer')).toBeTruthy();
  });

  it('should strip leaked internal Gemini history text from assistant rendering', () => {
    const msg = makeMessage({
      role: 'assistant',
      content: [
        'Previous internal tool call: tool_catalog (category="files").',
        'Previous internal tool result: tool_catalog returned with structured tool catalog data.',
        'Here is the real answer.',
      ].join('\n'),
    });
    const { getByText, queryByText } = render(<MessageBubble message={msg} />);

    expect(getByText('Here is the real answer.')).toBeTruthy();
    expect(queryByText(/Previous internal tool call/)).toBeNull();
    expect(queryByText(/Previous internal tool result/)).toBeNull();
  });

  it('should render markdown through static elements instead of the markdown list wrapper', () => {
    const msg = makeMessage({ role: 'assistant', content: 'Very long **markdown** reply' });
    const { getByText, queryByTestId } = render(<MessageBubble message={msg} />);
    const marked = require('react-native-marked');

    expect(getByText('Very long **markdown** reply')).toBeTruthy();
    expect(marked.useMarkdown).toHaveBeenCalled();
    expect(marked.default).not.toHaveBeenCalled();
    expect(queryByTestId('legacy-markdown')).toBeNull();
  });

  it('should return null for tool messages', () => {
    const msg = makeMessage({ role: 'tool', content: 'tool result' });
    const { toJSON } = render(<MessageBubble message={msg} />);
    expect(toJSON()).toBeNull();
  });

  it('should collapse assistant code blocks by default', () => {
    const msg = makeMessage({
      role: 'assistant',
      content: 'Here is the page:\n\n```html\n<div>Hello</div>\n```',
    });
    const { getByText, queryByText } = render(<MessageBubble message={msg} />);

    expect(getByText('Show code')).toBeTruthy();
    expect(queryByText('<div>Hello</div>')).toBeNull();
  });

  it('should expand assistant code blocks on toggle', () => {
    const msg = makeMessage({
      role: 'assistant',
      content: 'Here is the page:\n\n```html\n<div>Hello</div>\n```',
    });
    const { getByText } = render(<MessageBubble message={msg} />);

    fireEvent.press(getByText('Show code'));
    expect(getByText('<div>Hello</div>')).toBeTruthy();
  });

  it('should collapse unterminated fenced code blocks using the markdown lexer', () => {
    const msg = makeMessage({
      role: 'assistant',
      content: 'Here is the fix:\n\n```ts\nconst x = 1;\nconst y = 2;',
    });
    const { getByText, queryByText } = render(<MessageBubble message={msg} />);

    expect(getByText('Here is the fix:\n\n')).toBeTruthy();
    expect(getByText('Show code')).toBeTruthy();
    expect(queryByText('const x = 1;\nconst y = 2;')).toBeNull();
  });

  it('should preserve later code blocks when malformed html starts the message', () => {
    const msg = makeMessage({
      role: 'assistant',
      content: '<div>\n```ts\nconst x = 1;\n',
    });
    const { getByText } = render(<MessageBubble message={msg} />);

    expect(getByText('<div>')).toBeTruthy();
    expect(getByText('Show code')).toBeTruthy();
  });

  it('should suppress older incomplete assistant segments when a newer malformed retry follows', () => {
    const msg = makeMessage({ role: 'assistant', content: 'Latest malformed partial' });
    const { getByText, queryByText } = render(
      <MessageBubble
        message={msg}
        responseSegments={[
          {
            id: 'segment-incomplete-1',
            messageId: 'assistant-incomplete-1',
            content: 'Old malformed partial',
            timestamp: Date.now(),
            assistantMetadata: {
              kind: 'final',
              completionStatus: 'incomplete',
              finishReason: 'response_failed',
            },
          },
          {
            id: 'segment-incomplete-2',
            messageId: 'assistant-incomplete-2',
            content: 'Latest malformed partial',
            timestamp: Date.now() + 1,
            assistantMetadata: {
              kind: 'final',
              completionStatus: 'incomplete',
              finishReason: 'response_failed',
            },
          },
        ]}
      />,
    );

    expect(queryByText('Old malformed partial')).toBeNull();
    expect(getByText('Latest malformed partial')).toBeTruthy();
  });
});
