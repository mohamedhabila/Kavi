import React from 'react';
import { render } from '@testing-library/react-native';
import { StyleSheet, Text } from 'react-native';

import { AppIconButton } from '../../src/components/navigation/AppIconButton';
import { AppTabButton } from '../../src/components/navigation/AppTabButton';

describe('shared navigation controls', () => {
  it('provides a labeled button with a cross-platform touch target', () => {
    const { getByLabelText } = render(
      <AppIconButton label="Refresh" onPress={jest.fn()}>
        <Text>icon</Text>
      </AppIconButton>,
    );

    const button = getByLabelText('Refresh');
    expect(button.props.accessibilityRole).toBe('button');
    expect(button.props.accessibilityState).toEqual({ disabled: false });
    expect(StyleSheet.flatten(button.props.style)).toMatchObject({
      minHeight: 48,
      minWidth: 48,
    });
  });

  it('provides selected and disabled tab semantics with a full touch target', () => {
    const { getByLabelText } = render(
      <AppTabButton disabled label="Browse" onPress={jest.fn()} selected>
        <Text>Browse</Text>
      </AppTabButton>,
    );

    const tab = getByLabelText('Browse');
    expect(tab.props.accessibilityRole).toBe('tab');
    expect(tab.props.accessibilityState).toEqual({ disabled: true, selected: true });
    expect(StyleSheet.flatten(tab.props.style).minHeight).toBe(48);
  });
});
