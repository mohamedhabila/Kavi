import React from 'react';
import { Alert, AppState, NativeModules, Platform } from 'react-native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import {
  getAssistantRoleState,
  openAssistantSettings,
} from '../../src/services/assistant/assistantRole';
import { SettingsSystemAccessRow } from '../../src/screens/settings/SettingsSystemAccessRow';
import { ASSISTANT_ROLE_ACCESS } from '../../src/screens/settings/systemAccesses';

const originalOS = Platform.OS;
const mockGetAssistantRoleState = jest.fn();
const mockOpenAssistantSettings = jest.fn();

function setPlatform(os: string): void {
  Object.defineProperty(Platform, 'OS', { configurable: true, get: () => os });
}

beforeEach(() => {
  jest.clearAllMocks();
  setPlatform('android');
  NativeModules.KaviAssistant = {
    getAssistantRoleState: mockGetAssistantRoleState,
    openAssistantSettings: mockOpenAssistantSettings,
  };
  mockGetAssistantRoleState.mockResolvedValue('not_held');
  mockOpenAssistantSettings.mockResolvedValue(true);
});

afterEach(() => {
  setPlatform(originalOS);
  delete NativeModules.KaviAssistant;
  jest.restoreAllMocks();
});

describe('phone assistant role', () => {
  it('reads the role and opens its settings through the native module', async () => {
    mockGetAssistantRoleState.mockResolvedValueOnce('held');

    await expect(getAssistantRoleState()).resolves.toBe('held');
    await expect(openAssistantSettings()).resolves.toBe(true);
  });

  it('has no role where there is no native module (iOS)', async () => {
    setPlatform('ios');

    await expect(getAssistantRoleState()).resolves.toBe('unavailable');
    await expect(openAssistantSettings()).resolves.toBe(false);
    expect(mockGetAssistantRoleState).not.toHaveBeenCalled();
  });
});

describe('assistant role settings row', () => {
  const t = (key: string) => key;
  const styles = {};
  const colors = { primary: '#0f0', textTertiary: '#777' } as never;

  it('offers to make Kavi the assistant and opens the system settings', async () => {
    const view = render(
      <SettingsSystemAccessRow
        access={ASSISTANT_ROLE_ACCESS}
        colors={colors}
        styles={styles}
        t={t}
      />,
    );

    await waitFor(() => expect(view.getByTestId('settings-assistant-role')).toBeTruthy());
    expect(view.getByText('settings.notificationsVoice.assistantNotHeldHint')).toBeTruthy();
    fireEvent.press(view.getByTestId('settings-assistant-role'));
    await waitFor(() => expect(mockOpenAssistantSettings).toHaveBeenCalledTimes(1));
  });

  it('shows the role as held after the person comes back from settings', async () => {
    let onAppStateChange: ((state: string) => void) | undefined;
    jest.spyOn(AppState, 'addEventListener').mockImplementation(((_type: string, handler: any) => {
      onAppStateChange = handler;
      return { remove: jest.fn() };
    }) as never);
    const view = render(
      <SettingsSystemAccessRow
        access={ASSISTANT_ROLE_ACCESS}
        colors={colors}
        styles={styles}
        t={t}
      />,
    );
    await waitFor(() =>
      expect(view.getByText('settings.notificationsVoice.assistantNotHeldHint')).toBeTruthy(),
    );

    mockGetAssistantRoleState.mockResolvedValueOnce('held');
    act(() => onAppStateChange?.('active'));

    await waitFor(() =>
      expect(view.getByText('settings.notificationsVoice.assistantHeldHint')).toBeTruthy(),
    );
  });

  it('says so when the phone has no assistant settings to open', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    mockOpenAssistantSettings.mockResolvedValueOnce(false);
    const view = render(
      <SettingsSystemAccessRow
        access={ASSISTANT_ROLE_ACCESS}
        colors={colors}
        styles={styles}
        t={t}
      />,
    );

    await waitFor(() => expect(view.getByTestId('settings-assistant-role')).toBeTruthy());
    fireEvent.press(view.getByTestId('settings-assistant-role'));

    await waitFor(() =>
      expect(alert).toHaveBeenCalledWith(
        'settings.notificationsVoice.assistantSettingsUnavailable',
      ),
    );
  });

  it('is hidden where there is no assistant role', async () => {
    mockGetAssistantRoleState.mockResolvedValue('unavailable');
    const view = render(
      <SettingsSystemAccessRow
        access={ASSISTANT_ROLE_ACCESS}
        colors={colors}
        styles={styles}
        t={t}
      />,
    );
    await act(async () => undefined);

    expect(view.queryByTestId('settings-assistant-role')).toBeNull();
  });
});
