import { Alert } from 'react-native';

import type { RemoteConfigSettingsSlice } from './useRemoteConfigStore';

export type TranslationFn = (key: string, params?: Record<string, unknown>) => string;

export type SharedControllerOptions = {
  settings: RemoteConfigSettingsSlice;
  t: TranslationFn;
};

export function confirmDeletion(
  t: TranslationFn,
  messageKey: string,
  onConfirm: () => void | Promise<void>,
  titleKey = 'common.delete',
) {
  Alert.alert(t(titleKey), t(messageKey), [
    { text: t('common.cancel'), style: 'cancel' },
    {
      text: t('common.delete'),
      style: 'destructive',
      onPress: () => {
        void onConfirm();
      },
    },
  ]);
}
