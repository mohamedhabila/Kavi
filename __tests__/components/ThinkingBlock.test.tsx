// ---------------------------------------------------------------------------
// Tests — ThinkingBlock Component
// ---------------------------------------------------------------------------

import { render, fireEvent } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { ThinkingBlock } from '../../src/components/chat/ThinkingBlock';

jest.mock('../../src/theme/useAppTheme', () => ({
  useAppTheme: () => ({
    colors: {
      textTertiary: '#777',
      textSecondary: '#aaa',
      subtleBorder: '#444',
    },
  }),
  AppPalette: {},
}));

describe('ThinkingBlock', () => {
  it('should render nothing when reasoning is empty', () => {
    const { toJSON } = render(<ThinkingBlock reasoning="" />);
    expect(toJSON()).toBeNull();
  });

  it('should render nothing when reasoning is only whitespace', () => {
    const { toJSON } = render(<ThinkingBlock reasoning="     " />);
    expect(toJSON()).toBeNull();
  });

  it('should render nothing for placeholder-only reasoning', () => {
    const { toJSON } = render(<ThinkingBlock reasoning="…" isStreaming={true} />);
    expect(toJSON()).toBeNull();
  });

  it('should render nothing for synthetic tool-status reasoning', () => {
    const { toJSON } = render(<ThinkingBlock reasoning="Using read_file…" isStreaming={true} />);
    expect(toJSON()).toBeNull();
  });

  it('should show "Thinking" label when not streaming', () => {
    const { getByText } = render(<ThinkingBlock reasoning="Some reasoning" />);
    expect(getByText('Thinking')).toBeTruthy();
  });

  it('should show "Thinking..." label when streaming', () => {
    const { getByText } = render(<ThinkingBlock reasoning="Reasoning" isStreaming={true} />);
    expect(getByText('Thinking...')).toBeTruthy();
  });

  it('should not show content by default (collapsed)', () => {
    const { getByTestId, queryByText } = render(<ThinkingBlock reasoning="Deep thoughts" />);
    const containerStyle = StyleSheet.flatten(getByTestId('thinking-block-container').props.style);

    expect(containerStyle).toEqual(
      expect.objectContaining({
        height: 30,
        overflow: 'hidden',
      }),
    );
    expect(getByTestId('thinking-block-label').props.numberOfLines).toBe(1);
    expect(queryByText('Deep thoughts')).toBeNull();
  });

  it('should show content when expanded', () => {
    const { getByText } = render(<ThinkingBlock reasoning="Deep thoughts" />);
    fireEvent.press(getByText('Thinking'));
    expect(getByText('Deep thoughts')).toBeTruthy();
  });

  it('should toggle content on repeated press', () => {
    const { getByText, queryByText } = render(<ThinkingBlock reasoning="Thoughts" />);
    fireEvent.press(getByText('Thinking'));
    expect(getByText('Thoughts')).toBeTruthy();
    fireEvent.press(getByText('Thinking'));
    expect(queryByText('Thoughts')).toBeNull();
  });

  it('should render brain icon', () => {
    const { getByTestId } = render(<ThinkingBlock reasoning="test" />);
    expect(getByTestId('icon-Brain')).toBeTruthy();
  });

  it('should render chevron icons', () => {
    const { getByTestId, getByText } = render(<ThinkingBlock reasoning="test" />);
    expect(getByTestId('icon-ChevronRight')).toBeTruthy();
    fireEvent.press(getByText('Thinking'));
    expect(getByTestId('icon-ChevronDown')).toBeTruthy();
  });
});
