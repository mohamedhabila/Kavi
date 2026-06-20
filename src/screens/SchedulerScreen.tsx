// ---------------------------------------------------------------------------
// Kavi — Scheduler Dashboard Screen
// ---------------------------------------------------------------------------

import React, { useCallback, useMemo, useState } from 'react';
import {
  Alert,
  FlatList,
  Modal,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ArrowLeft, Clock, Plus, Trash2, X } from 'lucide-react-native';
import { useSchedulerStore } from '../services/scheduler/store';
import { syncSchedulerWakeNotifications } from '../services/scheduler/wakeNotifications';
import { useAppTheme, AppPalette } from '../theme/useAppTheme';
import { useTranslation } from '../i18n/useTranslation';
import type { CronJob } from '../services/cron/types';
import { useBackToChat } from '../navigation/useBackToChat';

export const SchedulerScreen: React.FC = () => {
  const handleBack = useBackToChat();
  const { colors } = useAppTheme();
  const { t } = useTranslation();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const jobs = useSchedulerStore((s) => s.jobs);
  const enableJob = useSchedulerStore((s) => s.enableJob);
  const disableJob = useSchedulerStore((s) => s.disableJob);
  const removeJob = useSchedulerStore((s) => s.removeJob);
  const addJob = useSchedulerStore((s) => s.addJob);

  const [showAddModal, setShowAddModal] = useState(false);
  const [newName, setNewName] = useState('');
  const [newPrompt, setNewPrompt] = useState('');
  const [scheduleType, setScheduleType] = useState<'every' | 'cron'>('every');
  const [intervalValue, setIntervalValue] = useState('1');
  const [intervalUnit, setIntervalUnit] = useState<'minutes' | 'hours' | 'days'>('hours');
  const [cronExpr, setCronExpr] = useState('');

  const getIntervalMs = useCallback((): number => {
    const val = parseInt(intervalValue, 10);
    if (!val || val <= 0) return 0;
    switch (intervalUnit) {
      case 'minutes':
        return val * 60000;
      case 'hours':
        return val * 3600000;
      case 'days':
        return val * 86400000;
    }
  }, [intervalUnit, intervalValue]);

  const handleAddTask = useCallback(() => {
    const name = newName.trim();
    if (!name) {
      Alert.alert(t('common.error'), t('scheduler.nameRequired'));
      return;
    }
    const prompt = newPrompt.trim();
    if (!prompt) {
      Alert.alert(t('common.error'), t('scheduler.promptRequired'));
      return;
    }

    if (scheduleType === 'every') {
      const ms = getIntervalMs();
      if (!ms) {
        Alert.alert(t('common.error'), t('scheduler.scheduleRequired'));
        return;
      }
      addJob({ name, prompt, schedule: { kind: 'every', everyMs: ms } });
    } else {
      const expr = cronExpr.trim();
      if (!expr) {
        Alert.alert(t('common.error'), t('scheduler.scheduleRequired'));
        return;
      }
      addJob({ name, prompt, schedule: { kind: 'cron', expr } });
    }
    void syncSchedulerWakeNotifications({ force: true }).catch((error) =>
      console.warn('[scheduler] Failed to schedule wake notification:', error),
    );
    setNewName('');
    setNewPrompt('');
    setIntervalValue('1');
    setIntervalUnit('hours');
    setCronExpr('');
    setShowAddModal(false);
  }, [addJob, cronExpr, getIntervalMs, newName, newPrompt, scheduleType, t]);

  const handleDelete = (job: CronJob) => {
    Alert.alert(
      t('scheduler.deleteJob'),
      t('scheduler.deleteJobConfirm', { name: job.name || t('scheduler.untitledJob') }),
      [
        { text: t('common.cancel'), style: 'cancel' },
        { text: t('common.delete'), style: 'destructive', onPress: () => removeJob(job.id) },
      ],
    );
  };

  const formatSchedule = (job: CronJob): string => {
    if (job.schedule.kind === 'cron') return t('scheduler.cronFormat', { expr: job.schedule.expr });
    if (job.schedule.kind === 'every') {
      const ms = Number(job.schedule.everyMs);
      if (ms >= 86400000)
        return t('scheduler.everyFormat', {
          value: String(ms / 86400000),
          unit: t('scheduler.days'),
        });
      if (ms >= 3600000)
        return t('scheduler.everyFormat', {
          value: String(ms / 3600000),
          unit: t('scheduler.hours'),
        });
      return t('scheduler.everyFormat', {
        value: String(ms / 60000),
        unit: t('scheduler.minutes'),
      });
    }
    if (job.schedule.kind === 'at')
      return t('scheduler.atFormat', {
        date: new Date(Number(job.schedule.atMs)).toLocaleString(),
      });
    return t('scheduler.unknown');
  };

  const formatTimestamp = (ts?: number) => {
    if (!ts) return t('scheduler.never');
    return new Date(ts).toLocaleString();
  };

  const renderJob = ({ item: job }: { item: CronJob }) => {
    const nextRunAtMs = job.nextRetryAtMs || job.nextRunAtMs;
    return (
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <View style={styles.cardTitleRow}>
            <Clock size={16} color={job.enabled ? colors.primary : colors.textTertiary} />
            <Text style={styles.cardTitle} numberOfLines={1}>
              {job.name || t('scheduler.untitledJob')}
            </Text>
          </View>
          <Switch
            value={job.enabled}
            onValueChange={(v) => (v ? enableJob(job.id) : disableJob(job.id))}
            trackColor={{ true: colors.primary }}
          />
        </View>

        <Text style={styles.schedule}>{formatSchedule(job)}</Text>

        {job.payload?.prompt && (
          <Text style={styles.prompt} numberOfLines={2}>
            {job.payload.prompt}
          </Text>
        )}

        <View style={styles.runtimeGrid}>
          <Text style={styles.runtimeText}>
            {t('scheduler.nextRun')}: {formatTimestamp(nextRunAtMs)}
          </Text>
          <Text style={styles.runtimeText}>
            {t('scheduler.lastRun')}: {formatTimestamp(job.lastRunAtMs)}
          </Text>
        </View>

        {job.lastError ? (
          <Text style={styles.errorText} numberOfLines={1}>
            {t('common.error')}: {job.lastError}
          </Text>
        ) : null}

        <View style={styles.cardFooter}>
          <Text style={styles.lastRun}>
            {t('scheduler.lastUpdate', { date: formatTimestamp(job.updatedAtMs) })}
          </Text>
          <TouchableOpacity
            onPress={() => handleDelete(job)}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={`Delete task ${job.name || job.id}`}
          >
            <Trash2 size={16} color={colors.danger} />
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity
          onPress={handleBack}
          accessibilityRole="button"
          accessibilityLabel={t('common.back')}
        >
          <ArrowLeft size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{t('scheduler.title')}</Text>
        <TouchableOpacity
          onPress={() => setShowAddModal(true)}
          accessibilityRole="button"
          accessibilityLabel={t('scheduler.addTask')}
        >
          <Plus size={24} color={colors.primary} />
        </TouchableOpacity>
      </View>

      <FlatList
        data={jobs}
        keyExtractor={(j) => j.id}
        contentContainerStyle={styles.list}
        renderItem={renderJob}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Clock size={40} color={colors.textTertiary} />
            <Text style={styles.emptyTitle}>{t('scheduler.noJobs')}</Text>
            <Text style={styles.emptyText}>{t('scheduler.noJobsHint')}</Text>
          </View>
        }
      />

      {/* Add Task Modal */}
      <Modal visible={showAddModal} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>{t('scheduler.addTask')}</Text>
              <TouchableOpacity
                onPress={() => setShowAddModal(false)}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel={t('common.close')}
              >
                <X size={20} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>
            <TextInput
              style={styles.modalInput}
              value={newName}
              onChangeText={setNewName}
              placeholder={t('scheduler.taskNamePlaceholder')}
              placeholderTextColor={colors.placeholder}
            />
            <TextInput
              style={[styles.modalInput, { height: 80 }]}
              value={newPrompt}
              onChangeText={setNewPrompt}
              placeholder={t('scheduler.promptPlaceholder')}
              placeholderTextColor={colors.placeholder}
              multiline
            />
            {/* Schedule type selector */}
            <View style={styles.segmentRow}>
              <TouchableOpacity
                style={[styles.segmentBtn, scheduleType === 'every' && styles.segmentBtnActive]}
                onPress={() => setScheduleType('every')}
              >
                <Text
                  style={[styles.segmentText, scheduleType === 'every' && styles.segmentTextActive]}
                >
                  {t('scheduler.every')}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.segmentBtn, scheduleType === 'cron' && styles.segmentBtnActive]}
                onPress={() => setScheduleType('cron')}
              >
                <Text
                  style={[styles.segmentText, scheduleType === 'cron' && styles.segmentTextActive]}
                >
                  {t('scheduler.cron')}
                </Text>
              </TouchableOpacity>
            </View>
            {scheduleType === 'every' ? (
              <View>
                <View style={styles.intervalRow}>
                  <TextInput
                    style={[styles.modalInput, { flex: 1, marginBottom: 0 }]}
                    value={intervalValue}
                    onChangeText={setIntervalValue}
                    placeholder="1"
                    placeholderTextColor={colors.placeholder}
                    keyboardType="numeric"
                  />
                  <View style={styles.unitRow}>
                    {(['minutes', 'hours', 'days'] as const).map((unit) => (
                      <TouchableOpacity
                        key={unit}
                        style={[styles.unitBtn, intervalUnit === unit && styles.unitBtnActive]}
                        onPress={() => setIntervalUnit(unit)}
                      >
                        <Text
                          style={[styles.unitText, intervalUnit === unit && styles.unitTextActive]}
                        >
                          {t(`scheduler.${unit}`)}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>
              </View>
            ) : (
              <TextInput
                style={styles.modalInput}
                value={cronExpr}
                onChangeText={setCronExpr}
                placeholder={t('scheduler.cronPlaceholder')}
                placeholderTextColor={colors.placeholder}
              />
            )}
            <TouchableOpacity style={styles.modalButton} onPress={handleAddTask}>
              <Text style={styles.modalButtonText}>{t('scheduler.create')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
};

const createStyles = (colors: AppPalette) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
    header: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingHorizontal: 16,
      paddingVertical: 12,
      backgroundColor: colors.header,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    headerTitle: {
      fontSize: 18,
      fontWeight: '700',
      color: colors.text,
    },
    list: {
      padding: 16,
      flexGrow: 1,
    },
    card: {
      backgroundColor: colors.surface,
      borderRadius: 12,
      padding: 16,
      marginBottom: 12,
      borderWidth: 1,
      borderColor: colors.border,
    },
    cardHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: 8,
    },
    cardTitleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      flex: 1,
    },
    cardTitle: {
      fontSize: 15,
      fontWeight: '600',
      color: colors.text,
      flex: 1,
    },
    schedule: {
      fontSize: 13,
      color: colors.primary,
      fontFamily: 'monospace',
      marginBottom: 6,
    },
    prompt: {
      fontSize: 13,
      color: colors.textSecondary,
      lineHeight: 18,
      marginBottom: 8,
    },
    runtimeGrid: {
      gap: 2,
      marginBottom: 8,
    },
    runtimeText: {
      fontSize: 11,
      color: colors.textTertiary,
    },
    errorText: {
      fontSize: 11,
      color: colors.danger,
      marginBottom: 8,
    },
    cardFooter: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      borderTopWidth: 1,
      borderTopColor: colors.subtleBorder,
      paddingTop: 8,
    },
    lastRun: {
      fontSize: 11,
      color: colors.textTertiary,
    },
    empty: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      padding: 40,
      marginTop: 60,
    },
    emptyTitle: {
      fontSize: 18,
      fontWeight: '600',
      color: colors.textSecondary,
      marginTop: 16,
    },
    emptyText: {
      fontSize: 14,
      color: colors.textTertiary,
      textAlign: 'center',
      marginTop: 8,
      lineHeight: 20,
    },
    modalOverlay: {
      flex: 1,
      justifyContent: 'flex-end',
      backgroundColor: 'rgba(0,0,0,0.4)',
    },
    modalContent: {
      backgroundColor: colors.surface,
      borderTopLeftRadius: 20,
      borderTopRightRadius: 20,
      padding: 20,
      paddingBottom: 40,
    },
    modalHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: 20,
    },
    modalTitle: {
      fontSize: 18,
      fontWeight: '700',
      color: colors.text,
    },
    modalInput: {
      backgroundColor: colors.inputBackground,
      borderRadius: 10,
      paddingHorizontal: 14,
      paddingVertical: 12,
      fontSize: 15,
      color: colors.text,
      borderWidth: 1,
      borderColor: colors.inputBorder,
      marginBottom: 12,
    },
    segmentRow: {
      flexDirection: 'row',
      gap: 8,
      marginBottom: 12,
    },
    segmentBtn: {
      flex: 1,
      paddingVertical: 10,
      borderRadius: 10,
      alignItems: 'center',
      backgroundColor: colors.inputBackground,
      borderWidth: 1,
      borderColor: colors.inputBorder,
    },
    segmentBtnActive: {
      backgroundColor: colors.primarySoft,
      borderColor: colors.primary,
    },
    segmentText: {
      fontSize: 14,
      color: colors.textSecondary,
      fontWeight: '500',
    },
    segmentTextActive: {
      color: colors.primary,
      fontWeight: '600',
    },
    modalButton: {
      backgroundColor: colors.primary,
      borderRadius: 10,
      paddingVertical: 14,
      alignItems: 'center',
      marginTop: 4,
    },
    modalButtonText: {
      color: '#fff',
      fontSize: 16,
      fontWeight: '600',
    },
    intervalRow: {
      flexDirection: 'row',
      gap: 8,
      alignItems: 'center',
      marginBottom: 12,
    },
    unitRow: {
      flexDirection: 'row',
      gap: 4,
    },
    unitBtn: {
      paddingHorizontal: 12,
      paddingVertical: 10,
      borderRadius: 8,
      backgroundColor: colors.inputBackground,
      borderWidth: 1,
      borderColor: colors.inputBorder,
    },
    unitBtnActive: {
      backgroundColor: colors.primarySoft,
      borderColor: colors.primary,
    },
    unitText: {
      fontSize: 13,
      color: colors.textSecondary,
      fontWeight: '500',
    },
    unitTextActive: {
      color: colors.primary,
      fontWeight: '600',
    },
  });
