import { BellRing, Smartphone } from 'lucide-react-native';

import {
  getAssistantRoleState,
  openAssistantSettings,
} from '../../services/assistant/assistantRole';
import {
  getNotificationAccessState,
  openNotificationAccessSettings,
} from '../../services/notifications/notificationReader';
import type { SystemAccess } from './SettingsSystemAccessRow';

/** Kavi as the phone's digital assistant, opened with a long press of home or power. */
export const ASSISTANT_ROLE_ACCESS: SystemAccess = {
  id: 'assistant-role',
  icon: Smartphone,
  readState: getAssistantRoleState,
  openSettings: openAssistantSettings,
  titleKey: 'settings.notificationsVoice.assistantTitle',
  heldHintKey: 'settings.notificationsVoice.assistantHeldHint',
  notHeldHintKey: 'settings.notificationsVoice.assistantNotHeldHint',
  settingsUnavailableKey: 'settings.notificationsVoice.assistantSettingsUnavailable',
};

/** Reading other apps' notifications back to the person (Android notification access). */
export const NOTIFICATION_ACCESS: SystemAccess = {
  id: 'notification-access',
  icon: BellRing,
  readState: async () => {
    const state = await getNotificationAccessState();
    return state === 'granted' ? 'held' : state === 'not_granted' ? 'not_held' : 'unavailable';
  },
  openSettings: openNotificationAccessSettings,
  titleKey: 'settings.notificationsVoice.notificationAccessTitle',
  heldHintKey: 'settings.notificationsVoice.notificationAccessHeldHint',
  notHeldHintKey: 'settings.notificationsVoice.notificationAccessNotHeldHint',
  settingsUnavailableKey: 'settings.notificationsVoice.notificationAccessSettingsUnavailable',
};
