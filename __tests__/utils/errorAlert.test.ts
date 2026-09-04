import { Alert } from 'react-native';
import { useSettingsStore } from '../../src/store/useSettingsStore';
import {
  extractTechnicalErrorMessage,
  showLocalizedErrorAlert,
} from '../../src/utils/errorAlert';

describe('extractTechnicalErrorMessage', () => {
  it('extracts the message from an Error instance', () => {
    expect(extractTechnicalErrorMessage(new Error('boom'))).toBe('boom');
  });

  it('returns a plain string error as-is', () => {
    expect(extractTechnicalErrorMessage('raw string failure')).toBe('raw string failure');
  });

  it('stringifies a plain object', () => {
    expect(extractTechnicalErrorMessage({ code: 'ETIMEDOUT' })).toBe('{"code":"ETIMEDOUT"}');
  });

  it('returns an empty string for null/undefined', () => {
    expect(extractTechnicalErrorMessage(null)).toBe('');
    expect(extractTechnicalErrorMessage(undefined)).toBe('');
  });
});

describe('showLocalizedErrorAlert', () => {
  let alertSpy: jest.SpyInstance;

  beforeEach(() => {
    alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    useSettingsStore.setState({ developerModeEnabled: false } as any);
  });

  afterEach(() => {
    alertSpy.mockRestore();
    useSettingsStore.setState({ developerModeEnabled: false } as any);
  });

  it('shows only the generic message when developer mode is off', () => {
    showLocalizedErrorAlert({
      title: 'Save Failed',
      message: 'We could not save your changes. Try again.',
      error: new Error('ECONNRESET at socket layer'),
      technicalDetailsLabel: 'Technical details',
    });

    expect(alertSpy).toHaveBeenCalledWith(
      'Save Failed',
      'We could not save your changes. Try again.',
      undefined,
    );
  });

  it('appends the technical detail only when developer mode is on', () => {
    useSettingsStore.setState({ developerModeEnabled: true } as any);

    showLocalizedErrorAlert({
      title: 'Save Failed',
      message: 'We could not save your changes. Try again.',
      error: new Error('ECONNRESET at socket layer'),
      technicalDetailsLabel: 'Technical details',
    });

    const [, body] = alertSpy.mock.calls[0];
    expect(body).toContain('We could not save your changes. Try again.');
    expect(body).toContain('Technical details: ECONNRESET at socket layer');
  });

  it('does not append a technical detail block when there is no extractable message', () => {
    useSettingsStore.setState({ developerModeEnabled: true } as any);

    showLocalizedErrorAlert({
      title: 'Save Failed',
      message: 'We could not save your changes. Try again.',
      error: null,
    });

    expect(alertSpy).toHaveBeenCalledWith(
      'Save Failed',
      'We could not save your changes. Try again.',
      undefined,
    );
  });

  it('passes custom buttons through unchanged', () => {
    const buttons = [{ text: 'Cancel', style: 'cancel' as const }];
    showLocalizedErrorAlert({
      title: 'Install Failed',
      message: 'We could not install this server.',
      error: new Error('boom'),
      buttons,
    });

    expect(alertSpy).toHaveBeenCalledWith(
      'Install Failed',
      'We could not install this server.',
      buttons,
    );
  });
});
