import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { DeveloperModeLockedState } from '../../../src/screens/components/DeveloperModeLockedState';
import { i18n } from '../../../src/i18n/manager';

const mockNavigate = jest.fn();

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate, openDrawer: jest.fn() }),
  useRoute: () => ({ name: 'Terminal', params: {} }),
  useFocusEffect: jest.fn(),
}));

jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children, ...props }: any) => {
    const React = require('react');
    const { View } = require('react-native');
    return React.createElement(View, props, children);
  },
}));

jest.mock('../../../src/theme/useAppTheme', () => ({
  useAppTheme: () => ({
    colors: {
      background: '#000',
      border: '#333',
      header: '#111',
      text: '#fff',
      textSecondary: '#aaa',
      surfaceAlt: '#222',
      primary: '#0f0',
      onPrimary: '#000',
    },
  }),
}));

describe('DeveloperModeLockedState', () => {
  afterEach(() => {
    mockNavigate.mockClear();
  });

  it('shows the screen title and the locked explanation using i18n keys, not hardcoded English', () => {
    const { getByText, getByTestId } = render(
      <DeveloperModeLockedState testID="terminal-locked" titleKey="nav.terminal" />,
    );

    expect(getByTestId('terminal-locked')).toBeTruthy();
    expect(getByText(i18n.t('nav.terminal'))).toBeTruthy();
    expect(getByText(i18n.t('developerMode.lockedTitle'))).toBeTruthy();
    expect(getByText(i18n.t('developerMode.lockedMessage'))).toBeTruthy();
  });

  it('opens Settings at the developer destination when the CTA is pressed', () => {
    const { getByTestId } = render(
      <DeveloperModeLockedState testID="terminal-locked" titleKey="nav.terminal" />,
    );

    fireEvent.press(getByTestId('terminal-locked-open-settings'));

    expect(mockNavigate).toHaveBeenCalledWith('Settings', { destination: 'developer-remote-work' });
  });

  it('exposes a working back/menu control via the shared route leading button', () => {
    const { getByTestId } = render(
      <DeveloperModeLockedState testID="terminal-locked" titleKey="nav.terminal" />,
    );

    expect(getByTestId('terminal-locked-leading')).toBeTruthy();
  });
});
