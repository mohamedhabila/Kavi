// ---------------------------------------------------------------------------
// Tests — SchedulerScreen
// ---------------------------------------------------------------------------

import { Alert } from 'react-native';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { SchedulerScreen } from '../../src/screens/SchedulerScreen';

// Mock safe area
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children, ...props }: any) => {
    const React = require('react');
    const { View } = require('react-native');
    return React.createElement(View, props, children);
  },
}));

// Mock navigation
const mockGoBack = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ goBack: mockGoBack, navigate: jest.fn() }),
  useRoute: () => ({ name: 'Scheduler' }),
  useFocusEffect: jest.fn(),
}));

// Mock theme
jest.mock('../../src/theme/useAppTheme', () => ({
  useAppTheme: () => ({
    colors: {
      background: '#000',
      surface: '#111',
      surfaceAlt: '#222',
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
      warning: '#ff0',
      success: '#0f0',
      inputBackground: '#222',
      inputBorder: '#333',
    },
  }),
  AppPalette: {},
}));

// Mock scheduler store
const mockJobs: any[] = [];
const mockCreateScheduledJob = jest.fn().mockResolvedValue({ id: 'job-created' });
const mockDeleteScheduledJob = jest.fn().mockResolvedValue('deleted');
const mockSetScheduledJobEnabled = jest.fn().mockResolvedValue({ status: 'updated' });

jest.mock('../../src/services/scheduler/store', () => ({
  useSchedulerStore: (selector: any) =>
    selector({
      jobs: mockJobs,
    }),
}));

jest.mock('../../src/services/scheduler/commands', () => ({
  createScheduledJob: (...args: any[]) => mockCreateScheduledJob(...args),
  deleteScheduledJob: (...args: any[]) => mockDeleteScheduledJob(...args),
  setScheduledJobEnabled: (...args: any[]) => mockSetScheduledJobEnabled(...args),
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockJobs.length = 0;
  mockCreateScheduledJob.mockResolvedValue({ id: 'job-created' });
  mockDeleteScheduledJob.mockResolvedValue('deleted');
  mockSetScheduledJobEnabled.mockResolvedValue({ status: 'updated' });
});

describe('SchedulerScreen', () => {
  it('renders header with title', () => {
    const { getByText } = render(<SchedulerScreen />);
    expect(getByText('Scheduled Tasks')).toBeTruthy();
  });

  it('shows empty state when no jobs', () => {
    const { getByText } = render(<SchedulerScreen />);
    expect(getByText('No scheduled tasks')).toBeTruthy();
    expect(getByText(/allow notifications and tap the wake alert/)).toBeTruthy();
  });

  it('renders cron job card with schedule and content', () => {
    mockJobs.push({
      id: 'job1',
      name: 'Morning Report',
      enabled: true,
      schedule: { kind: 'cron', expr: '0 9 * * *' },
      payload: { prompt: 'Generate report' },
      nextRunAtMs: Date.now() + 3600000,
      lastRunAtMs: Date.now() - 3600000,
      updatedAtMs: undefined,
    });

    const { getByText } = render(<SchedulerScreen />);
    expect(getByText('Morning Report')).toBeTruthy();
    expect(getByText('Cron: 0 9 * * *')).toBeTruthy();
    expect(getByText('Generate report')).toBeTruthy();
    expect(getByText(/^Next run:/)).toBeTruthy();
    expect(getByText(/^Last run:/)).toBeTruthy();
    expect(getByText('Last update: Never')).toBeTruthy();
  });

  it('renders last scheduler error when available', () => {
    mockJobs.push({
      id: 'job-error',
      name: 'Broken Job',
      enabled: true,
      schedule: { kind: 'every', everyMs: 300000 },
      payload: {},
      lastError: 'Network unavailable',
      updatedAtMs: undefined,
    });

    const { getByText } = render(<SchedulerScreen />);
    expect(getByText('Error: Network unavailable')).toBeTruthy();
  });

  it('renders durable delivery degradation separately from execution failure', () => {
    mockJobs.push({
      id: 'job-delivery-warning',
      name: 'Delivered poorly',
      enabled: true,
      schedule: { kind: 'every', everyMs: 300000 },
      payload: {},
      lastDeliveryError: 'Success notification failed: permission denied',
    });

    const { getByText } = render(<SchedulerScreen />);
    expect(getByText(/Delivery warning: Success notification failed/)).toBeTruthy();
  });

  it('renders every-type schedule', () => {
    mockJobs.push({
      id: 'job2',
      name: 'Interval Job',
      enabled: true,
      schedule: { kind: 'every', everyMs: 300000 },
      payload: {},
      updatedAtMs: undefined,
    });

    const { getByText } = render(<SchedulerScreen />);
    expect(getByText('Every 5 min')).toBeTruthy();
  });

  it('renders at-type schedule', () => {
    const ts = new Date('2025-06-15T10:00:00Z').getTime();
    mockJobs.push({
      id: 'job3',
      name: 'One-time Job',
      enabled: true,
      schedule: { kind: 'at', atMs: ts },
      payload: {},
      updatedAtMs: undefined,
    });

    const { getByText } = render(<SchedulerScreen />);
    expect(getByText(/^At /)).toBeTruthy();
  });

  it('renders unknown schedule type', () => {
    mockJobs.push({
      id: 'job4',
      name: 'Unknown Job',
      enabled: true,
      schedule: { kind: 'something_else' },
      payload: {},
      updatedAtMs: undefined,
    });

    const { getByText } = render(<SchedulerScreen />);
    expect(getByText('Unknown')).toBeTruthy();
  });

  it('renders last run time when available', () => {
    const ts = Date.now() - 60000;
    mockJobs.push({
      id: 'job5',
      name: 'Ran Job',
      enabled: false,
      schedule: { kind: 'cron', expr: '* * * * *' },
      payload: {},
      updatedAtMs: ts,
    });

    const { getByText } = render(<SchedulerScreen />);
    expect(getByText(/^Last update:/)).toBeTruthy();
    // Should NOT say "Never"
    expect(getByText(/^Last update:/).props.children).not.toContain('Never');
  });

  it('renders untitled job when label is missing', () => {
    mockJobs.push({
      id: 'job6',
      enabled: true,
      schedule: { kind: 'cron', expr: '* * * * *' },
      payload: {},
    });

    const { getByText } = render(<SchedulerScreen />);
    expect(getByText('Untitled Job')).toBeTruthy();
  });

  it('toggle switch uses the durable enable boundary', async () => {
    mockJobs.push({
      id: 'job7',
      name: 'Toggle Job',
      enabled: true,
      schedule: { kind: 'cron', expr: '0 * * * *' },
      payload: {},
    });

    const { getByRole } = render(<SchedulerScreen />);
    fireEvent(getByRole('switch'), 'valueChange', false);

    await waitFor(() => expect(mockSetScheduledJobEnabled).toHaveBeenCalledWith('job7', false));
  });

  it('opens and closes the add task modal', () => {
    const { getByLabelText, getByPlaceholderText, queryByPlaceholderText } = render(
      <SchedulerScreen />,
    );

    fireEvent.press(getByLabelText('Add Task'));
    expect(getByPlaceholderText('Daily summary, reminder, etc.')).toBeTruthy();

    fireEvent.press(getByLabelText('Close'));
    expect(queryByPlaceholderText('Daily summary, reminder, etc.')).toBeNull();
  });

  it('requires a task name before creating a job', () => {
    jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    const { getByLabelText, getByText } = render(<SchedulerScreen />);

    fireEvent.press(getByLabelText('Add Task'));
    fireEvent.press(getByText('Create'));

    expect(Alert.alert).toHaveBeenCalledWith('Error', 'Task name is required.');
    expect(mockCreateScheduledJob).not.toHaveBeenCalled();
  });

  it('requires a prompt before creating a job', () => {
    jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    const { getByLabelText, getByPlaceholderText, getByText } = render(<SchedulerScreen />);

    fireEvent.press(getByLabelText('Add Task'));
    fireEvent.changeText(getByPlaceholderText('Daily summary, reminder, etc.'), 'Morning report');
    fireEvent.press(getByText('Create'));

    expect(Alert.alert).toHaveBeenCalledWith('Error', 'Prompt is required.');
    expect(mockCreateScheduledJob).not.toHaveBeenCalled();
  });

  it('requires a valid interval when creating an every schedule', () => {
    jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    const { getByLabelText, getAllByPlaceholderText, getByPlaceholderText, getByText } = render(
      <SchedulerScreen />,
    );

    fireEvent.press(getByLabelText('Add Task'));
    fireEvent.changeText(getByPlaceholderText('Daily summary, reminder, etc.'), 'Morning report');
    fireEvent.changeText(getByPlaceholderText('What should the AI do?'), 'Summarize the inbox');
    fireEvent.changeText(getAllByPlaceholderText('1')[0], '0');
    fireEvent.press(getByText('Create'));

    expect(Alert.alert).toHaveBeenCalledWith('Error', 'Schedule is required.');
    expect(mockCreateScheduledJob).not.toHaveBeenCalled();
  });

  it('creates an every-schedule job through the durable command', async () => {
    const { getByLabelText, getAllByPlaceholderText, getByPlaceholderText, getByText } = render(
      <SchedulerScreen />,
    );

    fireEvent.press(getByLabelText('Add Task'));
    fireEvent.changeText(getByPlaceholderText('Daily summary, reminder, etc.'), 'Morning report');
    fireEvent.changeText(getByPlaceholderText('What should the AI do?'), 'Summarize the inbox');
    fireEvent.changeText(getAllByPlaceholderText('1')[0], '5');
    fireEvent.press(getByText('min'));
    fireEvent.press(getByText('Create'));

    await waitFor(() =>
      expect(mockCreateScheduledJob).toHaveBeenCalledWith({
        name: 'Morning report',
        prompt: 'Summarize the inbox',
        schedule: { kind: 'every', everyMs: 300000 },
      }),
    );
  });

  it('creates a cron-schedule job through the durable command', async () => {
    const { getByLabelText, getByPlaceholderText, getByText } = render(<SchedulerScreen />);

    fireEvent.press(getByLabelText('Add Task'));
    fireEvent.changeText(getByPlaceholderText('Daily summary, reminder, etc.'), 'Morning report');
    fireEvent.changeText(getByPlaceholderText('What should the AI do?'), 'Summarize the inbox');
    fireEvent.press(getByText('Cron'));
    fireEvent.changeText(getByPlaceholderText('0 9 * * * (daily at 9am)'), '0 9 * * *');
    fireEvent.press(getByText('Create'));

    await waitFor(() =>
      expect(mockCreateScheduledJob).toHaveBeenCalledWith({
        name: 'Morning report',
        prompt: 'Summarize the inbox',
        schedule: { kind: 'cron', expr: '0 9 * * *' },
      }),
    );
  });

  it('prevents duplicate creation while the durable command is pending', async () => {
    let releaseCreate!: () => void;
    mockCreateScheduledJob.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          releaseCreate = () => resolve({ id: 'job-created' });
        }),
    );
    const { getByLabelText, getAllByPlaceholderText, getByPlaceholderText, getByText } = render(
      <SchedulerScreen />,
    );
    fireEvent.press(getByLabelText('Add Task'));
    fireEvent.changeText(getByPlaceholderText('Daily summary, reminder, etc.'), 'Morning report');
    fireEvent.changeText(getByPlaceholderText('What should the AI do?'), 'Summarize the inbox');
    fireEvent.changeText(getAllByPlaceholderText('1')[0], '5');

    fireEvent.press(getByText('Create'));
    fireEvent.press(getByText('Create'));

    expect(mockCreateScheduledJob).toHaveBeenCalledTimes(1);
    releaseCreate();
    await waitFor(() => expect(getByText('No scheduled tasks')).toBeTruthy());
  });

  it('executes durable delete confirmation for a job', async () => {
    jest.spyOn(Alert, 'alert').mockImplementation((_title, _message, buttons: any) => {
      const destructive = buttons?.find((button: any) => button.style === 'destructive');
      destructive?.onPress?.();
    });
    mockJobs.push({
      id: 'job-delete',
      name: 'Delete me',
      enabled: true,
      schedule: { kind: 'cron', expr: '0 * * * *' },
      payload: {},
    });

    const { getByLabelText } = render(<SchedulerScreen />);
    fireEvent.press(getByLabelText('Delete task Delete me'));

    await waitFor(() => expect(mockDeleteScheduledJob).toHaveBeenCalledWith('job-delete'));
  });
});
