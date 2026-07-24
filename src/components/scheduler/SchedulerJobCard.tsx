import React, { useMemo } from 'react';
import { ActivityIndicator, Text, TouchableOpacity, View } from 'react-native';
import { BellOff, Clock3, Pause, Play, RotateCcw, Trash2 } from 'lucide-react-native';
import type { CronJob } from '../../services/cron/types';
import {
  buildSchedulerJobPresentation,
  type SchedulerJobDisplayState,
  type SchedulerResultDisplayState,
} from '../../services/scheduler/presentation';
import type { ExecutionTrace } from '../../services/scheduler/traceStore';
import { redactSensitiveText } from '../../services/security/toolDetailRedaction';
import { useAppTheme, type AppPalette } from '../../theme/useAppTheme';
import { useTranslation } from '../../i18n/useTranslation';
import { createSchedulerStyles } from './Scheduler.styles';

export type SchedulerJobFeedback = {
  message: string;
  tone: 'info' | 'success' | 'warning' | 'error';
};

export type SchedulerJobPendingAction = 'toggle' | 'run' | 'delete';

type SchedulerJobCardProps = {
  feedback?: SchedulerJobFeedback;
  isSelected: boolean;
  job: CronJob;
  onDelete: (job: CronJob) => void;
  onRun: (job: CronJob) => void;
  onToggle: (job: CronJob, enabled: boolean) => void;
  pendingAction?: SchedulerJobPendingAction;
  traces: readonly ExecutionTrace[];
};

const STATUS_KEYS: Record<SchedulerJobDisplayState, string> = {
  running: 'scheduler.statusRunning',
  retrying: 'scheduler.statusRetrying',
  'needs-attention': 'scheduler.statusNeedsAttention',
  scheduled: 'scheduler.statusScheduled',
  paused: 'scheduler.statusPaused',
};

const RESULT_KEYS: Record<SchedulerResultDisplayState, string> = {
  completed: 'scheduler.resultCompleted',
  failed: 'scheduler.resultFailed',
  retrying: 'scheduler.resultRetrying',
  interrupted: 'scheduler.resultInterrupted',
};

function formatDateTime(timestamp: number, locale: string): string {
  try {
    return new Intl.DateTimeFormat(locale, {
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      month: 'short',
    }).format(new Date(timestamp));
  } catch {
    return new Date(timestamp).toLocaleString();
  }
}

function safeDetail(value: string | undefined): string {
  if (!value) return '';
  const redacted = redactSensitiveText(value).replace(/\s+/gu, ' ').trim();
  return redacted.length > 240 ? `${redacted.slice(0, 237)}…` : redacted;
}

function getStatusTone(state: SchedulerJobDisplayState, colors: AppPalette) {
  if (state === 'running' || state === 'scheduled') {
    return { foreground: colors.primary, background: colors.primarySoft };
  }
  if (state === 'retrying' || state === 'needs-attention') {
    return { foreground: colors.warning, background: colors.warningBackground };
  }
  return { foreground: colors.textSecondary, background: colors.surfaceAlt };
}

function getFeedbackTone(feedback: SchedulerJobFeedback, colors: AppPalette) {
  if (feedback.tone === 'error') {
    return { foreground: colors.danger, background: colors.dangerSoft };
  }
  if (feedback.tone === 'warning') {
    return { foreground: colors.warning, background: colors.warningBackground };
  }
  if (feedback.tone === 'success') {
    return { foreground: colors.success, background: colors.primarySoft };
  }
  return { foreground: colors.info, background: colors.surfaceAlt };
}

export function SchedulerJobCard({
  feedback,
  isSelected,
  job,
  onDelete,
  onRun,
  onToggle,
  pendingAction,
  traces,
}: SchedulerJobCardProps) {
  const { colors } = useAppTheme();
  const { locale, t } = useTranslation();
  const styles = useMemo(() => createSchedulerStyles(colors), [colors]);
  const presentation = useMemo(() => buildSchedulerJobPresentation(job, traces), [job, traces]);
  const statusTone = getStatusTone(presentation.state, colors);
  const statusLabel = t(STATUS_KEYS[presentation.state]);
  const latestResult = presentation.latestResult;
  const retryAction =
    presentation.state === 'needs-attention' ||
    latestResult?.status === 'failed' ||
    latestResult?.status === 'interrupted';
  const wakeDetail = safeDetail(job.lastWakeError || job.lastDeliveryError);
  const resultDetail = safeDetail(latestResult?.detail);
  const feedbackTone = feedback ? getFeedbackTone(feedback, colors) : undefined;
  const isPending = Boolean(pendingAction);
  const isRunning = pendingAction === 'run' || presentation.state === 'running';

  const scheduleText = (() => {
    if (job.schedule.kind === 'cron') {
      return t('scheduler.cronFormat', { expr: job.schedule.expr });
    }
    if (job.schedule.kind === 'every') {
      const milliseconds = Number(job.schedule.everyMs);
      if (milliseconds >= 86_400_000) {
        return t('scheduler.everyDaysFormat', {
          value: String(milliseconds / 86_400_000),
        });
      }
      if (milliseconds >= 3_600_000) {
        return t('scheduler.everyHoursFormat', {
          value: String(milliseconds / 3_600_000),
        });
      }
      return t('scheduler.everyMinutesFormat', {
        value: String(milliseconds / 60_000),
      });
    }
    const rawAt = job.schedule.atMs ?? job.schedule.at;
    const numericAt = Number(rawAt);
    const atMs = Number.isFinite(numericAt)
      ? numericAt
      : typeof rawAt === 'string'
        ? Date.parse(rawAt)
        : Number.NaN;
    return Number.isFinite(atMs) && atMs > 0
      ? t('scheduler.atFormat', { date: formatDateTime(atMs, locale) })
      : t('scheduler.unknown');
  })();

  return (
    <View
      accessibilityLabel={`${job.name || t('scheduler.untitledJob')}, ${statusLabel}`}
      style={[styles.jobCard, isSelected && styles.jobCardSelected]}
      testID={`scheduler-job-${job.id}`}
    >
      <View style={styles.jobHeader}>
        <View style={styles.jobIcon} accessibilityElementsHidden importantForAccessibility="no">
          <Clock3 color={statusTone.foreground} size={21} />
        </View>
        <View style={styles.jobHeading}>
          <Text accessibilityRole="header" style={styles.jobTitle} numberOfLines={2}>
            {job.name || t('scheduler.untitledJob')}
          </Text>
          <Text style={styles.scheduleText} numberOfLines={2}>
            {scheduleText}
          </Text>
        </View>
        <View style={[styles.statusPill, { backgroundColor: statusTone.background }]}>
          <Text style={[styles.statusText, { color: statusTone.foreground }]}>{statusLabel}</Text>
        </View>
      </View>

      {job.payload?.prompt ? (
        <Text style={styles.prompt} numberOfLines={3}>
          {job.payload.prompt}
        </Text>
      ) : null}

      <View style={styles.metadataGroup}>
        {presentation.state !== 'paused' && presentation.nextOccurrenceAt ? (
          <Text style={styles.metadataText}>
            {t('scheduler.nextOccurrence', {
              date: formatDateTime(presentation.nextOccurrenceAt, locale),
            })}
          </Text>
        ) : null}
        {latestResult ? (
          <>
            <Text style={styles.metadataText}>
              {t('scheduler.latestResult', {
                status: t(RESULT_KEYS[latestResult.status]),
                date: formatDateTime(latestResult.timestamp, locale),
              })}
            </Text>
            {resultDetail ? (
              <Text style={styles.resultDetail} numberOfLines={3}>
                {resultDetail}
              </Text>
            ) : null}
          </>
        ) : (
          <Text style={styles.metadataText}>{t('scheduler.noRunHistory')}</Text>
        )}
      </View>

      {presentation.hasNotificationIssue ? (
        <View style={styles.warningRow} testID={`scheduler-notification-issue-${job.id}`}>
          <BellOff color={colors.warning} size={18} />
          <View style={styles.warningCopy}>
            <Text style={styles.warningTitle}>{t('scheduler.notificationIssue')}</Text>
            {wakeDetail ? (
              <Text style={styles.warningDetail} numberOfLines={3}>
                {wakeDetail}
              </Text>
            ) : null}
          </View>
        </View>
      ) : null}

      {feedback && feedbackTone ? (
        <View
          accessibilityLiveRegion="polite"
          style={[styles.feedback, { backgroundColor: feedbackTone.background }]}
          testID={`scheduler-feedback-${job.id}`}
        >
          <Text style={[styles.feedbackText, { color: feedbackTone.foreground }]}>
            {feedback.message}
          </Text>
        </View>
      ) : null}

      <View style={styles.jobActions}>
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityState={{ busy: isRunning, disabled: isPending || isRunning }}
          disabled={isPending || isRunning}
          onPress={() => onRun(job)}
          style={[styles.primaryAction, (isPending || isRunning) && styles.actionDisabled]}
          testID={`scheduler-run-${job.id}`}
        >
          {isRunning ? (
            <ActivityIndicator color={colors.onPrimary} size="small" />
          ) : retryAction ? (
            <RotateCcw color={colors.onPrimary} size={17} />
          ) : (
            <Play color={colors.onPrimary} size={17} />
          )}
          <Text style={styles.primaryActionText}>
            {isRunning
              ? t('scheduler.runningNow')
              : retryAction
                ? t('scheduler.tryAgain')
                : t('scheduler.runNow')}
          </Text>
        </TouchableOpacity>
        <View style={styles.secondaryActions}>
          <TouchableOpacity
            accessibilityLabel={job.enabled ? t('scheduler.pause') : t('scheduler.resume')}
            accessibilityRole="button"
            accessibilityState={{ disabled: isPending }}
            disabled={isPending}
            onPress={() => onToggle(job, !job.enabled)}
            style={[styles.secondaryAction, isPending && styles.actionDisabled]}
            testID={`scheduler-toggle-${job.id}`}
          >
            {job.enabled ? (
              <Pause color={colors.text} size={17} />
            ) : (
              <Play color={colors.text} size={17} />
            )}
            <Text style={styles.secondaryActionText}>
              {job.enabled ? t('scheduler.pause') : t('scheduler.resume')}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            accessibilityLabel={t('scheduler.deleteJobLabel', {
              name: job.name || t('scheduler.untitledJob'),
            })}
            accessibilityRole="button"
            accessibilityState={{ disabled: isPending || presentation.state === 'running' }}
            disabled={isPending || presentation.state === 'running'}
            onPress={() => onDelete(job)}
            style={[
              styles.destructiveAction,
              (isPending || presentation.state === 'running') && styles.actionDisabled,
            ]}
            testID={`scheduler-delete-${job.id}`}
          >
            <Trash2 color={colors.danger} size={19} />
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}
