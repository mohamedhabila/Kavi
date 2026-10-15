import type { LucideIcon } from 'lucide-react-native';
import React, { useCallback, useEffect, useState } from 'react';
import { Alert, AppState, Text, TouchableOpacity, View } from 'react-native';

import { ForwardChevronIcon } from '../../components/navigation/DirectionalIcons';
import type { AppPalette } from '../../theme/useAppTheme';
import { createLogger } from '../../utils/logger';

type TranslationFn = (key: string, params?: any) => string;
type StyleMap = Record<string, any>;

/** Whether the phone gave Kavi a system role or access only the person can grant. */
export type SystemAccessState = 'held' | 'not_held' | 'unavailable';

export type SystemAccess = Readonly<{
  /** Names the row in logs and tests. */
  id: string;
  icon: LucideIcon;
  readState: () => Promise<SystemAccessState>;
  /** Opens the system page that grants it; false when there is none to open. */
  openSettings: () => Promise<boolean>;
  titleKey: string;
  heldHintKey: string;
  notHeldHintKey: string;
  settingsUnavailableKey: string;
}>;

const logger = createLogger('SettingsSystemAccess');

/** The access's state, read again whenever the person comes back from the system settings. */
function useSystemAccessState(access: SystemAccess): SystemAccessState | null {
  const [state, setState] = useState<SystemAccessState | null>(null);
  const { id, readState } = access;

  useEffect(() => {
    let active = true;
    const refresh = () => {
      readState()
        .then((next) => {
          if (active) setState(next);
        })
        .catch((error: unknown) => {
          logger.warn('Could not read a system access state.', { id, error: String(error) });
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
  }, [id, readState]);

  return state;
}

/** A settings row that shows a system access and opens the page that grants it. */
export const SettingsSystemAccessRow: React.FC<{
  access: SystemAccess;
  colors: AppPalette;
  styles: StyleMap;
  t: TranslationFn;
}> = ({ access, colors, styles, t }) => {
  const state = useSystemAccessState(access);
  const { id, icon: Icon, openSettings, settingsUnavailableKey } = access;

  const handlePress = useCallback(() => {
    openSettings()
      .then((opened) => {
        if (!opened) Alert.alert(t(settingsUnavailableKey));
      })
      .catch((error: unknown) => {
        logger.warn('Could not open a system access page.', { id, error: String(error) });
        Alert.alert(t(settingsUnavailableKey));
      });
  }, [id, openSettings, settingsUnavailableKey, t]);

  if (state === null || state === 'unavailable') return null;
  const hint = t(state === 'held' ? access.heldHintKey : access.notHeldHintKey);

  return (
    <TouchableOpacity
      accessibilityHint={hint}
      accessibilityLabel={t(access.titleKey)}
      accessibilityRole="button"
      onPress={handlePress}
      style={styles.featureRow}
      testID={`settings-${id}`}
    >
      <Icon size={19} color={colors.primary} />
      <View style={styles.featureContent}>
        <Text style={styles.switchLabel}>{t(access.titleKey)}</Text>
        <Text style={styles.featureHint}>{hint}</Text>
      </View>
      <ForwardChevronIcon size={18} color={colors.textTertiary} />
    </TouchableOpacity>
  );
};
