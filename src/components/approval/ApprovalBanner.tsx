// ---------------------------------------------------------------------------
// Kavi — Approval Banner Component
// ---------------------------------------------------------------------------
// Renders pending approval requests as dismissible banners.
// Designed to be embedded in ChatScreen or as an overlay.

import React, { useMemo } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { ShieldCheck, ShieldX, Clock, ShieldAlert, CheckCheck } from 'lucide-react-native';
import { useApprovalStore } from '../../services/remote/approvalStore';
import { useAppTheme, AppPalette } from '../../theme/useAppTheme';
import { useTranslation } from '../../i18n';
import type { RemoteApprovalRequest } from '../../types';

const RISK_COLORS: Record<string, (colors: AppPalette) => string> = {
  low: (c) => c.success,
  medium: (c) => c.warning,
  high: (c) => c.danger,
  critical: (c) => c.danger,
};

export const ApprovalBanner: React.FC = () => {
  const { colors } = useAppTheme();
  const { t } = useTranslation();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const requests = useApprovalStore((s) => s.requests);
  const approve = useApprovalStore((s) => s.approveRequest);
  const reject = useApprovalStore((s) => s.rejectRequest);
  const approveAlways = useApprovalStore((s) => s.approveAlways);
  const pending = useMemo(
    () => Object.values(requests).filter((request) => request.status === 'pending'),
    [requests],
  );

  if (pending.length === 0) return null;

  return (
    <View style={styles.container}>
      {pending.slice(0, 3).map((req) => (
        <ApprovalCard
          key={req.id}
          request={req}
          colors={colors}
          styles={styles}
          onApprove={() => approve(req.id)}
          onReject={() => reject(req.id)}
          onAlwaysAllow={() => approveAlways(req.id)}
        />
      ))}
      {pending.length > 3 && (
        <Text style={styles.moreText}>
          {t('approvalBanner.morePending', { count: pending.length - 3 })}
        </Text>
      )}
    </View>
  );
};

const ApprovalCard: React.FC<{
  request: RemoteApprovalRequest;
  colors: AppPalette;
  styles: ReturnType<typeof createStyles>;
  onApprove: () => void;
  onReject: () => void;
  onAlwaysAllow: () => void;
}> = ({ request, colors, styles, onApprove, onReject, onAlwaysAllow }) => {
  const { t } = useTranslation();
  const elapsed = Math.round((Date.now() - request.requestedAt) / 1000);
  const elapsedText =
    elapsed < 60
      ? t('approvalBanner.elapsedSeconds', { count: elapsed })
      : t('approvalBanner.elapsedMinutes', { count: Math.floor(elapsed / 60) });

  const riskLevel = request.riskLevel || 'low';
  const riskColor = RISK_COLORS[riskLevel]?.(colors) || colors.textSecondary;
  const borderColor =
    riskLevel === 'critical' || riskLevel === 'high' ? colors.danger : colors.warning;

  return (
    <View style={[styles.card, { borderColor }]}>
      <View style={styles.cardHeader}>
        {riskLevel === 'high' || riskLevel === 'critical' ? (
          <ShieldAlert size={14} color={riskColor} />
        ) : (
          <Clock size={14} color={colors.warning} />
        )}
        <Text style={styles.cardTitle} numberOfLines={1}>
          {request.title}
        </Text>
        <View style={[styles.riskBadge, { backgroundColor: riskColor }]}>
          <Text style={styles.riskBadgeText}>{riskLevel.toUpperCase()}</Text>
        </View>
        <Text style={styles.cardTime}>{elapsedText}</Text>
      </View>
      <Text style={styles.cardDescription} numberOfLines={2}>
        {request.description}
      </Text>
      {request.riskReasons && request.riskReasons.length > 0 && (
        <Text style={styles.riskReasons} numberOfLines={2}>
          {request.riskReasons.join(' · ')}
        </Text>
      )}
      {request.targetId && (
        <Text style={styles.cardTarget}>
          {t('approvalBanner.targetLabel', { target: request.targetId })}
        </Text>
      )}
      <View style={styles.cardActions}>
        <TouchableOpacity style={styles.rejectBtn} onPress={onReject} accessibilityRole="button">
          <ShieldX size={14} color={colors.danger} />
          <Text style={styles.rejectText}>{t('approvalBanner.reject')}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.alwaysAllowBtn}
          onPress={onAlwaysAllow}
          accessibilityRole="button"
        >
          <CheckCheck size={14} color={colors.primary} />
          <Text style={styles.alwaysAllowText}>{t('approvalBanner.alwaysAllow')}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.approveBtn} onPress={onApprove} accessibilityRole="button">
          <ShieldCheck size={14} color={colors.onPrimary} />
          <Text style={styles.approveText}>{t('approvalBanner.approve')}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

const createStyles = (colors: AppPalette) =>
  StyleSheet.create({
    container: { gap: 8, paddingHorizontal: 12, paddingVertical: 6 },
    card: {
      backgroundColor: colors.surface,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: colors.warning,
      padding: 12,
      gap: 6,
    },
    cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    cardTitle: { flex: 1, fontSize: 13, fontWeight: '600', color: colors.text },
    cardTime: { fontSize: 11, color: colors.textTertiary },
    cardDescription: { fontSize: 12, color: colors.textSecondary, lineHeight: 16 },
    cardTarget: { fontSize: 11, color: colors.textTertiary, fontFamily: 'monospace' },
    riskBadge: {
      paddingHorizontal: 6,
      paddingVertical: 1,
      borderRadius: 4,
    },
    riskBadgeText: { fontSize: 9, fontWeight: '700', color: '#fff' },
    riskReasons: { fontSize: 11, color: colors.warning, fontStyle: 'italic' },
    cardActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8, marginTop: 4 },
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
    alwaysAllowBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderRadius: 6,
      borderWidth: 1,
      borderColor: colors.primary,
    },
    alwaysAllowText: { fontSize: 12, fontWeight: '600', color: colors.primary },
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
    moreText: { fontSize: 12, color: colors.textTertiary, textAlign: 'center', paddingVertical: 4 },
  });
