// ---------------------------------------------------------------------------
// Kavi — Approval History Screen
// ---------------------------------------------------------------------------
// Full-page view of approval requests: pending, approved, rejected, expired.
// Provides audit trail, search/filter, and batch actions.

import React, { useCallback, useMemo, useState, useSyncExternalStore } from 'react';
import { FlatList, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { DrawerNavigationProp } from '@react-navigation/drawer';
import { useNavigation } from '@react-navigation/native';
import { Menu, ShieldCheck, ShieldX, Clock, Trash2, ShieldAlert } from 'lucide-react-native';
import { useAppTheme, type AppPalette } from '../theme/useAppTheme';
import { useTranslation } from '../i18n/useTranslation';
import { useApprovalStore } from '../services/remote/approvalStore';
import {
  getAuditLogVersion,
  getAuditStats,
  getRecentAuditEntries,
  subscribeAuditLog,
} from '../services/security/audit';
import type { RemoteApprovalRequest } from '../types/remote';

type StatusFilter = 'all' | 'pending' | 'approved' | 'rejected' | 'expired';

export const ApprovalHistoryScreen: React.FC = () => {
  const navigation = useNavigation<DrawerNavigationProp<any>>();
  const { colors } = useAppTheme();
  const { t } = useTranslation();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const requests = useApprovalStore((s) => s.requests);
  const policy = useApprovalStore((s) => s.policy);
  const analytics = useApprovalStore((s) => s.analytics);
  const approve = useApprovalStore((s) => s.approveRequest);
  const reject = useApprovalStore((s) => s.rejectRequest);
  const clearResolved = useApprovalStore((s) => s.clearResolved);
  const setPolicy = useApprovalStore((s) => s.setPolicy);
  useSyncExternalStore(subscribeAuditLog, getAuditLogVersion, getAuditLogVersion);

  const [filter, setFilter] = useState<StatusFilter>('all');

  const allRequests = useMemo(() => {
    const arr = Object.values(requests).sort((a, b) => b.requestedAt - a.requestedAt);
    if (filter === 'all') return arr;
    return arr.filter((r) => r.status === filter);
  }, [requests, filter]);

  const pendingCount = useMemo(
    () => Object.values(requests).filter((r) => r.status === 'pending').length,
    [requests],
  );

  const nativeAuditStats = getAuditStats({ category: 'native', type: 'tool_call' });

  const recentNativeActivity = getRecentAuditEntries(8, {
    category: 'native',
    type: 'tool_call',
  })
    .slice()
    .reverse()
    .slice(0, 5);

  const formatTimestamp = (ts: number): string => {
    const d = new Date(ts);
    return d.toLocaleString([], {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const getStatusIcon = useCallback(
    (status: string) => {
      switch (status) {
        case 'approved':
          return <ShieldCheck size={16} color="#22c55e" />;
        case 'rejected':
          return <ShieldX size={16} color={colors.danger} />;
        case 'expired':
          return <Clock size={16} color={colors.textTertiary} />;
        default:
          return <ShieldAlert size={16} color={colors.warning} />;
      }
    },
    [colors.danger, colors.textTertiary, colors.warning],
  );

  const getStatusLabel = useCallback(
    (status: string): string => {
      switch (status) {
        case 'approved':
          return t('approvalHistory.status.approved');
        case 'success':
          return colors.success;
        case 'rejected':
          return t('approvalHistory.status.rejected');
        case 'error':
          return colors.danger;
        case 'expired':
          return t('approvalHistory.status.expired');
        default:
          return t('approvalHistory.status.pending');
      }
    },
    [colors.danger, colors.success, t],
  );

  const getStatusColor = useCallback(
    (status: string) => {
      switch (status) {
        case 'approved':
          return '#22c55e';
        case 'success':
          return t('approvalHistory.status.success');
        case 'rejected':
          return colors.danger;
        case 'error':
          return t('approvalHistory.status.error');
        case 'expired':
          return colors.textTertiary;
        default:
          return colors.warning;
      }
    },
    [colors.danger, colors.textTertiary, colors.warning, t],
  );

  const handleTogglePolicy = useCallback(() => {
    setPolicy({ requireApproval: !policy.requireApproval });
  }, [policy.requireApproval, setPolicy]);

  const getFilterLabel = useCallback(
    (value: StatusFilter): string => {
      switch (value) {
        case 'pending':
          return t('approvalHistory.filter.pending');
        case 'approved':
          return t('approvalHistory.filter.approved');
        case 'rejected':
          return t('approvalHistory.filter.rejected');
        case 'expired':
          return t('approvalHistory.filter.expired');
        default:
          return t('approvalHistory.filter.all');
      }
    },
    [t],
  );

  const approvalMetrics = useMemo(
    () => [
      { label: t('approvalHistory.metric.pending'), value: String(pendingCount) },
      { label: t('approvalHistory.metric.approved'), value: String(analytics.totalApproved) },
      { label: t('approvalHistory.metric.rejected'), value: String(analytics.totalRejected) },
      { label: t('approvalHistory.metric.expired'), value: String(analytics.totalExpired) },
    ],
    [analytics.totalApproved, analytics.totalExpired, analytics.totalRejected, pendingCount, t],
  );

  const nativeMetrics = useMemo(
    () => [
      {
        label: t('approvalHistory.metric.nativeCalls'),
        value: String(nativeAuditStats.totalCalls),
      },
      {
        label: t('approvalHistory.metric.nativeErrors'),
        value: String(nativeAuditStats.errorCount),
      },
    ],
    [nativeAuditStats.errorCount, nativeAuditStats.totalCalls, t],
  );

  const renderItem = useCallback(
    ({ item }: { item: RemoteApprovalRequest }) => (
      <View style={styles.card}>
        <View style={styles.cardRow}>
          {getStatusIcon(item.status)}
          <View style={styles.cardContent}>
            <Text style={styles.cardTitle} numberOfLines={1}>
              {item.title}
            </Text>
            <Text style={styles.cardDesc} numberOfLines={2}>
              {item.description}
            </Text>
            {item.targetId && (
              <Text style={styles.cardTarget}>
                {t('approvalHistory.targetLabel', { target: item.targetId })}
              </Text>
            )}
            <View style={styles.cardMeta}>
              <Text style={[styles.cardStatus, { color: getStatusColor(item.status) }]}>
                {getStatusLabel(item.status)}
              </Text>
              <Text style={styles.cardTime}>{formatTimestamp(item.requestedAt)}</Text>
              {item.resolvedAt && (
                <Text style={styles.cardTime}> → {formatTimestamp(item.resolvedAt)}</Text>
              )}
            </View>
          </View>
        </View>
        {item.status === 'pending' && (
          <View style={styles.cardActions}>
            <TouchableOpacity style={styles.rejectBtn} onPress={() => reject(item.id)}>
              <ShieldX size={14} color={colors.danger} />
              <Text style={styles.rejectText}>{t('approvalHistory.action.reject')}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.approveBtn} onPress={() => approve(item.id)}>
              <ShieldCheck size={14} color={colors.onPrimary} />
              <Text style={styles.approveText}>{t('approvalHistory.action.approve')}</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    ),
    [approve, reject, colors, styles, t, getStatusColor, getStatusIcon, getStatusLabel],
  );

  const FILTERS: StatusFilter[] = ['all', 'pending', 'approved', 'rejected', 'expired'];

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.openDrawer()} hitSlop={8}>
          <Menu size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{t('approvalHistory.title')}</Text>
        <TouchableOpacity onPress={clearResolved} hitSlop={8}>
          <Trash2 size={20} color={colors.textSecondary} />
        </TouchableOpacity>
      </View>

      {/* Policy toggle */}
      <TouchableOpacity style={styles.policyBar} onPress={handleTogglePolicy}>
        <ShieldAlert
          size={16}
          color={policy.requireApproval ? colors.primary : colors.textTertiary}
        />
        <Text style={styles.policyText}>
          {policy.requireApproval
            ? t('approvalHistory.globalApprovalOn')
            : t('approvalHistory.globalApprovalOff')}
        </Text>
        <View
          style={[
            styles.policyDot,
            { backgroundColor: policy.requireApproval ? colors.primary : colors.textTertiary },
          ]}
        />
      </TouchableOpacity>

      {/* Filter bar */}
      <View style={styles.filterBar}>
        {FILTERS.map((f) => (
          <TouchableOpacity
            key={f}
            style={[styles.filterChip, filter === f && styles.filterChipActive]}
            onPress={() => setFilter(f)}
          >
            <Text style={[styles.filterText, filter === f && styles.filterTextActive]}>
              {getFilterLabel(f)}
              {f === 'pending' && pendingCount > 0 ? ` (${pendingCount})` : ''}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* List */}
      <FlatList
        data={allRequests}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        contentContainerStyle={styles.list}
        ListHeaderComponent={
          <View style={styles.dashboard}>
            <Text style={styles.sectionTitle}>{t('approvalHistory.section.approvalMetrics')}</Text>
            <View style={styles.metricsRow}>
              {approvalMetrics.map((metric) => (
                <View key={metric.label} style={styles.metricCard}>
                  <Text style={styles.metricValue}>{metric.value}</Text>
                  <Text style={styles.metricLabel}>{metric.label}</Text>
                </View>
              ))}
            </View>

            <Text style={styles.sectionTitle}>{t('approvalHistory.section.nativeTelemetry')}</Text>
            <View style={styles.metricsRow}>
              {nativeMetrics.map((metric) => (
                <View key={metric.label} style={styles.metricCard}>
                  <Text style={styles.metricValue}>{metric.value}</Text>
                  <Text style={styles.metricLabel}>{metric.label}</Text>
                </View>
              ))}
            </View>

            <Text style={styles.sectionTitle}>
              {t('approvalHistory.section.recentNativeActivity')}
            </Text>
            {recentNativeActivity.length === 0 ? (
              <Text style={styles.emptyTelemetry}>{t('approvalHistory.noNativeActivity')}</Text>
            ) : (
              <View style={styles.telemetryList}>
                {recentNativeActivity.map((entry, index) => (
                  <View
                    key={`${entry.timestamp}-${entry.toolName || index}`}
                    style={styles.telemetryItem}
                  >
                    <View style={styles.telemetryHeader}>
                      <Text style={styles.telemetryTool}>{entry.toolName || 'tool_call'}</Text>
                      <Text
                        style={[
                          styles.telemetryStatus,
                          { color: getStatusColor(entry.result || 'pending') },
                        ]}
                      >
                        {getStatusLabel(entry.result || 'pending')}
                      </Text>
                    </View>
                    <Text style={styles.telemetrySummary} numberOfLines={2}>
                      {entry.summary || entry.arguments || ''}
                    </Text>
                    <Text style={styles.telemetryMeta}>
                      {formatTimestamp(entry.timestamp)}
                      {typeof entry.duration === 'number' ? ` · ${entry.duration}ms` : ''}
                    </Text>
                  </View>
                ))}
              </View>
            )}
          </View>
        }
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <ShieldCheck size={40} color={colors.textTertiary} />
            <Text style={styles.emptyTitle}>{t('approvalHistory.emptyTitle')}</Text>
            <Text style={styles.emptySubtext}>{t('approvalHistory.emptyDescription')}</Text>
          </View>
        }
      />
    </SafeAreaView>
  );
};

// ── Styles ────────────────────────────────────────────────────────────────

const createStyles = (colors: AppPalette) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 16,
      paddingVertical: 12,
      backgroundColor: colors.header,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    headerTitle: { fontSize: 17, fontWeight: '600', color: colors.text },
    policyBar: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      paddingHorizontal: 16,
      paddingVertical: 10,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
      backgroundColor: colors.surface,
    },
    policyText: { flex: 1, fontSize: 13, color: colors.text },
    policyDot: { width: 8, height: 8, borderRadius: 4 },
    filterBar: {
      flexDirection: 'row',
      gap: 6,
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    filterChip: {
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: colors.border,
    },
    filterChipActive: {
      backgroundColor: colors.primary,
      borderColor: colors.primary,
    },
    filterText: { fontSize: 12, color: colors.textSecondary },
    filterTextActive: { color: colors.onPrimary, fontWeight: '600' },
    list: { padding: 12, gap: 8 },
    dashboard: { gap: 10, marginBottom: 12 },
    sectionTitle: { fontSize: 13, fontWeight: '700', color: colors.text, marginTop: 4 },
    metricsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    metricCard: {
      minWidth: 96,
      flexGrow: 1,
      backgroundColor: colors.surface,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: colors.border,
      paddingHorizontal: 12,
      paddingVertical: 10,
      gap: 4,
    },
    metricValue: { fontSize: 18, fontWeight: '700', color: colors.text },
    metricLabel: { fontSize: 11, color: colors.textSecondary, textTransform: 'uppercase' },
    card: {
      backgroundColor: colors.surface,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: colors.border,
      padding: 12,
      gap: 8,
    },
    cardRow: { flexDirection: 'row', gap: 10 },
    cardContent: { flex: 1, gap: 2 },
    cardTitle: { fontSize: 14, fontWeight: '600', color: colors.text },
    cardDesc: { fontSize: 12, color: colors.textSecondary, lineHeight: 16 },
    cardTarget: { fontSize: 11, color: colors.textTertiary, fontFamily: 'monospace' },
    cardMeta: { flexDirection: 'row', gap: 6, marginTop: 4, alignItems: 'center' },
    cardStatus: { fontSize: 11, fontWeight: '600', textTransform: 'capitalize' },
    cardTime: { fontSize: 11, color: colors.textTertiary },
    cardActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8 },
    rejectBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderRadius: 6,
      borderWidth: 1,
      borderColor: colors.danger,
    },
    rejectText: { fontSize: 12, fontWeight: '600', color: colors.danger },
    approveBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderRadius: 6,
      backgroundColor: colors.primary,
    },
    approveText: { fontSize: 12, fontWeight: '600', color: colors.onPrimary },
    telemetryList: { gap: 8 },
    telemetryItem: {
      backgroundColor: colors.surface,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: colors.border,
      paddingHorizontal: 12,
      paddingVertical: 10,
      gap: 4,
    },
    telemetryHeader: { flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
    telemetryTool: { fontSize: 12, fontWeight: '600', color: colors.text },
    telemetryStatus: { fontSize: 11, fontWeight: '700', textTransform: 'capitalize' },
    telemetrySummary: { fontSize: 12, color: colors.textSecondary, lineHeight: 16 },
    telemetryMeta: { fontSize: 11, color: colors.textTertiary },
    emptyTelemetry: { fontSize: 12, color: colors.textSecondary },
    emptyState: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      padding: 40,
      gap: 8,
    },
    emptyTitle: { fontSize: 16, fontWeight: '600', color: colors.text },
    emptySubtext: { fontSize: 13, color: colors.textSecondary, textAlign: 'center' },
  });
