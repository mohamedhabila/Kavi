export type SettingsDestination =
  | 'home'
  | 'assistant-personalization'
  | 'memory-privacy'
  | 'tools-permissions'
  | 'connections'
  | 'notifications-voice'
  | 'appearance-language'
  | 'advanced-ai'
  | 'developer-remote-work';

const SETTINGS_DESTINATIONS = new Set<SettingsDestination>([
  'home',
  'assistant-personalization',
  'memory-privacy',
  'tools-permissions',
  'connections',
  'notifications-voice',
  'appearance-language',
  'advanced-ai',
  'developer-remote-work',
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
  'developer-remote-work': 'nav.developerAndRemoteWork',
};

export function resolveSettingsDestination(value: unknown): SettingsDestination {
  return typeof value === 'string' && SETTINGS_DESTINATIONS.has(value as SettingsDestination)
    ? (value as SettingsDestination)
    : 'home';
}

export function getSettingsDestinationTitleKey(destination: SettingsDestination): string {
  return DESTINATION_TITLE_KEYS[destination];
}
