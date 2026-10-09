import React from 'react';
import { Alert, Text } from 'react-native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import {
  SchedulerReminderList,
  usePendingReminders,
} from '../../src/components/scheduler/SchedulerReminderList';
import { createSchedulerStyles } from '../../src/components/scheduler/Scheduler.styles';
import { i18n } from '../../src/i18n/manager';
import type { ReminderRecord } from '../../src/services/scheduler/reminders/types';

const mockListReminders = jest.fn();
const mockCancelReminder = jest.fn();
jest.mock('../../src/services/scheduler/reminders/commands', () => ({
  listReminders: (...args: unknown[]) => mockListReminders(...args),
  cancelReminder: (...args: unknown[]) => mockCancelReminder(...args),
}));

jest.mock('@react-navigation/native', () => ({
  useFocusEffect: (callback: () => void) => {
    const ReactModule = require('react');
    ReactModule.useEffect(() => callback(), [callback]);
  },
}));

const colors = {
  mode: 'dark',
  background: '#000',
  surface: '#111',
  surfaceAlt: '#222',
  border: '#333',
  text: '#fff',
  textSecondary: '#aaa',
  primary: '#0f0',
  onPrimary: '#fff',
  danger: '#f00',
  warning: '#fc0',
} as never;
jest.mock('../../src/theme/useAppTheme', () => ({
  useAppTheme: () => ({ colors }),
}));

function reminder(overrides: Partial<ReminderRecord> = {}): ReminderRecord {
  return {
    id: 'r1',
    title: 'Call mom',
    recurrence: { kind: 'once', at: '2026-10-10T09:00:00' },
    timezone: 'Europe/Amsterdam',
    status: 'pending',
    nextFireAtMs: Date.UTC(2026, 9, 10, 7, 0),
    notificationIds: ['n1'],
    createdAtMs: 1,
    updatedAtMs: 1,
    ...overrides,
  };
}

function Harness() {
  const { reminders, loadFailed, reload } = usePendingReminders();
  return (
    <>
      <SchedulerReminderList
        loadFailed={loadFailed}
        onChanged={reload}
        reminders={reminders}
        styles={createSchedulerStyles(colors)}
      />
      <Text testID="reminder-count">{reminders.length}</Text>
    </>
  );
}

describe('SchedulerReminderList', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('lists the reminders the assistant created, with when they next fire and how they repeat', () => {
    // Regression: reminders created in chat were stored and delivered but shown nowhere.
    mockListReminders.mockReturnValue([
      reminder(),
      reminder({
        id: 'r2',
        title: 'Water the plants',
        recurrence: { kind: 'daily', time: '08:00' },
      }),
    ]);

    const screen = render(<Harness />);

    expect(screen.getByText(i18n.t('reminders.sectionTitle'))).toBeTruthy();
    expect(screen.getByText('Call mom')).toBeTruthy();
    expect(screen.getByText('Water the plants')).toBeTruthy();
    expect(screen.getByText(new RegExp(i18n.t('reminders.repeat.daily')))).toBeTruthy();
    expect(screen.getByTestId('scheduler-reminder-r1')).toBeTruthy();
  });

  it('renders nothing when there are no pending reminders', () => {
    mockListReminders.mockReturnValue([]);

    const screen = render(<Harness />);

    expect(screen.queryByTestId('scheduler-reminders')).toBeNull();
  });

  it('cancels a reminder only after confirmation, then reloads the list', async () => {
    mockListReminders.mockReturnValueOnce([reminder()]).mockReturnValue([]);
    mockCancelReminder.mockResolvedValue(undefined);
    const alertSpy = jest.spyOn(Alert, 'alert');
    const screen = render(<Harness />);

    fireEvent.press(screen.getByTestId('scheduler-reminder-cancel-r1'));
    expect(mockCancelReminder).not.toHaveBeenCalled();
    const buttons = alertSpy.mock.calls[0]?.[2] ?? [];
    expect(buttons).toHaveLength(2);
    await act(async () => {
      buttons.find((button) => button.style === 'destructive')?.onPress?.();
    });

    expect(mockCancelReminder).toHaveBeenCalledWith('r1');
    await waitFor(() => expect(screen.getByTestId('reminder-count').props.children).toBe(0));
    alertSpy.mockRestore();
  });

  it('keeps the reminder and says so when cancelling fails', async () => {
    mockListReminders.mockReturnValue([reminder()]);
    mockCancelReminder.mockRejectedValue(new Error('notification service unavailable'));
    const alertSpy = jest.spyOn(Alert, 'alert');
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const screen = render(<Harness />);

    fireEvent.press(screen.getByTestId('scheduler-reminder-cancel-r1'));
    await act(async () => {
      alertSpy.mock.calls[0]?.[2]?.find((button) => button.style === 'destructive')?.onPress?.();
    });

    await waitFor(() => expect(screen.getByText(i18n.t('reminders.cancelFailed'))).toBeTruthy());
    expect(screen.getByText('Call mom')).toBeTruthy();
    alertSpy.mockRestore();
    warn.mockRestore();
  });

  it('says the list could not be loaded instead of showing nothing', () => {
    mockListReminders.mockImplementation(() => {
      throw new Error('database locked');
    });
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);

    const screen = render(<Harness />);

    expect(screen.getByText(i18n.t('reminders.loadFailed'))).toBeTruthy();
    warn.mockRestore();
  });
});
