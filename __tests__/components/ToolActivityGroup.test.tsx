import React from 'react';
import { Text } from 'react-native';
import { fireEvent, render } from '@testing-library/react-native';
import { ToolActivityGroup } from '../../src/components/chat/ToolActivityGroup';
import { i18n } from '../../src/i18n/manager';
import type { ToolCall } from '../../src/types/message';

function tool(id: string, status: ToolCall['status'], name = 'read_file'): ToolCall {
  return { id, name, arguments: '{"path":"notes.md"}', status };
}

function renderGroup(toolCalls: ToolCall[]) {
  return render(
    <ToolActivityGroup toolCalls={toolCalls}>
      <Text testID="folded-step">step rows</Text>
    </ToolActivityGroup>,
  );
}

describe('ToolActivityGroup', () => {
  it('collapses settled work into one line that counts the steps', () => {
    const screen = renderGroup([tool('a', 'completed'), tool('b', 'completed')]);

    expect(screen.getByText(i18n.t('toolActivity.completedSteps', { count: 2 }))).toBeTruthy();
    expect(screen.queryByTestId('folded-step')).toBeNull();
  });

  it('expands to the folded steps and collapses again', () => {
    const screen = renderGroup([tool('a', 'completed'), tool('b', 'completed')]);

    fireEvent.press(screen.getByTestId('tool-activity-toggle'));
    expect(screen.getByTestId('folded-step')).toBeTruthy();
    expect(screen.getByTestId('tool-activity-toggle').props.accessibilityState).toEqual(
      expect.objectContaining({ expanded: true }),
    );

    fireEvent.press(screen.getByTestId('tool-activity-toggle'));
    expect(screen.queryByTestId('folded-step')).toBeNull();
  });

  it('names the step in progress and how many are done while the work runs', () => {
    const screen = renderGroup([
      tool('a', 'completed'),
      tool('b', 'running'),
      tool('c', 'pending'),
    ]);

    expect(screen.getByText(i18n.t('toolActivity.progress', { done: 1, total: 3 }))).toBeTruthy();
    expect(screen.getByTestId('tool-activity-toggle').props.accessibilityState).toEqual(
      expect.objectContaining({ busy: true }),
    );
  });

  it('says when some steps did not work', () => {
    const screen = renderGroup([tool('a', 'completed'), tool('b', 'failed')]);

    expect(screen.getByText(i18n.t('toolActivity.failedSteps', { count: 1 }))).toBeTruthy();
  });
});
