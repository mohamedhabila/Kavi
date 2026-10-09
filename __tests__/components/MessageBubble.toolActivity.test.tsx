import { fireEvent, render } from '@testing-library/react-native';
import {
  MessageBubble,
  installMessageBubbleTestHarness,
  makeMessage,
} from '../helpers/messageBubbleHarness';
import type { ToolCall } from '../../src/types/message';

function tool(id: string, name: string, args: Record<string, unknown>): ToolCall {
  return { id, name, arguments: JSON.stringify(args), status: 'completed', result: 'ok' };
}

function segment(id: string, content: string, toolCalls?: ToolCall[]) {
  return { id, messageId: `m-${id}`, content, timestamp: 1, ...(toolCalls ? { toolCalls } : {}) };
}

describe('MessageBubble tool activity', () => {
  installMessageBubbleTestHarness();

  it('shows a multi-step answer as one activity line instead of a row per step', () => {
    // The user's request: consecutive tool calls must not take over the transcript.
    const message = makeMessage({ role: 'assistant', content: 'You are free on Tuesday.' });
    const screen = render(
      <MessageBubble
        message={message}
        responseSegments={[
          segment('s1', '', [tool('a', 'calendar_events', {})]),
          segment('s2', '', [tool('b', 'contacts_search', { query: 'Sam' })]),
          segment('s3', '', [tool('c', 'calendar_events', {})]),
          segment('s4', 'You are free on Tuesday.'),
        ]}
      />,
    );

    expect(screen.getAllByTestId('tool-activity-group')).toHaveLength(1);
    expect(screen.getByText('You are free on Tuesday.')).toBeTruthy();
    expect(screen.queryByTestId('tool-activity-steps')).toBeNull();

    fireEvent.press(screen.getByTestId('tool-activity-toggle'));

    expect(screen.getByTestId('tool-activity-steps')).toBeTruthy();
  });

  it('keeps a single tool call as an ordinary row', () => {
    const message = makeMessage({ role: 'assistant', content: 'Saved.' });
    const screen = render(
      <MessageBubble
        message={message}
        responseSegments={[
          segment('s1', '', [tool('a', 'write_file', { path: 'notes.md' })]),
          segment('s2', 'Saved.'),
        ]}
      />,
    );

    expect(screen.queryByTestId('tool-activity-group')).toBeNull();
  });
});
