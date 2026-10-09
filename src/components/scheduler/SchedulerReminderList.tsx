import React, { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, Text, TouchableOpacity, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { BellRing } from 'lucide-react-native';

import { getLocaleBcp47Tag } from '../../i18n/localeBcp47';
import { useTranslation } from '../../i18n/useTranslation';
import { cancelReminder, listReminders } from '../../services/scheduler/reminders/commands';
import type { ReminderRecord } from '../../services/scheduler/reminders/types';
import { useAppTheme } from '../../theme/useAppTheme';
import type { SchedulerStyles } from './Scheduler.styles';
import { createLogger } from '../../utils/logger';

const logger = createLogger('SchedulerReminderList');

const REPEAT_KEYS: Record<ReminderRecord['recurrence']['kind'], string> = {
  once: 'reminders.repeat.once',
  daily: 'reminders.repeat.daily',
  weekdays: 'reminders.repeat.weekdays',
  weekly: 'reminders.repeat.weekly',
  monthly: 'reminders.repeat.monthly',
};

/** The reminder's next time, in the user's language and the reminder's own time zone. */
function formatNextFire(reminder: ReminderRecord, localeTag: string): string | undefined {
  if (reminder.nextFireAtMs === undefined) return undefined;
  try {
    return new Intl.DateTimeFormat(localeTag, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      timeZone: reminder.timezone,
    }).format(new Date(reminder.nextFireAtMs));
  } catch {
    // An unknown stored zone must not hide the reminder; show it in device time instead.
    return new Intl.DateTimeFormat(localeTag, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    }).format(new Date(reminder.nextFireAtMs));
  }
}

/**
 * Pending reminders the assistant created, read from the reminder store each time the
 * screen gains focus. Reminders are delivered by the operating system rather than run as
 * automations, so they live in their own store and were previously visible nowhere.
 */
export function usePendingReminders() {
  const [reminders, setReminders] = useState<ReminderRecord[]>([]);
  const [loadFailed, setLoadFailed] = useState(false);

  const reload = useCallback(() => {
    try {
      setReminders(listReminders());
      setLoadFailed(false);
    } catch (error: unknown) {
      logger.warn('Could not load reminders', {
        error: error instanceof Error ? error.message : String(error),
      });
      setLoadFailed(true);
    }
  }, []);

  useFocusEffect(reload);

  return { reminders, loadFailed, reload };
}

type Props = {
  reminders: ReadonlyArray<ReminderRecord>;
  loadFailed: boolean;
  onChanged: () => void;
  styles: SchedulerStyles;
};

export const SchedulerReminderList: React.FC<Props> = ({
  reminders,
  loadFailed,
  onChanged,
  styles,
}) => {
  const { colors } = useAppTheme();
  const { t, locale } = useTranslation();
  const localeTag = getLocaleBcp47Tag(locale);
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [cancelFailedId, setCancelFailedId] = useState<string | null>(null);

  const confirmCancel = useCallback(
    (reminder: ReminderRecord) => {
      Alert.alert(
        t('reminders.cancelConfirmTitle'),
        t('reminders.cancelConfirmMessage', { title: reminder.title }),
        [
          { text: t('reminders.keep'), style: 'cancel' },
          {
            text: t('reminders.cancel'),
            style: 'destructive',
            onPress: () => {
              setCancellingId(reminder.id);
              setCancelFailedId(null);
              void cancelReminder(reminder.id)
                .then(onChanged)
                .catch((error: unknown) => {
                  logger.warn('Could not cancel reminder', {
                    error: error instanceof Error ? error.message : String(error),
                  });
                  setCancelFailedId(reminder.id);
                })
                .finally(() => setCancellingId(null));
            },
          },
        ],
        { cancelable: true },
      );
    },
    [onChanged, t],
  );

  if (loadFailed) {
    return (
      <View style={styles.notice} testID="scheduler-reminders-load-failed">
        <Text style={[styles.noticeText, { color: colors.warning }]}>
          {t('reminders.loadFailed')}
        </Text>
      </View>
    );
  }
  if (reminders.length === 0) {
    return null;
  }

  return (
    <View style={styles.reminderSection} testID="scheduler-reminders">
      <Text accessibilityRole="header" style={styles.reminderSectionTitle}>
        {t('reminders.sectionTitle')}
      </Text>
      {reminders.map((reminder) => {
        const when = formatNextFire(reminder, localeTag);
        const repeat = t(REPEAT_KEYS[reminder.recurrence.kind]);
        const isCancelling = cancellingId === reminder.id;
        return (
          <View
            key={reminder.id}
            style={styles.reminderRow}
            testID={`scheduler-reminder-${reminder.id}`}
          >
            <BellRing color={colors.primary} size={20} />
            <View style={styles.reminderBody}>
              <Text style={styles.reminderTitle}>{reminder.title}</Text>
              <Text style={styles.reminderMeta}>
                {when ? `${t('reminders.next', { when })} · ${repeat}` : repeat}
              </Text>
              {cancelFailedId === reminder.id ? (
                <Text style={styles.reminderError}>{t('reminders.cancelFailed')}</Text>
              ) : null}
            </View>
            {isCancelling ? (
              <ActivityIndicator size="small" color={colors.primary} />
            ) : (
              <TouchableOpacity
                accessibilityLabel={t('reminders.cancelAccessibility', { title: reminder.title })}
                accessibilityRole="button"
                onPress={() => confirmCancel(reminder)}
                style={styles.reminderCancel}
                testID={`scheduler-reminder-cancel-${reminder.id}`}
              >
                <Text style={styles.reminderCancelText}>{t('reminders.cancel')}</Text>
              </TouchableOpacity>
            )}
          </View>
        );
      })}
    </View>
  );
};
