import React from 'react';
import { Alert, Linking, StyleSheet } from 'react-native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import type { CronJob } from '../../src/services/cron/types';
import { SchedulerScreen } from '../../src/screens/SchedulerScreen';

jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children, ...props }: any) => {
    const ReactModule = require('react');
    const { View } = require('react-native');
    return ReactModule.createElement(View, props, children);
  },
}));

const mockNavigate = jest.fn();
const mockOpenDrawer = jest.fn();
const mockSetParams = jest.fn();
const mockNavigation = {
  canGoBack: () => false,
  goBack: jest.fn(),
  navigate: mockNavigate,
  openDrawer: mockOpenDrawer,
  setParams: mockSetParams,
};
let mockFocusEffectsEnabled = false;
let mockRoute: { name: string; params?: Record<string, unknown> } = { name: 'Scheduler' };
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => mockNavigation,
  useRoute: () => mockRoute,
  useFocusEffect: (callback: () => void | (() => void)) => {
    const ReactModule = require('react');
    ReactModule.useEffect(() => (mockFocusEffectsEnabled ? callback() : undefined), [callback]);
  },
}));

jest.mock('../../src/theme/useAppTheme', () => ({
  useAppTheme: () => ({
    colors: {
      mode: 'dark',
      background: '#000',
      surface: '#111',
      surfaceAlt: '#222',
      panel: '#111',
      header: '#111',
      border: '#333',
      subtleBorder: '#444',
      text: '#fff',
      textSecondary: '#aaa',
      textTertiary: '#777',
      placeholder: '#555',
      primary: '#0f0',
      onPrimary: '#fff',
      primarySoft: '#030',
      danger: '#f00',
      onDanger: '#fff',
      dangerSoft: '#300',
      warning: '#fc0',
      warningBackground: '#320',
      success: '#0f0',
      info: '#09f',
      overlay: 'rgba(0,0,0,.5)',
      inputBackground: '#222',
      inputBorder: '#333',
    },
  }),
}));

const mockJobs: CronJob[] = [];
const mockTraces: any[] = [];
const mockCreateScheduledJob = jest.fn();
const mockDeleteScheduledJob = jest.fn();
const mockSetScheduledJobEnabled = jest.fn();
const mockRunJobNow = jest.fn();
const mockGetNotificationPermissionReadiness = jest.fn();
const mockRequestNotificationPermission = jest.fn();

jest.mock('../../src/services/scheduler/store', () => ({
  useSchedulerStore: (selector: any) => selector({ jobs: mockJobs }),
}));

jest.mock('../../src/services/scheduler/traceStore', () => ({
  useExecutionTraceStore: (selector: any) => selector({ traces: mockTraces }),
}));

jest.mock('../../src/services/scheduler/commands', () => ({
  createScheduledJob: (...args: any[]) => mockCreateScheduledJob(...args),
  deleteScheduledJob: (...args: any[]) => mockDeleteScheduledJob(...args),
  setScheduledJobEnabled: (...args: any[]) => mockSetScheduledJobEnabled(...args),
}));

jest.mock('../../src/services/scheduler/engine', () => ({
  runJobNow: (...args: any[]) => mockRunJobNow(...args),
}));

jest.mock('../../src/services/notifications/service', () => ({
  getNotificationPermissionReadiness: (...args: any[]) =>
    mockGetNotificationPermissionReadiness(...args),
  requestNotificationPermission: (...args: any[]) => mockRequestNotificationPermission(...args),
}));

function job(overrides: Partial<CronJob> = {}): CronJob {
  return {
    id: 'job-1',
    definitionRevision: 1,
    name: 'Morning briefing',
    enabled: true,
    createdAtMs: 1,
    updatedAtMs: 2,
    schedule: { kind: 'every', everyMs: 86_400_000 },
    sessionTarget: 'isolated',
    wakeMode: 'new',
    payload: { prompt: 'Summarize my day', mode: 'agentic' },
    nextRunAtMs: Date.now() + 3_600_000,
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockJobs.length = 0;
  mockTraces.length = 0;
  mockRoute = { name: 'Scheduler' };
  mockFocusEffectsEnabled = false;
  mockCreateScheduledJob.mockResolvedValue({ id: 'job-created' });
  mockDeleteScheduledJob.mockResolvedValue('deleted');
  mockSetScheduledJobEnabled.mockResolvedValue({ status: 'updated' });
  mockRunJobNow.mockResolvedValue({
    status: 'succeeded',
    id: 'job-1',
    name: 'Morning briefing',
  });
  mockGetNotificationPermissionReadiness.mockResolvedValue({
    status: 'granted',
    canRequest: false,
  });
  mockRequestNotificationPermission.mockResolvedValue({
    status: 'granted',
    canRequest: false,
  });
});

describe('SchedulerScreen', () => {
  it('presents reminders and automations as a guided empty state', async () => {
    mockFocusEffectsEnabled = true;
    const { findByText, getByText, getByTestId } = render(<SchedulerScreen />);

    expect(getByText('Reminders & automations')).toBeTruthy();
    expect(getByText('Nothing scheduled yet')).toBeTruthy();
    expect(getByTestId('scheduler-empty-create')).toBeTruthy();
    expect(await findByText('Notifications are ready')).toBeTruthy();
    expect(mockRequestNotificationPermission).not.toHaveBeenCalled();
  });

  it('requests notification permission only after an explicit action', async () => {
    mockFocusEffectsEnabled = true;
    mockGetNotificationPermissionReadiness.mockResolvedValue({
      status: 'requestable',
      canRequest: true,
    });
    const { findByText, getByTestId } = render(<SchedulerScreen />);

    expect(await findByText('Get alerts when something is due')).toBeTruthy();
    expect(mockRequestNotificationPermission).not.toHaveBeenCalled();
    fireEvent.press(getByTestId('scheduler-notification-action'));

    await waitFor(() => expect(mockRequestNotificationPermission).toHaveBeenCalledTimes(1));
    expect(await findByText('Notifications are ready')).toBeTruthy();
  });

  it('opens system settings when notification permission is blocked', async () => {
    mockFocusEffectsEnabled = true;
    mockGetNotificationPermissionReadiness.mockResolvedValue({
      status: 'blocked',
      canRequest: false,
    });
    jest.spyOn(Linking, 'openSettings').mockResolvedValue(undefined);
    const { findByText, getByTestId } = render(<SchedulerScreen />);

    expect(await findByText('Notifications are off')).toBeTruthy();
    fireEvent.press(getByTestId('scheduler-notification-action'));

    await waitFor(() => expect(Linking.openSettings).toHaveBeenCalledTimes(1));
    expect(mockRequestNotificationPermission).not.toHaveBeenCalled();
  });

  it('shows canonical status, next occurrence, durable result, and delivery degradation', () => {
    mockJobs.push(
      job({
        id: 'job-history',
        lastDeliveryError: 'Authorization: Bearer sk-secret-token',
      }),
    );
    mockTraces.push({
      id: 'trace-1',
      jobId: 'job-history',
      jobName: 'Morning briefing',
      startedAt: 10,
      completedAt: Date.now() - 1_000,
      durationMs: 1_000,
      status: 'error',
      error: 'Provider unavailable',
      trigger: 'scheduled',
    });
    const { getByText, queryByText, getByTestId } = render(<SchedulerScreen />);

    expect(getByText('Scheduled')).toBeTruthy();
    expect(getByText(/^Next:/)).toBeTruthy();
    expect(getByText(/^Last result: Failed/)).toBeTruthy();
    expect(getByText('Provider unavailable')).toBeTruthy();
    expect(getByTestId('scheduler-notification-issue-job-history')).toBeTruthy();
    expect(queryByText(/sk-secret-token/)).toBeNull();
  });

  it('uses explicit pause and resume actions through the durable command boundary', async () => {
    mockJobs.push(job({ id: 'job-pause' }), job({ id: 'job-resume', enabled: false }));
    const { getByTestId } = render(<SchedulerScreen />);

    fireEvent.press(getByTestId('scheduler-toggle-job-pause'));
    await waitFor(() =>
      expect(mockSetScheduledJobEnabled).toHaveBeenCalledWith('job-pause', false),
    );

    fireEvent.press(getByTestId('scheduler-toggle-job-resume'));
    await waitFor(() =>
      expect(mockSetScheduledJobEnabled).toHaveBeenCalledWith('job-resume', true),
    );
  });

  it('runs an automation now and shows completion feedback', async () => {
    mockJobs.push(job());
    const { findByText, getByTestId } = render(<SchedulerScreen />);

    fireEvent.press(getByTestId('scheduler-run-job-1'));

    await waitFor(() =>
      expect(mockRunJobNow).toHaveBeenCalledWith('job-1', {
        force: true,
        trigger: 'manual',
      }),
    );
    expect(await findByText('Finished successfully.')).toBeTruthy();
  });

  it('prevents duplicate manual runs while the first request is pending', async () => {
    let finishRun!: () => void;
    mockJobs.push(job());
    mockRunJobNow.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishRun = () => resolve({ status: 'succeeded', id: 'job-1', name: 'Morning briefing' });
        }),
    );
    const { getByTestId } = render(<SchedulerScreen />);
    const runButton = getByTestId('scheduler-run-job-1');

    fireEvent.press(runButton);
    fireEvent.press(runButton);
    expect(mockRunJobNow).toHaveBeenCalledTimes(1);

    await act(async () => finishRun());
    await waitFor(() => expect(mockRunJobNow).toHaveBeenCalledTimes(1));
  });

  it('turns execution exceptions into recoverable, redacted inline feedback', async () => {
    mockJobs.push(job());
    mockRunJobNow.mockRejectedValueOnce(new Error('api_key=sk-private-value unavailable'));
    const { findByText, getByTestId, queryByText } = render(<SchedulerScreen />);

    fireEvent.press(getByTestId('scheduler-run-job-1'));

    expect(await findByText(/This run could not finish/)).toBeTruthy();
    expect(queryByText(/sk-private-value/)).toBeNull();
  });

  it('highlights the exact automation opened from Activity or a notification', () => {
    jest.useFakeTimers();
    mockRoute = { name: 'Scheduler', params: { initialJobId: 'job-target' } };
    mockJobs.push(job({ id: 'job-other' }), job({ id: 'job-target', name: 'Target' }));
    const { getByTestId, unmount } = render(<SchedulerScreen />);
    const selectedStyle = StyleSheet.flatten(getByTestId('scheduler-job-job-target').props.style);

    expect(selectedStyle).toEqual(expect.objectContaining({ borderColor: '#0f0', borderWidth: 2 }));
    expect(mockSetParams).toHaveBeenCalledWith({ initialJobId: undefined });
    act(() => jest.runOnlyPendingTimers());
    unmount();
    jest.useRealTimers();
  });

  it('opens and closes the keyboard-safe creation sheet', () => {
    const { getByTestId, queryByTestId } = render(<SchedulerScreen />);

    fireEvent.press(getByTestId('scheduler-add'));
    expect(getByTestId('scheduler-create-sheet')).toBeTruthy();
    fireEvent.press(getByTestId('scheduler-create-close'));
    expect(queryByTestId('scheduler-create-sheet')).toBeNull();
  });

  it('shows missing text fields inline without an alert', () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    const { getByTestId, getByText } = render(<SchedulerScreen />);

    fireEvent.press(getByTestId('scheduler-add'));
    fireEvent.press(getByTestId('scheduler-create-submit'));

    expect(getByText('Add a name so you can find this later.')).toBeTruthy();
    expect(getByText('Describe what should happen.')).toBeTruthy();
    expect(mockCreateScheduledJob).not.toHaveBeenCalled();
    expect(alertSpy).not.toHaveBeenCalled();
  });

  it('creates a friendly repeat schedule through the durable command', async () => {
    const { getByTestId } = render(<SchedulerScreen />);
    fireEvent.press(getByTestId('scheduler-add'));
    fireEvent.changeText(getByTestId('scheduler-name-input'), 'Morning report');
    fireEvent.changeText(getByTestId('scheduler-prompt-input'), 'Summarize my inbox');
    fireEvent.changeText(getByTestId('scheduler-interval-input'), '5');
    fireEvent.press(getByTestId('scheduler-unit-minutes'));
    fireEvent.press(getByTestId('scheduler-create-submit'));

    await waitFor(() =>
      expect(mockCreateScheduledJob).toHaveBeenCalledWith({
        name: 'Morning report',
        prompt: 'Summarize my inbox',
        schedule: { kind: 'every', everyMs: 300_000 },
      }),
    );
  });

  it('keeps advanced scheduling opt-in and surfaces command errors inline', async () => {
    mockCreateScheduledJob.mockRejectedValueOnce(new Error('Invalid schedule expression'));
    const { findByText, getByTestId } = render(<SchedulerScreen />);
    fireEvent.press(getByTestId('scheduler-add'));
    fireEvent.changeText(getByTestId('scheduler-name-input'), 'Weekday briefing');
    fireEvent.changeText(getByTestId('scheduler-prompt-input'), 'Prepare my briefing');
    fireEvent.press(getByTestId('scheduler-schedule-advanced'));
    fireEvent.changeText(getByTestId('scheduler-cron-input'), 'not valid');
    fireEvent.press(getByTestId('scheduler-create-submit'));

    await waitFor(() =>
      expect(mockCreateScheduledJob).toHaveBeenCalledWith({
        name: 'Weekday briefing',
        prompt: 'Prepare my briefing',
        schedule: { kind: 'cron', expr: 'not valid' },
      }),
    );
    expect(await findByText('Invalid schedule expression')).toBeTruthy();
    expect(getByTestId('scheduler-create-sheet')).toBeTruthy();
  });

  it('maps durable save failures to a safe, actionable message', async () => {
    const persistenceError = Object.assign(new Error('internal write details'), {
      code: 'scheduler_persistence_failed',
    });
    mockCreateScheduledJob.mockRejectedValueOnce(persistenceError);
    const { findByText, getByTestId } = render(<SchedulerScreen />);
    fireEvent.press(getByTestId('scheduler-add'));
    fireEvent.changeText(getByTestId('scheduler-name-input'), 'Daily review');
    fireEvent.changeText(getByTestId('scheduler-prompt-input'), 'Review my priorities');
    fireEvent.press(getByTestId('scheduler-create-submit'));

    expect(
      await findByText(
        'Kavi could not save this change safely. Nothing uncertain was left active. Try again.',
      ),
    ).toBeTruthy();
  });

  it('prevents duplicate creation while persistence is pending', async () => {
    let finishCreate!: () => void;
    mockCreateScheduledJob.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishCreate = () => resolve({ id: 'job-created' });
        }),
    );
    const { getByTestId } = render(<SchedulerScreen />);
    fireEvent.press(getByTestId('scheduler-add'));
    fireEvent.changeText(getByTestId('scheduler-name-input'), 'Daily briefing');
    fireEvent.changeText(getByTestId('scheduler-prompt-input'), 'Prepare a briefing');

    fireEvent.press(getByTestId('scheduler-create-submit'));
    fireEvent.press(getByTestId('scheduler-create-submit'));
    expect(mockCreateScheduledJob).toHaveBeenCalledTimes(1);

    await act(async () => finishCreate());
    await waitFor(() => expect(mockCreateScheduledJob).toHaveBeenCalledTimes(1));
  });

  it('confirms deletion and keeps destructive controls at a 48-point target', async () => {
    jest.spyOn(Alert, 'alert').mockImplementation((_title, _message, buttons: any) => {
      buttons?.find((button: any) => button.style === 'destructive')?.onPress?.();
    });
    mockJobs.push(job({ id: 'job-delete', name: 'Delete me' }));
    const { getByTestId } = render(<SchedulerScreen />);
    const deleteButton = getByTestId('scheduler-delete-job-delete');
    const buttonStyle = StyleSheet.flatten(deleteButton.props.style);

    expect(buttonStyle).toEqual(expect.objectContaining({ minHeight: 48, width: 48 }));
    fireEvent.press(deleteButton);
    await waitFor(() => expect(mockDeleteScheduledJob).toHaveBeenCalledWith('job-delete'));
  });
});
