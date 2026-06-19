import { render, fireEvent } from '@testing-library/react-native';
import { MessageBubble, getMarkdownCalls, installMessageBubbleTestHarness, joinMarkdownCalls, makeAgentRun, makeMessage } from '../helpers/messageBubbleHarness';

describe('MessageBubble long content stability', () => {
  installMessageBubbleTestHarness();

  it('should keep very long code blocks collapsed inline without the stale viewer flow', () => {
    const msg = makeMessage({
      role: 'assistant',
      content:
        '```ts\n' + Array.from({ length: 120 }, (_, index) => `line ${index}`).join('\n') + '\n```',
    });
    const { getByText, queryByTestId, queryByText } = render(<MessageBubble message={msg} />);

    expect(queryByTestId('assistant-preview-text')).toBeNull();
    expect(queryByTestId('open-full-response-button')).toBeNull();
    expect(getByText('Show code')).toBeTruthy();
    expect(queryByText(/line 119/)).toBeNull();

    fireEvent.press(getByText('Show code'));

    expect(getByText(/line 119/)).toBeTruthy();
  });

  it('should render long assistant content inline without Show more', () => {
    const msg = makeMessage({
      role: 'assistant',
      content: Array.from({ length: 25 }, (_, index) => `- item ${index}`).join('\n'),
    });
    const { getByTestId, queryByTestId, queryByText } = render(<MessageBubble message={msg} />);

    expect(getByTestId('assistant-content-container')).toBeTruthy();
    expect(queryByTestId('assistant-preview-text')).toBeNull();
    expect(queryByText('Show more…')).toBeNull();
    expect(queryByTestId('open-full-response-button')).toBeNull();
    expect(joinMarkdownCalls()).toContain('- item 24');
  });

  it('should render very long markdown inline without Show more', () => {
    const msg = makeMessage({
      role: 'assistant',
      content: Array.from(
        { length: 300 },
        (_, index) => `paragraph ${index} ${'x'.repeat(40)}`,
      ).join('\n\n'),
    });
    const { getByTestId, queryByTestId, queryByText } = render(<MessageBubble message={msg} />);

    expect(getByTestId('assistant-content-container')).toBeTruthy();
    expect(queryByTestId('assistant-preview-text')).toBeNull();
    expect(queryByText('Show more…')).toBeNull();
    expect(queryByTestId('open-full-response-button')).toBeNull();
    expect(getMarkdownCalls().some((value) => value.includes('paragraph 299'))).toBe(true);
  });

  it('should keep a completed long agent final response inline without Show more', () => {
    const msg = makeMessage({
      role: 'assistant',
      content: Array.from({ length: 30 }, (_, index) => `- item ${index}`).join('\n'),
      assistantMetadata: {
        kind: 'final',
        completionStatus: 'complete',
        finishReason: 'graph_finalized',
      },
    });
    const { getByTestId, getByText, queryByText, queryByTestId } = render(
      <MessageBubble message={msg} agentRun={makeAgentRun({ status: 'completed' })} />,
    );

    expect(getByTestId('assistant-content-container')).toBeTruthy();
    expect(queryByTestId('assistant-preview-text')).toBeNull();
    expect(queryByText('Show more…')).toBeNull();
    expect(getByText(/item 29/)).toBeTruthy();
  });

  it('should not render the stale full response viewer for long assistant content', () => {
    const longContent = 'A'.repeat(8000);
    const msg = makeMessage({ role: 'assistant', content: longContent });
    const { queryByText, queryByTestId } = render(<MessageBubble message={msg} />);

    expect(queryByText('Show more…')).toBeNull();
    expect(queryByTestId('assistant-fullscreen-viewer')).toBeNull();
    expect(queryByTestId('open-full-response-button')).toBeNull();
  });

  it('should render short assistant content without Show more button', () => {
    const msg = makeMessage({ role: 'assistant', content: 'Short response.' });
    const { queryByText, queryByTestId, getByTestId } = render(<MessageBubble message={msg} />);
    expect(queryByText('Show more…')).toBeNull();
    expect(queryByTestId('open-full-response-button')).toBeNull();
    expect(getByTestId('assistant-content-container')).toBeTruthy();
  });

  it('should render long markdown inline without the stale preview viewer flow', () => {
    const longContent = Array.from(
      { length: 250 },
      (_, index) => `paragraph ${index} ${'b'.repeat(40)}`,
    ).join('\n\n');
    const msg = makeMessage({ role: 'assistant', content: longContent });
    const { queryByText, queryByTestId } = render(<MessageBubble message={msg} />);

    expect(queryByText('Show more…')).toBeNull();
    expect(queryByTestId('assistant-preview-text')).toBeNull();
    expect(queryByTestId('open-full-response-button')).toBeNull();
    expect(getMarkdownCalls().some((value) => value.includes('paragraph 249'))).toBe(true);
  });

  it('should render markdown tables inline without preview collapse', () => {
    const tableRows = Array.from(
      { length: 8 },
      (_, index) =>
        `| Risk ${index} | ${index % 2 === 0 ? 'Medium' : 'High'} | Transition from READ_EXTERNAL_STORAGE to the system photo picker, upgrade expo-image-picker support, and audit long-running background workflows for compatibility. |`,
    );
    const msg = makeMessage({
      role: 'assistant',
      content: [
        '### Android 16 Risk Matrix',
        '',
        '| Risk Area | Impact Level | Mitigation Strategy |',
        '| :--- | :--- | :--- |',
        ...tableRows,
      ].join('\n'),
    });
    const { queryByTestId } = render(<MessageBubble message={msg} />);

    expect(queryByTestId('assistant-preview-text')).toBeNull();
    expect(queryByTestId('open-full-response-button')).toBeNull();
    expect(getMarkdownCalls().some((value) => value.includes('Android 16 Risk Matrix'))).toBe(true);
    expect(
      getMarkdownCalls().some((value) =>
        value.includes('Risk Area | Impact Level | Mitigation Strategy'),
      ),
    ).toBe(true);
  });

  it('should fall back to plain text when assistant content exceeds the markdown parse budget', () => {
    const marked = require('react-native-marked');
    const msg = makeMessage({
      role: 'assistant',
      content: 'L'.repeat(40_100),
    });
    const { getByTestId, getByText, queryByTestId } = render(<MessageBubble message={msg} />);

    expect(queryByTestId('assistant-preview-text')).toBeNull();
    expect(queryByTestId('open-full-response-button')).toBeNull();
    expect(marked.useMarkdown).not.toHaveBeenCalled();
    expect(getByTestId('assistant-plain-full')).toBeTruthy();
    expect(getByText('Large response shown as plain text for stability.')).toBeTruthy();
    expect(marked.useMarkdown).not.toHaveBeenCalled();
  });

  it('should warn inline when the response is truncated to the hard render limit', () => {
    const msg = makeMessage({
      role: 'assistant',
      content: 'T'.repeat(140_100),
    });
    const { getByText, queryByTestId } = render(<MessageBubble message={msg} />);

    expect(queryByTestId('assistant-fullscreen-viewer')).toBeNull();
    expect(queryByTestId('open-full-response-button')).toBeNull();
    expect(getByText('Extremely long response truncated for stability.')).toBeTruthy();
  });
});
