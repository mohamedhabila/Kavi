import { Linking } from 'react-native';

import { getErrorMessage, makeActionFailure, makeActionResult, NativeActionResult } from '../types';

export async function openExternalUrl(
  url: string,
  options: {
    summary: string;
    successStatus?: string;
    successCode?: string;
    details?: Record<string, unknown>;
  },
): Promise<NativeActionResult<Record<string, unknown>>> {
  try {
    await Linking.openURL(url);
    return makeActionResult(
      options.successStatus || 'opened',
      options.summary,
      { url, ...(options.details || {}) },
      options.successCode || 'opened_external_destination',
    );
  } catch (error) {
    return makeActionFailure(
      'open_external_url_failed',
      `Unable to open the requested destination: ${getErrorMessage(error)}`,
      { url, ...(options.details || {}) },
    );
  }
}

export async function openAppSettings(): Promise<NativeActionResult<Record<string, unknown>>> {
  try {
    await Linking.openSettings();
    return makeActionResult('opened', 'Opened the app settings screen.', {}, 'settings_opened');
  } catch (error) {
    return makeActionFailure(
      'settings_open_failed',
      `Unable to open app settings: ${getErrorMessage(error)}`,
    );
  }
}
