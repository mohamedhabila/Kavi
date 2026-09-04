import React from 'react';
import { Text } from 'react-native';
import { render, fireEvent } from '@testing-library/react-native';
import { withDeveloperModeGate } from '../../src/navigation/withDeveloperModeGate';
import { useSettingsStore } from '../../src/store/useSettingsStore';

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

jest.mock('../../src/theme/useAppTheme', () => ({
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

jest.mock('../../src/i18n/useTranslation', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const DummyScreen: React.FC = () => <Text>real-developer-screen-content</Text>;

describe('withDeveloperModeGate', () => {
  afterEach(() => {
    useSettingsStore.setState({ developerModeEnabled: false } as any);
    mockNavigate.mockClear();
  });

  it('renders the locked state instead of the real screen when developer mode is off', () => {
    useSettingsStore.setState({ developerModeEnabled: false } as any);
    const Gated = withDeveloperModeGate(DummyScreen, 'nav.terminal', 'terminal-locked');

    const { queryByText, getByTestId } = render(<Gated />);

    expect(queryByText('real-developer-screen-content')).toBeNull();
    expect(getByTestId('terminal-locked')).toBeTruthy();
  });

  it('navigates to the developer settings destination from the locked state', () => {
    useSettingsStore.setState({ developerModeEnabled: false } as any);
    const Gated = withDeveloperModeGate(DummyScreen, 'nav.terminal', 'terminal-locked');

    const { getByTestId } = render(<Gated />);
    fireEvent.press(getByTestId('terminal-locked-open-settings'));

    expect(mockNavigate).toHaveBeenCalledWith('Settings', { destination: 'developer-remote-work' });
  });

  it('renders the real screen when developer mode is on', () => {
    useSettingsStore.setState({ developerModeEnabled: true } as any);
    const Gated = withDeveloperModeGate(DummyScreen, 'nav.terminal', 'terminal-locked');

    const { getByText, queryByTestId } = render(<Gated />);

    expect(getByText('real-developer-screen-content')).toBeTruthy();
    expect(queryByTestId('terminal-locked')).toBeNull();
  });
});
