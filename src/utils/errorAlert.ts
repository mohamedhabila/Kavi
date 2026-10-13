// ---------------------------------------------------------------------------
// Kavi — Plain-language error alert helper
// ---------------------------------------------------------------------------
// Screens historically surfaced raw `err.message` text straight from thrown
// exceptions, which can read as a stack-trace fragment to most users. This
// helper shows a localized, plain message and sends the technical detail to the
// log, where diagnosis happens, instead of the screen.

import { Alert, type AlertButton } from 'react-native';
import { createLogger } from './logger';

const logger = createLogger('ErrorAlert');

export interface ShowLocalizedErrorAlertOptions {
  /** Localized alert title, e.g. `t('common.error')`. */
  title: string;
  /** Localized, plain body shown to the user. */
  message: string;
  /** The value caught from the failing operation (an `Error`, a string, or anything else). */
  error: unknown;
  /** Extra alert buttons; omitted falls back to the platform default single button. */
  buttons?: AlertButton[];
}

/** Best-effort extraction of a human-readable technical message from an unknown thrown value. */
export function extractTechnicalErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === 'string') {
    return error;
  }
  if (error == null) {
    return '';
  }
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

/**
 * Shows a localized error alert with the plain, user-facing `message`; the raw
 * technical error is logged so it is never lost, but never shown as stack-trace-shaped copy.
 */
export function showLocalizedErrorAlert(options: ShowLocalizedErrorAlertOptions): void {
  const { title, message, error, buttons } = options;
  logger.warn(`${title}: ${message}`, extractTechnicalErrorMessage(error));
  Alert.alert(title, message, buttons);
}
