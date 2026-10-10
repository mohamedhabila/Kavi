import { fireEvent, render } from '@testing-library/react-native';
import {
  MessageBubble,
  installMessageBubbleTestHarness,
  makeMessage,
} from '../helpers/messageBubbleHarness';

describe('MessageBubble continue', () => {
  installMessageBubbleTestHarness();

  const stopped = () =>
    makeMessage({
      role: 'assistant',
      content: 'I reached the most steps I can take at once.',
      assistantMetadata: {
        kind: 'final',
        completionStatus: 'complete',
        finishReason: 'max_iterations',
      },
    });

  it('offers a one-tap continue on an answer that handed the task back', () => {
    const onContinue = jest.fn();
    const { getByTestId } = render(<MessageBubble message={stopped()} onContinue={onContinue} />);

    fireEvent.press(getByTestId('assistant-continue-task'));

    expect(onContinue).toHaveBeenCalledTimes(1);
  });

  it('shows nothing extra when there is nothing to continue', () => {
    const { queryByTestId } = render(<MessageBubble message={stopped()} />);

    expect(queryByTestId('assistant-continue-task')).toBeNull();
  });
});
