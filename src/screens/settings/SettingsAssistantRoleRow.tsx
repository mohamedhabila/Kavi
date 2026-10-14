import { Smartphone } from 'lucide-react-native';
import React, { useCallback, useEffect, useState } from 'react';
import { Alert, AppState, Text, TouchableOpacity, View } from 'react-native';

import { ForwardChevronIcon } from '../../components/navigation/DirectionalIcons';
import {
  getAssistantRoleState,
  openAssistantSettings,
  type AssistantRoleState,
} from '../../services/assistant/assistantRole';
import type { AppPalette } from '../../theme/useAppTheme';
import { createLogger } from '../../utils/logger';

type TranslationFn = (key: string, params?: any) => string;
type StyleMap = Record<string, any>;

const logger = createLogger('SettingsAssistantRole');

/** Whether Kavi is the phone's assistant, read again whenever the app comes back. */
function useAssistantRoleState(): AssistantRoleState | null {
  const [state, setState] = useState<AssistantRoleState | null>(null);

  useEffect(() => {
    let active = true;
    const refresh = () => {
      getAssistantRoleState()
        .then((next) => {
          if (active) setState(next);
        })
        .catch((error: unknown) => {
          logger.warn('Could not read the assistant role.', { error: String(error) });
          if (active) setState('unavailable');
        });
    };
    refresh();
    const subscription = AppState.addEventListener('change', (next) => {
      if (next === 'active') refresh();
    });
    return () => {
      active = false;
      subscription.remove();
    };
  }, []);

  return state;
}

/** Makes Kavi the phone's digital assistant, opened with a long press of home or power. */
export const SettingsAssistantRoleRow: React.FC<{
  colors: AppPalette;
  styles: StyleMap;
  t: TranslationFn;
}> = ({ colors, styles, t }) => {
  const state = useAssistantRoleState();

  const handlePress = useCallback(() => {
    openAssistantSettings()
      .then((opened) => {
        if (!opened) Alert.alert(t('settings.notificationsVoice.assistantSettingsUnavailable'));
      })
      .catch((error: unknown) => {
        logger.warn('Could not open the assistant settings.', { error: String(error) });
        Alert.alert(t('settings.notificationsVoice.assistantSettingsUnavailable'));
      });
  }, [t]);

  if (state === null || state === 'unavailable') return null;
  const hint = t(
    state === 'held'
      ? 'settings.notificationsVoice.assistantHeldHint'
      : 'settings.notificationsVoice.assistantNotHeldHint',
  );

  return (
    <TouchableOpacity
      accessibilityHint={hint}
      accessibilityLabel={t('settings.notificationsVoice.assistantTitle')}
      accessibilityRole="button"
      onPress={handlePress}
      style={styles.featureRow}
      testID="settings-assistant-role"
    >
      <Smartphone size={19} color={colors.primary} />
      <View style={styles.featureContent}>
        <Text style={styles.switchLabel}>{t('settings.notificationsVoice.assistantTitle')}</Text>
        <Text style={styles.featureHint}>{hint}</Text>
      </View>
      <ForwardChevronIcon size={18} color={colors.textTertiary} />
    </TouchableOpacity>
  );
};
