import React, { useCallback } from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';

import { openAssistantSettings } from '../../services/assistant/assistantRole';
import { openNotificationAccessSettings } from '../../services/notifications/notificationReader';
import {
  SETUP_TOPICS,
  type SetupForm,
  type SetupSettingsSection,
  type SetupTopic,
} from '../../services/setup/setupGuideTypes';
import type { SettingsDestination } from '../../screens/settings/settingsDestination';
import type { ToolCallDisplayStyles } from './ToolCallDisplay.styles';

export type ParsedSetupCard = Readonly<{
  topic: SetupTopic;
  ready: boolean;
  form?: SetupForm;
  /** The service a connect_app guide is for. */
  serviceName?: string;
}>;

const SETTINGS_SECTIONS = new Set<SetupSettingsSection>([
  'ssh-edit',
  'expo-account-edit',
  'mcp-edit',
  'provider-edit',
  'service-keys',
]);

/** Which Settings page holds each form. */
const SECTION_DESTINATIONS: Record<SetupSettingsSection, SettingsDestination> = {
  'ssh-edit': 'developer-remote-work',
  'expo-account-edit': 'developer-remote-work',
  'mcp-edit': 'connections',
  'provider-edit': 'advanced-ai',
  'service-keys': 'tools-permissions',
};

function parseForm(value: unknown): SetupForm | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const form = value as Record<string, unknown>;
  if (form.kind === 'settings' && SETTINGS_SECTIONS.has(form.section as SetupSettingsSection)) {
    const draft =
      form.draft && typeof form.draft === 'object'
        ? (form.draft as Record<string, string | number>)
        : undefined;
    return {
      kind: 'settings',
      section: form.section as SetupSettingsSection,
      ...(draft ? { draft } : {}),
    };
  }
  if (
    form.kind === 'system' &&
    (form.access === 'assistant_role' || form.access === 'notification_access')
  ) {
    return { kind: 'system', access: form.access };
  }
  return undefined;
}

export function parseToolCallSetupCard(toolName: string, result?: string): ParsedSetupCard | null {
  if (toolName !== 'setup_guide' || !result) return null;
  try {
    const parsed = JSON.parse(result) as Record<string, unknown>;
    const guide = (parsed.guide ?? {}) as Record<string, unknown>;
    if (!SETUP_TOPICS.includes(parsed.topic as SetupTopic)) return null;
    const ready = parsed.status === 'already_set_up';
    const form = parseForm(guide.form);
    // Nothing to open and nothing to confirm: the model walks the person through it.
    if (!ready && !form) return null;
    const options = Array.isArray(guide.options)
      ? (guide.options as Array<Record<string, unknown>>)
      : [];
    const chosen = options.find((option) => option.id === guide.optionId);
    return {
      topic: parsed.topic as SetupTopic,
      ready,
      ...(form ? { form } : {}),
      ...(parsed.topic === 'connect_app' && typeof chosen?.name === 'string'
        ? { serviceName: chosen.name }
        : {}),
    };
  } catch {
    return null;
  }
}

interface ToolCallSetupCardProps {
  card: ParsedSetupCard;
  styles: ToolCallDisplayStyles;
  t: (key: string, params?: Record<string, string | number>) => string;
}

/**
 * The card a setup guide shows in the chat: what it sets up, whether it already is, a
 * button to the Kavi form (filled in with what the guide knows) or the phone setting, and
 * a way to tell Kavi it is done so it can check and carry on.
 */
export const ToolCallSetupCard: React.FC<ToolCallSetupCardProps> = ({ card, styles, t }) => {
  const navigation = useNavigation<any>();
  const { form } = card;

  const openForm = useCallback(() => {
    if (!form) return;
    if (form.kind === 'system') {
      void (form.access === 'assistant_role'
        ? openAssistantSettings()
        : openNotificationAccessSettings());
      return;
    }
    navigation.navigate('Settings', {
      destination: SECTION_DESTINATIONS[form.section],
      section: form.section,
      setupDraft: form.draft,
      setupRequestId: Date.now(),
      returnTo: { name: 'Chat' },
    });
  }, [form, navigation]);

  const tellKaviDone = useCallback(() => {
    navigation.navigate('Chat', {
      incomingRequest: { requestId: Date.now(), text: t('setupGuide.doneMessage') },
    });
  }, [navigation, t]);

  const title = card.serviceName
    ? t('setupGuide.connectService', { name: card.serviceName })
    : t(`setupGuide.topics.${card.topic}`);
  const openLabel =
    form?.kind === 'system' ? t('setupGuide.openPhoneSettings') : t('setupGuide.openForm');

  return (
    <View style={styles.pollCard} testID={`setup-card-${card.topic}`}>
      <Text style={styles.pollQuestion}>{title}</Text>
      <Text style={styles.pollOptionLabel}>
        {card.ready ? t('setupGuide.ready') : t('setupGuide.notReady')}
      </Text>
      {card.ready || !form ? null : (
        <>
          <TouchableOpacity
            style={styles.pollOption}
            onPress={openForm}
            accessibilityRole="button"
            accessibilityLabel={openLabel}
            testID={`setup-card-open-${card.topic}`}
          >
            <Text style={styles.pollOptionLabel}>{openLabel}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.pollOption}
            onPress={tellKaviDone}
            accessibilityRole="button"
            accessibilityLabel={t('setupGuide.done')}
            testID={`setup-card-done-${card.topic}`}
          >
            <Text style={styles.pollOptionLabel}>{t('setupGuide.done')}</Text>
          </TouchableOpacity>
        </>
      )}
    </View>
  );
};
