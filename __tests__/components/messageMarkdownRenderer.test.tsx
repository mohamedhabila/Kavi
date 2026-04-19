import React from 'react';
import { render } from '@testing-library/react-native';
import { StyleSheet, Text } from 'react-native';

jest.mock('react-native-marked', () => ({
  __esModule: true,
  Renderer: class {
    private keyIndex = 0;

    getKey() {
      this.keyIndex += 1;
      return `table-renderer-key-${this.keyIndex}`;
    }
  },
}));

import {
  getMessageMarkdownTableColumnWidths,
  MessageMarkdownTable,
} from '../../src/components/chat/messageMarkdownRenderer';

const colors = {
  surface: '#111111',
  surfaceAlt: '#1a1a1a',
  subtleBorder: '#333333',
} as any;

describe('messageMarkdownRenderer', () => {
  it('keeps markdown table columns within bounded cell widths', () => {
    expect(getMessageMarkdownTableColumnWidths(0, 320)).toEqual([]);
    expect(getMessageMarkdownTableColumnWidths(1, 720)).toEqual([220]);
    expect(getMessageMarkdownTableColumnWidths(3, 300)).toEqual([132, 132, 132]);
  });

  it('renders markdown tables inside a bounded horizontal scroll container', () => {
    const { getByTestId } = render(
      <MessageMarkdownTable
        header={[[<Text key="header">Header</Text>]]}
        rows={[[[<Text key="row-cell">Value</Text>]]]}
        colors={colors}
        isUser={false}
      />,
    );

    const frameStyle = StyleSheet.flatten(getByTestId('message-markdown-table-frame').props.style);
    const scrollStyle = StyleSheet.flatten(
      getByTestId('message-markdown-table-scroll').props.style,
    );
    const scrollContentStyle = StyleSheet.flatten(
      getByTestId('message-markdown-table-scroll').props.contentContainerStyle,
    );

    expect(frameStyle.maxWidth).toBe('100%');
    expect(frameStyle.flexShrink).toBe(1);
    expect(frameStyle.overflow).toBe('hidden');
    expect(scrollStyle.maxWidth).toBe('100%');
    expect(scrollStyle.flexGrow).toBe(0);
    expect(scrollStyle.flexShrink).toBe(1);
    expect(scrollContentStyle.flexGrow).toBe(0);
  });
});
