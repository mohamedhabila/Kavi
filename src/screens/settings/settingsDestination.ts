export type SettingsDestination =
  | 'home'
  | 'assistant-personalization'
  | 'memory-privacy'
  | 'tools-permissions'
  | 'connections'
  | 'notifications-voice'
  | 'appearance-language'
  | 'advanced-ai';

const SETTINGS_DESTINATIONS = new Set<SettingsDestination>([
  'home',
  'assistant-personalization',
  'memory-privacy',
  'tools-permissions',
  'connections',
  'notifications-voice',
  'appearance-language',
  'advanced-ai',
]);

const DESTINATION_TITLE_KEYS: Record<SettingsDestination, string> = {
  home: 'settings.title',
  'assistant-personalization': 'settings.destinations.assistantPersonalization.title',
  'memory-privacy': 'settings.destinations.memoryPrivacy.title',
  'tools-permissions': 'settings.destinations.toolsPermissions.title',
  connections: 'settings.destinations.connections.title',
  'notifications-voice': 'settings.destinations.notificationsVoice.title',
  'appearance-language': 'settings.destinations.appearanceLanguage.title',
  'advanced-ai': 'settings.destinations.advancedAI.title',
};

export function resolveSettingsDestination(value: unknown): SettingsDestination | null {
  return typeof value === 'string' && SETTINGS_DESTINATIONS.has(value as SettingsDestination)
    ? (value as SettingsDestination)
    : null;
}

export function getSettingsDestinationTitleKey(destination: SettingsDestination): string {
  return DESTINATION_TITLE_KEYS[destination];
}
