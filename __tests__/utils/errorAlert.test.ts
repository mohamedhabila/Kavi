import { Alert } from 'react-native';
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
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    alertSpy.mockRestore();
    warnSpy.mockRestore();
  });

  it('shows the plain message and logs the technical detail instead of showing it', () => {
    showLocalizedErrorAlert({
      title: 'Save Failed',
      message: 'We could not save your changes. Try again.',
      error: new Error('ECONNRESET at socket layer'),
    });

    expect(alertSpy).toHaveBeenCalledWith(
      'Save Failed',
      'We could not save your changes. Try again.',
      undefined,
    );
    expect(JSON.stringify(warnSpy.mock.calls)).toContain('ECONNRESET at socket layer');
  });

  it('shows the plain message when there is no extractable technical detail', () => {
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
