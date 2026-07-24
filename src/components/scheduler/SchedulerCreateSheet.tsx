import React, { useMemo, useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { X } from 'lucide-react-native';
import type { CronSchedule } from '../../services/cron/types';
import { redactSensitiveText } from '../../services/security/toolDetailRedaction';
import { useAppTheme } from '../../theme/useAppTheme';
import { useTranslation } from '../../i18n/useTranslation';
import { createSchedulerStyles } from './Scheduler.styles';
import type { SchedulerPermissionState } from './SchedulerPermissionCard';

type ScheduleType = 'every' | 'cron';
type IntervalUnit = 'minutes' | 'hours' | 'days';

type SchedulerCreateSheetProps = {
  isPermissionWorking: boolean;
  onClose: () => void;
  onCreate: (input: { name: string; prompt: string; schedule: CronSchedule }) => Promise<void>;
  onPermissionAction: () => void;
  permissionState: SchedulerPermissionState;
  visible: boolean;
};

type FieldErrors = Partial<Record<'name' | 'prompt' | 'schedule', string>>;
type Translate = (key: string, params?: Record<string, string | number>) => string;

const UNIT_KEYS: Record<IntervalUnit, string> = {
  minutes: 'scheduler.minutes',
  hours: 'scheduler.hours',
  days: 'scheduler.days',
};

function getPermissionHintKey(state: SchedulerPermissionState): string {
  switch (state.status) {
    case 'granted':
      return 'scheduler.formNotificationGranted';
    case 'requestable':
      return 'scheduler.formNotificationRequestable';
    case 'blocked':
      return 'scheduler.formNotificationBlocked';
    default:
      return 'scheduler.formNotificationUnavailable';
  }
}

function getPermissionActionKey(state: SchedulerPermissionState): string | undefined {
  if (state.status === 'requestable') return 'scheduler.allowNotifications';
  if (state.status === 'blocked') return 'scheduler.openNotificationSettings';
  if (state.status === 'error') return 'common.retry';
  return undefined;
}

function intervalToMilliseconds(value: string, unit: IntervalUnit): number {
  const interval = Number(value.trim());
  if (!Number.isSafeInteger(interval) || interval <= 0) return 0;
  const milliseconds =
    unit === 'minutes'
      ? interval * 60_000
      : unit === 'hours'
        ? interval * 3_600_000
        : interval * 86_400_000;
  return Number.isSafeInteger(milliseconds) ? milliseconds : 0;
}

function safeError(error: unknown, t: Translate): string {
  const code =
    error && typeof error === 'object' && 'code' in error
      ? String((error as { code?: unknown }).code)
      : '';
  if (code === 'invalid_scheduler_schedule') return t('scheduler.scheduleRequired');
  if (code === 'scheduler_persistence_failed') return t('scheduler.saveFailed');
  const value = error instanceof Error ? error.message : String(error);
  const redacted = redactSensitiveText(value).replace(/\s+/gu, ' ').trim();
  return redacted.length > 300 ? `${redacted.slice(0, 297)}…` : redacted;
}

export function SchedulerCreateSheet({
  isPermissionWorking,
  onClose,
  onCreate,
  onPermissionAction,
  permissionState,
  visible,
}: SchedulerCreateSheetProps) {
  const { colors } = useAppTheme();
  const { t } = useTranslation();
  const styles = useMemo(() => createSchedulerStyles(colors), [colors]);
  const [name, setName] = useState('');
  const [prompt, setPrompt] = useState('');
  const [scheduleType, setScheduleType] = useState<ScheduleType>('every');
  const [intervalValue, setIntervalValue] = useState('1');
  const [intervalUnit, setIntervalUnit] = useState<IntervalUnit>('days');
  const [cronExpression, setCronExpression] = useState('');
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const creatingRef = useRef(false);

  if (!visible) return null;

  const clearFieldError = (field: keyof FieldErrors) => {
    setFieldErrors((current) => ({ ...current, [field]: undefined }));
    setFormError(null);
  };

  const resetForm = () => {
    setName('');
    setPrompt('');
    setScheduleType('every');
    setIntervalValue('1');
    setIntervalUnit('days');
    setCronExpression('');
    setFieldErrors({});
    setFormError(null);
  };

  const handleCreate = async () => {
    if (creatingRef.current) return;
    const nextErrors: FieldErrors = {};
    const trimmedName = name.trim();
    const trimmedPrompt = prompt.trim();
    if (!trimmedName) nextErrors.name = t('scheduler.nameRequired');
    if (!trimmedPrompt) nextErrors.prompt = t('scheduler.promptRequired');

    let schedule: CronSchedule | undefined;
    if (scheduleType === 'every') {
      const everyMs = intervalToMilliseconds(intervalValue, intervalUnit);
      if (!everyMs) nextErrors.schedule = t('scheduler.scheduleRequired');
      else schedule = { kind: 'every', everyMs };
    } else {
      const expression = cronExpression.trim();
      if (!expression) nextErrors.schedule = t('scheduler.scheduleRequired');
      else schedule = { kind: 'cron', expr: expression };
    }

    if (Object.keys(nextErrors).length > 0 || !schedule) {
      setFieldErrors(nextErrors);
      return;
    }

    creatingRef.current = true;
    setIsCreating(true);
    setFormError(null);
    try {
      await onCreate({ name: trimmedName, prompt: trimmedPrompt, schedule });
      resetForm();
      onClose();
    } catch (error) {
      setFormError(safeError(error, t));
    } finally {
      creatingRef.current = false;
      setIsCreating(false);
    }
  };

  const permissionActionKey = getPermissionActionKey(permissionState);

  return (
    <Modal
      animationType="slide"
      onRequestClose={() => {
        if (!creatingRef.current) onClose();
      }}
      transparent
      visible
      testID="scheduler-create-modal"
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.modalBackdrop}
      >
        <SafeAreaView
          accessibilityViewIsModal
          edges={['bottom']}
          style={styles.modalSheet}
          testID="scheduler-create-sheet"
        >
          <View style={styles.modalHeader}>
            <Text accessibilityRole="header" style={styles.modalTitle}>
              {t('scheduler.addTask')}
            </Text>
            <TouchableOpacity
              accessibilityLabel={t('common.close')}
              accessibilityRole="button"
              accessibilityState={{ disabled: isCreating }}
              disabled={isCreating}
              onPress={onClose}
              style={[styles.modalClose, isCreating && styles.actionDisabled]}
              testID="scheduler-create-close"
            >
              <X color={colors.textSecondary} size={22} />
            </TouchableOpacity>
          </View>

          <ScrollView
            contentContainerStyle={styles.formContent}
            keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <Text style={styles.fieldLabel}>{t('scheduler.taskName')}</Text>
            <TextInput
              accessibilityLabel={t('scheduler.taskName')}
              autoCapitalize="sentences"
              autoCorrect
              maxLength={120}
              onChangeText={(value) => {
                setName(value);
                clearFieldError('name');
              }}
              placeholder={t('scheduler.taskNamePlaceholder')}
              placeholderTextColor={colors.placeholder}
              returnKeyType="next"
              style={[styles.input, fieldErrors.name && styles.inputError]}
              testID="scheduler-name-input"
              value={name}
            />
            {fieldErrors.name ? (
              <Text accessibilityLiveRegion="polite" style={styles.fieldError}>
                {fieldErrors.name}
              </Text>
            ) : null}

            <Text style={styles.fieldLabel}>{t('scheduler.prompt')}</Text>
            <Text style={styles.fieldHint}>{t('scheduler.promptHint')}</Text>
            <TextInput
              accessibilityLabel={t('scheduler.prompt')}
              autoCapitalize="sentences"
              autoCorrect
              maxLength={4_000}
              multiline
              onChangeText={(value) => {
                setPrompt(value);
                clearFieldError('prompt');
              }}
              placeholder={t('scheduler.promptPlaceholder')}
              placeholderTextColor={colors.placeholder}
              style={[styles.input, styles.multilineInput, fieldErrors.prompt && styles.inputError]}
              testID="scheduler-prompt-input"
              value={prompt}
            />
            {fieldErrors.prompt ? (
              <Text accessibilityLiveRegion="polite" style={styles.fieldError}>
                {fieldErrors.prompt}
              </Text>
            ) : null}

            <Text style={styles.fieldLabel}>{t('scheduler.scheduleType')}</Text>
            <View accessibilityRole="radiogroup" style={styles.segmentRow}>
              <TouchableOpacity
                accessibilityRole="radio"
                accessibilityState={{ selected: scheduleType === 'every' }}
                onPress={() => {
                  setScheduleType('every');
                  clearFieldError('schedule');
                }}
                style={[
                  styles.segmentButton,
                  scheduleType === 'every' && styles.segmentButtonSelected,
                ]}
                testID="scheduler-schedule-repeat"
              >
                <Text
                  style={[
                    styles.segmentText,
                    scheduleType === 'every' && styles.segmentTextSelected,
                  ]}
                >
                  {t('scheduler.repeat')}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                accessibilityRole="radio"
                accessibilityState={{ selected: scheduleType === 'cron' }}
                onPress={() => {
                  setScheduleType('cron');
                  clearFieldError('schedule');
                }}
                style={[
                  styles.segmentButton,
                  scheduleType === 'cron' && styles.segmentButtonSelected,
                ]}
                testID="scheduler-schedule-advanced"
              >
                <Text
                  style={[
                    styles.segmentText,
                    scheduleType === 'cron' && styles.segmentTextSelected,
                  ]}
                >
                  {t('scheduler.advancedSchedule')}
                </Text>
              </TouchableOpacity>
            </View>

            {scheduleType === 'every' ? (
              <View style={styles.intervalRow}>
                <TextInput
                  accessibilityLabel={t('scheduler.intervalValue')}
                  keyboardType="number-pad"
                  onChangeText={(value) => {
                    setIntervalValue(value);
                    clearFieldError('schedule');
                  }}
                  placeholder="1"
                  placeholderTextColor={colors.placeholder}
                  style={[
                    styles.input,
                    styles.intervalInput,
                    fieldErrors.schedule && styles.inputError,
                  ]}
                  testID="scheduler-interval-input"
                  value={intervalValue}
                />
                <View style={styles.unitRow}>
                  {(Object.keys(UNIT_KEYS) as IntervalUnit[]).map((unit) => {
                    const selected = intervalUnit === unit;
                    return (
                      <TouchableOpacity
                        accessibilityRole="radio"
                        accessibilityState={{ selected }}
                        key={unit}
                        onPress={() => {
                          setIntervalUnit(unit);
                          clearFieldError('schedule');
                        }}
                        style={[styles.unitButton, selected && styles.unitButtonSelected]}
                        testID={`scheduler-unit-${unit}`}
                      >
                        <Text style={[styles.unitText, selected && styles.unitTextSelected]}>
                          {t(UNIT_KEYS[unit])}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>
            ) : (
              <>
                <Text style={styles.fieldHint}>{t('scheduler.advancedHint')}</Text>
                <TextInput
                  accessibilityLabel={t('scheduler.cronExpression')}
                  autoCapitalize="none"
                  autoCorrect={false}
                  onChangeText={(value) => {
                    setCronExpression(value);
                    clearFieldError('schedule');
                  }}
                  placeholder={t('scheduler.cronPlaceholder')}
                  placeholderTextColor={colors.placeholder}
                  style={[styles.input, fieldErrors.schedule && styles.inputError]}
                  testID="scheduler-cron-input"
                  value={cronExpression}
                />
              </>
            )}
            {fieldErrors.schedule ? (
              <Text accessibilityLiveRegion="polite" style={styles.fieldError}>
                {fieldErrors.schedule}
              </Text>
            ) : null}

            <View style={styles.inlinePermission}>
              <Text style={styles.inlinePermissionText}>
                {t(getPermissionHintKey(permissionState))}
              </Text>
              {permissionActionKey ? (
                <TouchableOpacity
                  accessibilityRole="button"
                  accessibilityState={{ busy: isPermissionWorking, disabled: isPermissionWorking }}
                  disabled={isPermissionWorking}
                  onPress={onPermissionAction}
                  style={[
                    styles.inlinePermissionAction,
                    isPermissionWorking && styles.actionDisabled,
                  ]}
                  testID="scheduler-form-notification-action"
                >
                  <Text style={styles.inlinePermissionActionText}>{t(permissionActionKey)}</Text>
                </TouchableOpacity>
              ) : null}
            </View>

            {formError ? (
              <Text accessibilityLiveRegion="assertive" style={styles.formError}>
                {formError}
              </Text>
            ) : null}

            <TouchableOpacity
              accessibilityRole="button"
              accessibilityState={{ busy: isCreating, disabled: isCreating }}
              disabled={isCreating}
              onPress={() => void handleCreate()}
              style={[styles.createButton, isCreating && styles.createButtonDisabled]}
              testID="scheduler-create-submit"
            >
              <Text style={styles.createButtonText}>
                {isCreating ? t('scheduler.creating') : t('scheduler.create')}
              </Text>
            </TouchableOpacity>
          </ScrollView>
        </SafeAreaView>
      </KeyboardAvoidingView>
    </Modal>
  );
}
