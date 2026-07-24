import React, { useMemo } from 'react';
import { ActivityIndicator, Text, TouchableOpacity, View } from 'react-native';
import { Bell, BellOff, CheckCircle2, CircleAlert } from 'lucide-react-native';
import type { NotificationPermissionReadiness } from '../../services/notifications/service';
import { useAppTheme } from '../../theme/useAppTheme';
import { useTranslation } from '../../i18n/useTranslation';
import { createSchedulerStyles } from './Scheduler.styles';

export type SchedulerPermissionState =
  | NotificationPermissionReadiness
  | { status: 'loading'; canRequest: false }
  | { status: 'error'; canRequest: true };

type SchedulerPermissionCardProps = {
  isWorking: boolean;
  onAction: () => void;
  state: SchedulerPermissionState;
};

function getPermissionCopy(state: SchedulerPermissionState) {
  switch (state.status) {
    case 'granted':
      return {
        titleKey: 'scheduler.notificationsGrantedTitle',
        hintKey: 'scheduler.notificationsGrantedHint',
      };
    case 'requestable':
      return {
        titleKey: 'scheduler.notificationsRequestableTitle',
        hintKey: 'scheduler.notificationsRequestableHint',
        actionKey: 'scheduler.allowNotifications',
      };
    case 'blocked':
      return {
        titleKey: 'scheduler.notificationsBlockedTitle',
        hintKey: 'scheduler.notificationsBlockedHint',
        actionKey: 'scheduler.openNotificationSettings',
      };
    case 'error':
      return {
        titleKey: 'scheduler.notificationsErrorTitle',
        hintKey: 'scheduler.notificationsErrorHint',
        actionKey: 'common.retry',
      };
    default:
      return {
        titleKey: 'scheduler.notificationsLoadingTitle',
        hintKey: 'scheduler.notificationsLoadingHint',
      };
  }
}

export function SchedulerPermissionCard({
  isWorking,
  onAction,
  state,
}: SchedulerPermissionCardProps) {
  const { colors } = useAppTheme();
  const { t } = useTranslation();
  const styles = useMemo(() => createSchedulerStyles(colors), [colors]);
  const copy = getPermissionCopy(state);
  const Icon =
    state.status === 'granted'
      ? CheckCircle2
      : state.status === 'blocked'
        ? BellOff
        : state.status === 'error'
          ? CircleAlert
          : Bell;
  const iconColor =
    state.status === 'granted'
      ? colors.success
      : state.status === 'blocked' || state.status === 'error'
        ? colors.warning
        : colors.primary;

  return (
    <View
      accessibilityLiveRegion="polite"
      style={styles.permissionCard}
      testID="scheduler-notification-readiness"
    >
      <View style={styles.permissionTop}>
        <View
          style={styles.permissionIcon}
          accessibilityElementsHidden
          importantForAccessibility="no"
        >
          {state.status === 'loading' ? (
            <ActivityIndicator color={colors.primary} size="small" />
          ) : (
            <Icon color={iconColor} size={21} />
          )}
        </View>
        <View style={styles.permissionCopy}>
          <Text style={styles.permissionTitle}>{t(copy.titleKey)}</Text>
          <Text style={styles.permissionHint}>{t(copy.hintKey)}</Text>
        </View>
      </View>
      {copy.actionKey ? (
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityState={{ busy: isWorking, disabled: isWorking }}
          disabled={isWorking}
          onPress={onAction}
          style={[styles.permissionAction, isWorking && styles.actionDisabled]}
          testID="scheduler-notification-action"
        >
          <Text style={styles.permissionActionText}>{t(copy.actionKey)}</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}
