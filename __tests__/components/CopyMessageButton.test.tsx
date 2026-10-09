import { act, fireEvent, render } from '@testing-library/react-native';
import { AccessibilityInfo, Alert } from 'react-native';

import {
  COPY_CONFIRMATION_MS,
  CopyMessageButton,
} from '../../src/components/chat/CopyMessageButton';

const mockSetStringAsync = jest.fn();
const mockImpactAsync = jest.fn();

jest.mock('expo-clipboard', () => ({
  setStringAsync: (...args: unknown[]) => mockSetStringAsync(...args),
}));

jest.mock('expo-haptics', () => ({
  ImpactFeedbackStyle: { Light: 'light' },
  impactAsync: (...args: unknown[]) => mockImpactAsync(...args),
}));

const t = (key: string) =>
  ({
    'chat.copyMessage': 'Copy message',
    'chat.copyMessageFailed': 'This message could not be copied. Please try again.',
    'common.copied': 'Copied',
    'common.error': 'Error',
  })[key] ?? key;

function renderButton(text = 'Lisbon in May') {
  return render(
    <CopyMessageButton color="#777" confirmedColor="#0a0" t={t} testID="copy" text={text} />,
  );
}

describe('CopyMessageButton', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockSetStringAsync.mockResolvedValue(true);
    mockImpactAsync.mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
    mockSetStringAsync.mockReset();
    mockImpactAsync.mockReset();
  });

  it('copies the text and confirms it, then reads "Copy" again', async () => {
    const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility');
    const screen = renderButton();

    await act(async () => {
      fireEvent.press(screen.getByTestId('copy'));
    });

    expect(mockSetStringAsync).toHaveBeenCalledWith('Lisbon in May');
    expect(screen.getByLabelText('Copied')).toBeTruthy();
    expect(announce).toHaveBeenCalledWith('Copied');
    expect(mockImpactAsync).toHaveBeenCalledWith('light');

    act(() => {
      jest.advanceTimersByTime(COPY_CONFIRMATION_MS);
    });
    expect(screen.getByLabelText('Copy message')).toBeTruthy();
  });

  it('says so when the copy fails, without confirming it', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    mockSetStringAsync.mockRejectedValue(new Error('clipboard unavailable'));
    const screen = renderButton();

    await act(async () => {
      fireEvent.press(screen.getByTestId('copy'));
    });

    expect(alert).toHaveBeenCalledWith(
      'Error',
      'This message could not be copied. Please try again.',
    );
    expect(screen.getByLabelText('Copy message')).toBeTruthy();
    expect(mockImpactAsync).not.toHaveBeenCalled();
  });

  it('still confirms the copy on a device without haptics', async () => {
    mockImpactAsync.mockRejectedValue(new Error('haptics unavailable'));
    const screen = renderButton();

    await act(async () => {
      fireEvent.press(screen.getByTestId('copy'));
    });

    expect(screen.getByLabelText('Copied')).toBeTruthy();
  });

  it('is disabled when there is nothing to copy', () => {
    const screen = renderButton('');

    expect(screen.getByTestId('copy').props.accessibilityState).toEqual(
      expect.objectContaining({ disabled: true }),
    );
  });
});
