import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, FlatList, Linking, Platform, Text, TouchableOpacity, View } from 'react-native';
import { useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AlarmClock, Plus } from 'lucide-react-native';
import type { CronJob, CronSchedule } from '../services/cron/types';
import {
  createScheduledJob,
  deleteScheduledJob,
  setScheduledJobEnabled,
} from '../services/scheduler/commands';
import { runJobNow } from '../services/scheduler/engine';
import { useSchedulerStore } from '../services/scheduler/store';
import { useExecutionTraceStore } from '../services/scheduler/traceStore';
import {
  getNotificationPermissionReadiness,
  requestNotificationPermission,
} from '../services/notifications/service';
import { redactSensitiveText } from '../services/security/toolDetailRedaction';
import { RouteLeadingButton } from '../components/navigation/RouteLeadingButton';
import { SchedulerCreateSheet } from '../components/scheduler/SchedulerCreateSheet';
import {
  SchedulerJobCard,
  type SchedulerJobFeedback,
  type SchedulerJobPendingAction,
} from '../components/scheduler/SchedulerJobCard';
import {
  SchedulerPermissionCard,
  type SchedulerPermissionState,
} from '../components/scheduler/SchedulerPermissionCard';
import { createSchedulerStyles } from '../components/scheduler/Scheduler.styles';
import { useAppTheme } from '../theme/useAppTheme';
import { useTranslation } from '../i18n/useTranslation';

type SchedulerRouteParams = {
  initialJobId?: string;
};

type ScreenNotice = {
  message: string;
  tone: 'info' | 'warning' | 'error';
};

type Translate = (key: string, params?: Record<string, string | number>) => string;

function safeMessage(value: unknown): string {
  const text = value instanceof Error ? value.message : String(value);
  const redacted = redactSensitiveText(text).replace(/\s+/gu, ' ').trim();
  return redacted.length > 300 ? `${redacted.slice(0, 297)}…` : redacted;
}

function safeMutationMessage(value: unknown, t: Translate): string {
  const code =
    value && typeof value === 'object' && 'code' in value
      ? String((value as { code?: unknown }).code)
      : '';
  return code === 'scheduler_persistence_failed' ? t('scheduler.saveFailed') : safeMessage(value);
}

export const SchedulerScreen: React.FC = () => {
  const navigation = useNavigation<any>();
  const route = useRoute<{ key: string; name: string; params?: SchedulerRouteParams }>();
  const { colors } = useAppTheme();
  const { t } = useTranslation();
  const styles = useMemo(() => createSchedulerStyles(colors), [colors]);
  const listRef = useRef<FlatList<CronJob>>(null);
  const permissionRequestId = useRef(0);
  const permissionWorkingRef = useRef(false);
  const pendingJobIdsRef = useRef(new Set<string>());
  const jobs = useSchedulerStore((state) => state.jobs);
  const traces = useExecutionTraceStore((state) => state.traces);
  const [showCreateSheet, setShowCreateSheet] = useState(false);
  const [pendingJobActions, setPendingJobActions] = useState<
    Record<string, SchedulerJobPendingAction>
  >({});
  const [jobFeedback, setJobFeedback] = useState<Record<string, SchedulerJobFeedback>>({});
  const [notice, setNotice] = useState<ScreenNotice | null>(null);
  const [highlightedJobId, setHighlightedJobId] = useState<string | undefined>();
  const [permissionState, setPermissionState] = useState<SchedulerPermissionState>({
    status: 'loading',
    canRequest: false,
  });
  const [isPermissionWorking, setIsPermissionWorking] = useState(false);
  const initialJobId = route.params?.initialJobId;

  const refreshPermission = useCallback(async () => {
    const requestId = ++permissionRequestId.current;
    setPermissionState({ status: 'loading', canRequest: false });
    try {
      const readiness = await getNotificationPermissionReadiness();
      if (permissionRequestId.current === requestId) setPermissionState(readiness);
    } catch {
      if (permissionRequestId.current === requestId) {
        setPermissionState({ status: 'error', canRequest: true });
      }
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void refreshPermission();
      return () => {
        permissionRequestId.current += 1;
      };
    }, [refreshPermission]),
  );

  useEffect(() => {
    if (!initialJobId) return;
    setHighlightedJobId(initialJobId);
    navigation.setParams?.({ initialJobId: undefined });
  }, [initialJobId, navigation]);

  useEffect(() => {
    if (!highlightedJobId) return;
    const index = jobs.findIndex((job) => job.id === highlightedJobId);
    if (index < 0) return;
    const scrollTimer = setTimeout(() => {
      listRef.current?.scrollToIndex?.({ animated: true, index, viewPosition: 0.15 });
    }, 120);
    const highlightTimer = setTimeout(() => setHighlightedJobId(undefined), 4_500);
    return () => {
      clearTimeout(scrollTimer);
      clearTimeout(highlightTimer);
    };
  }, [highlightedJobId, jobs]);

  const handlePermissionAction = useCallback(async () => {
    if (permissionWorkingRef.current) return;
    permissionWorkingRef.current = true;
    setIsPermissionWorking(true);
    try {
      if (permissionState.status === 'blocked') {
        await Linking.openSettings();
        return;
      }
      if (permissionState.status === 'error') {
        await refreshPermission();
        return;
      }
      if (permissionState.status !== 'requestable') return;

      const requestId = ++permissionRequestId.current;
      const readiness = await requestNotificationPermission();
      if (permissionRequestId.current === requestId) setPermissionState(readiness);
    } catch {
      setPermissionState({ status: 'error', canRequest: true });
    } finally {
      permissionWorkingRef.current = false;
      setIsPermissionWorking(false);
    }
  }, [permissionState.status, refreshPermission]);

  const runJobMutation = useCallback(
    async (
      jobId: string,
      action: SchedulerJobPendingAction,
      operation: () => Promise<void>,
      onError?: (error: unknown) => void,
    ) => {
      if (pendingJobIdsRef.current.has(jobId)) return;
      pendingJobIdsRef.current.add(jobId);
      setPendingJobActions((current) => ({ ...current, [jobId]: action }));
      try {
        await operation();
      } catch (error) {
        if (onError) onError(error);
        else setNotice({ message: safeMutationMessage(error, t), tone: 'error' });
      } finally {
        pendingJobIdsRef.current.delete(jobId);
        setPendingJobActions((current) => {
          const next = { ...current };
          delete next[jobId];
          return next;
        });
      }
    },
    [t],
  );

  const handleToggle = useCallback(
    (job: CronJob, enabled: boolean) => {
      void runJobMutation(job.id, 'toggle', async () => {
        const result = await setScheduledJobEnabled(job.id, enabled);
        if (result.status === 'not_found') throw new Error(t('scheduler.jobMissing'));
        const name = job.name || t('scheduler.untitledJob');
        const changeNotice = enabled
          ? t('scheduler.resumedNotice', { name })
          : t('scheduler.pausedNotice', { name });
        setNotice({
          message: result.warning
            ? `${changeNotice} ${t('scheduler.notificationSetupIssue')}`
            : changeNotice,
          tone: result.warning ? 'warning' : 'info',
        });
      });
    },
    [runJobMutation, t],
  );

  const handleDelete = useCallback(
    (job: CronJob) => {
      Alert.alert(
        t('scheduler.deleteJob'),
        t('scheduler.deleteJobConfirm', { name: job.name || t('scheduler.untitledJob') }),
        [
          { text: t('common.cancel'), style: 'cancel' },
          {
            text: t('common.delete'),
            style: 'destructive',
            onPress: () =>
              void runJobMutation(job.id, 'delete', async () => {
                const result = await deleteScheduledJob(job.id);
                if (result === 'busy') throw new Error(t('scheduler.jobRunning'));
                if (result === 'not_found') throw new Error(t('scheduler.jobMissing'));
                setJobFeedback((current) => {
                  const next = { ...current };
                  delete next[job.id];
                  return next;
                });
              }),
          },
        ],
      );
    },
    [runJobMutation, t],
  );

  const handleRun = useCallback(
    (job: CronJob) => {
      if (pendingJobIdsRef.current.has(job.id)) return;
      setJobFeedback((current) => ({
        ...current,
        [job.id]: { message: t('scheduler.runningNow'), tone: 'info' },
      }));
      void runJobMutation(
        job.id,
        'run',
        async () => {
          const result = await runJobNow(job.id, { force: true, trigger: 'manual' });
          let feedback: SchedulerJobFeedback;
          if (result.status === 'succeeded') {
            feedback = {
              message: result.warning
                ? `${t('scheduler.runSucceeded')} ${safeMessage(result.warning)}`
                : t('scheduler.runSucceeded'),
              tone: result.warning ? 'warning' : 'success',
            };
          } else if (result.status === 'busy') {
            feedback = { message: t('scheduler.runBusy'), tone: 'warning' };
          } else if (result.status === 'skipped') {
            feedback = { message: t('scheduler.runUnavailable'), tone: 'warning' };
          } else if (result.status === 'retrying') {
            feedback = {
              message: `${t('scheduler.runRetrying')} ${safeMessage(result.error)}`,
              tone: 'warning',
            };
          } else if (result.status === 'failed') {
            feedback = {
              message: `${t('scheduler.runFailed')} ${safeMessage(result.error)}`,
              tone: 'error',
            };
          } else {
            feedback = { message: t('scheduler.jobMissing'), tone: 'error' };
          }
          setJobFeedback((current) => ({ ...current, [job.id]: feedback }));
        },
        (error) => {
          setJobFeedback((current) => ({
            ...current,
            [job.id]: {
              message: `${t('scheduler.runFailed')} ${safeMessage(error)}`,
              tone: 'error',
            },
          }));
        },
      );
    },
    [runJobMutation, t],
  );

  const handleCreate = useCallback(
    async (input: { name: string; prompt: string; schedule: CronSchedule }) => {
      const created = await createScheduledJob(input);
      setNotice({
        message: created.warning
          ? `${t('scheduler.createdNotice')} ${t('scheduler.notificationSetupIssue')}`
          : t('scheduler.createdNotice'),
        tone: created.warning ? 'warning' : 'info',
      });
    },
    [t],
  );

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']} testID="scheduler-screen">
      <View style={styles.header}>
        <RouteLeadingButton style={styles.headerAction} testID="scheduler-leading" />
        <Text accessibilityRole="header" style={styles.headerTitle}>
          {t('scheduler.title')}
        </Text>
        <TouchableOpacity
          accessibilityLabel={t('scheduler.addTask')}
          accessibilityRole="button"
          onPress={() => setShowCreateSheet(true)}
          style={styles.headerAction}
          testID="scheduler-add"
        >
          <Plus color={colors.primary} size={23} />
        </TouchableOpacity>
      </View>

      <FlatList
        contentContainerStyle={jobs.length > 0 ? styles.listContent : styles.listContentEmpty}
        data={jobs}
        initialNumToRender={12}
        keyExtractor={(job) => job.id}
        ListHeaderComponent={
          <View style={styles.listHeader}>
            <Text style={styles.intro}>{t('scheduler.intro')}</Text>
            <SchedulerPermissionCard
              isWorking={isPermissionWorking}
              onAction={() => void handlePermissionAction()}
              state={permissionState}
            />
            {notice ? (
              <View
                accessibilityLiveRegion={notice.tone === 'error' ? 'assertive' : 'polite'}
                style={styles.notice}
                testID="scheduler-notice"
              >
                <Text
                  style={[
                    styles.noticeText,
                    notice.tone === 'error'
                      ? { color: colors.danger }
                      : notice.tone === 'warning'
                        ? { color: colors.warning }
                        : null,
                  ]}
                >
                  {notice.message}
                </Text>
              </View>
            ) : null}
          </View>
        }
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <View
              style={styles.emptyIcon}
              accessibilityElementsHidden
              importantForAccessibility="no"
            >
              <AlarmClock color={colors.primary} size={27} />
            </View>
            <Text style={styles.emptyTitle}>{t('scheduler.noJobs')}</Text>
            <Text style={styles.emptyHint}>{t('scheduler.noJobsHint')}</Text>
            <TouchableOpacity
              accessibilityLabel={t('scheduler.emptyAction')}
              accessibilityRole="button"
              onPress={() => setShowCreateSheet(true)}
              style={styles.emptyAction}
              testID="scheduler-empty-create"
            >
              <Text style={styles.emptyActionText}>{t('scheduler.emptyAction')}</Text>
            </TouchableOpacity>
          </View>
        }
        maxToRenderPerBatch={10}
        onScrollToIndexFailed={(info) => {
          listRef.current?.scrollToOffset?.({
            animated: true,
            offset: Math.max(0, info.averageItemLength * info.index),
          });
        }}
        ref={listRef}
        removeClippedSubviews={Platform.OS === 'android'}
        renderItem={({ item }) => (
          <SchedulerJobCard
            feedback={jobFeedback[item.id]}
            isSelected={item.id === highlightedJobId}
            job={item}
            onDelete={handleDelete}
            onRun={handleRun}
            onToggle={handleToggle}
            pendingAction={pendingJobActions[item.id]}
            traces={traces}
          />
        )}
      />

      <SchedulerCreateSheet
        isPermissionWorking={isPermissionWorking}
        onClose={() => setShowCreateSheet(false)}
        onCreate={handleCreate}
        onPermissionAction={() => void handlePermissionAction()}
        permissionState={permissionState}
        visible={showCreateSheet}
      />
    </SafeAreaView>
  );
};
