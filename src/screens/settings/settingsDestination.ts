export type SettingsDestination = 'advanced-ai';

const SETTINGS_DESTINATIONS = new Set<SettingsDestination>(['advanced-ai']);

export function resolveSettingsDestination(value: unknown): SettingsDestination | null {
  return typeof value === 'string' && SETTINGS_DESTINATIONS.has(value as SettingsDestination)
    ? (value as SettingsDestination)
    : null;
}
