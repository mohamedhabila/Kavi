// ---------------------------------------------------------------------------
// Kavi — Plain-language error alert helper
// ---------------------------------------------------------------------------
// Screens historically surfaced raw `err.message` text straight from thrown
// exceptions, which can read as a stack-trace fragment to most users. This
// helper shows a localized, generic message to everyone, and appends the raw
// technical detail only when Developer Mode is enabled — matching the app's
// "hide the developer surface" simplification without hiding the detail from
// engineers who opted into it.

import { Alert, type AlertButton } from 'react-native';
import { useSettingsStore } from '../store/useSettingsStore';

export interface ShowLocalizedErrorAlertOptions {
  /** Localized alert title, e.g. `t('common.error')`. */
  title: string;
  /** Localized, generic body shown to every user regardless of Developer Mode. */
  message: string;
  /** The value caught from the failing operation (an `Error`, a string, or anything else). */
  error: unknown;
  /** Localized label introducing the technical detail, e.g. `t('common.technicalDetails')`. */
  technicalDetailsLabel?: string;
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
 * Shows a localized error alert whose body is always the generic, user-facing
 * `message`. The raw technical error text is appended only when Developer
 * Mode is on, so non-technical users never see stack-trace-shaped copy.
 */
export function showLocalizedErrorAlert(options: ShowLocalizedErrorAlertOptions): void {
  const { title, message, error, technicalDetailsLabel, buttons } = options;
  const developerModeEnabled = useSettingsStore.getState().developerModeEnabled;
  const technicalMessage = extractTechnicalErrorMessage(error);

  const body =
    developerModeEnabled && technicalMessage
      ? `${message}\n\n${technicalDetailsLabel ? `${technicalDetailsLabel}: ` : ''}${technicalMessage}`
      : message;

  Alert.alert(title, body, buttons);
}
