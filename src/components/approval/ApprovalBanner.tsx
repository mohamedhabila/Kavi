import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, Modal, ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { CheckCheck, Clock3, ShieldAlert, ShieldCheck, ShieldX } from 'lucide-react-native';

import { useTranslation } from '../../i18n/useTranslation';
import { useApprovalStore } from '../../services/remote/approvalStore';
import { useAppTheme, type AppPalette } from '../../theme/useAppTheme';
import type { RemoteApprovalRequest, RemoteApprovalScope } from '../../types/remote';
import { createApprovalBannerStyles } from './approvalBannerStyles';
import {
  buildApprovalPresentation,
  formatApprovalCountdown,
  secondsUntilExpiry,
  sortPendingApprovals,
  type ApprovalReviewReason,
  type ApprovalRiskLevel,
} from './approvalPresentation';

const RISK_COLORS: Record<ApprovalRiskLevel, (colors: AppPalette) => string> = {
  low: (colors) => colors.success,
  medium: (colors) => colors.warning,
  high: (colors) => colors.danger,
  critical: (colors) => colors.danger,
};

export const ApprovalBanner: React.FC<{ enabled?: boolean }> = ({ enabled = true }) => {
  const { colors } = useAppTheme();
  const { t } = useTranslation();
  const styles = useMemo(() => createApprovalBannerStyles(colors), [colors]);
  const requests = useApprovalStore((state) => state.requests);
  const approve = useApprovalStore((state) => state.approveRequest);
  const reject = useApprovalStore((state) => state.rejectRequest);
  const approveAlways = useApprovalStore((state) => state.approveAlways);
  const pending = useMemo(() => sortPendingApprovals(requests), [requests]);
  const request = pending[0];

  if (!enabled || !request) return null;

  return (
    <Modal
      animationType="slide"
      hardwareAccelerated
      onRequestClose={() => undefined}
      statusBarTranslucent
      transparent
      visible
    >
      <View style={styles.overlay}>
        <View
          style={styles.sheet}
          accessibilityLabel={t('approvalBanner.decisionSheetLabel')}
          accessibilityViewIsModal
          testID="approval-decision-sheet"
        >
          <ScrollView
            contentContainerStyle={styles.container}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            testID="approval-decision-scroll"
          >
            <ApprovalCard
              key={request.id}
              request={request}
              queueCount={pending.length}
              colors={colors}
              styles={styles}
              onApprove={() => approve(request.id)}
              onReject={() => reject(request.id)}
              onApproveAlways={() => approveAlways(request.id)}
            />
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
};

interface ApprovalCardProps {
  request: RemoteApprovalRequest;
  queueCount: number;
  colors: AppPalette;
  styles: ReturnType<typeof createApprovalBannerStyles>;
  onApprove: () => void;
  onReject: () => void;
  onApproveAlways: () => void;
}

const ApprovalCard: React.FC<ApprovalCardProps> = ({
  request,
  queueCount,
  colors,
  styles,
  onApprove,
  onReject,
  onApproveAlways,
}) => {
  const { t } = useTranslation();
  const [now, setNow] = useState(() => Date.now());
  const [reviewingPermission, setReviewingPermission] = useState(false);
  const announcedRequestId = useRef<string | null>(null);
  const presentation = useMemo(() => buildApprovalPresentation(request), [request]);
  const action = presentation.action || t('approvalBanner.unknownAction');
  const description = presentation.description || t('approvalBanner.actionDetailsUnavailable');
  const expiresAt =
    typeof request.expiresAt === 'number' && Number.isFinite(request.expiresAt)
      ? request.expiresAt
      : undefined;
  const riskColor = RISK_COLORS[presentation.riskLevel](colors);
  const allowsPersistentApproval =
    request.decisionPolicy?.persistentApproval === 'allowed' &&
    request.decisionPolicy.expiryFallback === 'global-policy' &&
    request.grantCandidate !== undefined;

  useEffect(() => {
    if (announcedRequestId.current === request.id) return;
    announcedRequestId.current = request.id;
    AccessibilityInfo.announceForAccessibility(t('approvalBanner.announcement', { action }));
  }, [action, request.id, t]);

  useEffect(() => {
    if (!expiresAt) return undefined;
    setNow(Date.now());
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [expiresAt]);

  if (reviewingPermission && allowsPersistentApproval) {
    return (
      <PermissionReview
        request={request}
        colors={colors}
        styles={styles}
        onCancel={() => setReviewingPermission(false)}
        onConfirm={onApproveAlways}
      />
    );
  }

  const expiresIn = expiresAt
    ? formatApprovalCountdown(secondsUntilExpiry(expiresAt, now))
    : undefined;

  return (
    <View style={[styles.card, { borderColor: riskColor }]} testID="approval-decision-card">
      <View style={styles.topRow}>
        <View style={styles.eyebrowRow}>
          <ShieldAlert size={16} color={riskColor} />
          <Text style={[styles.eyebrow, { color: riskColor }]}>
            {t('approvalBanner.needsDecision')}
          </Text>
        </View>
        <Text style={styles.queueText}>
          {t('approvalBanner.queuePosition', { current: 1, total: queueCount })}
        </Text>
      </View>

      <Text style={styles.title} accessibilityRole="header">
        {action}
      </Text>

      <View style={styles.riskRow}>
        <View style={[styles.riskBadge, { borderColor: riskColor }]}>
          <Text style={[styles.riskBadgeText, { color: riskColor }]}>
            {riskLabel(presentation.riskLevel, t)}
          </Text>
        </View>
        <Text style={styles.timeoutText} accessible={false} importantForAccessibility="no">
          {expiresIn
            ? t('approvalBanner.expiresIn', { time: expiresIn })
            : t('approvalBanner.waitingForDecision')}
        </Text>
      </View>

      <View style={styles.detailPanel}>
        <DecisionDetail
          label={t('approvalBanner.whatWillHappen')}
          value={description}
          styles={styles}
        />
        <DecisionDetail
          label={t('approvalBanner.affectedData')}
          value={scopeImpact(presentation.scope, t)}
          styles={styles}
          bordered
        />
        <DecisionDetail
          label={t('approvalBanner.target')}
          value={presentation.target ?? scopeTarget(presentation.scope, t)}
          styles={styles}
          bordered
        />
        <DecisionDetail
          label={t('approvalBanner.reversibility')}
          value={reversibility(presentation.riskLevel, t)}
          styles={styles}
          bordered
        />
        {presentation.reviewReason && (
          <DecisionDetail
            label={t('approvalBanner.whyReview')}
            value={reviewReason(presentation.reviewReason, t)}
            styles={styles}
            bordered
          />
        )}
      </View>

      <View style={styles.safeDefault}>
        <Clock3 size={16} color={colors.warning} />
        <Text style={styles.safeDefaultText}>{t('approvalBanner.safeDefault')}</Text>
      </View>

      <View style={styles.actions}>
        <TouchableOpacity
          style={[styles.actionButton, styles.denyButton]}
          onPress={onReject}
          accessibilityRole="button"
          accessibilityLabel={t('approvalBanner.reject')}
          accessibilityHint={t('approvalBanner.rejectHint')}
        >
          <ShieldX size={17} color={colors.danger} />
          <Text style={styles.denyText}>{t('approvalBanner.reject')}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.actionButton, styles.allowButton]}
          onPress={onApprove}
          accessibilityRole="button"
          accessibilityLabel={t('approvalBanner.approve')}
          accessibilityHint={t('approvalBanner.approveHint')}
        >
          <ShieldCheck size={17} color={colors.onPrimary} />
          <Text style={styles.allowText}>{t('approvalBanner.approve')}</Text>
        </TouchableOpacity>
      </View>

      {allowsPersistentApproval && (
        <View style={styles.permissionDivider}>
          <TouchableOpacity
            style={styles.permissionButton}
            onPress={() => setReviewingPermission(true)}
            accessibilityRole="button"
            accessibilityLabel={t('approvalBanner.reviewPermission')}
            accessibilityHint={t('approvalBanner.persistentHint')}
          >
            <CheckCheck size={17} color={colors.primary} />
            <Text style={styles.permissionButtonText}>{t('approvalBanner.reviewPermission')}</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
};

const PermissionReview: React.FC<{
  request: RemoteApprovalRequest;
  colors: AppPalette;
  styles: ReturnType<typeof createApprovalBannerStyles>;
  onCancel: () => void;
  onConfirm: () => void;
}> = ({ request, colors, styles, onCancel, onConfirm }) => {
  const { t } = useTranslation();
  const presentation = buildApprovalPresentation(request);
  const action = presentation.action || t('approvalBanner.unknownAction');
  const description = presentation.description || t('approvalBanner.actionDetailsUnavailable');

  return (
    <View style={styles.card} testID="approval-permission-review">
      <View style={styles.reviewHeader}>
        <Text style={styles.eyebrow}>{t('approvalBanner.permissionReviewEyebrow')}</Text>
        <Text style={styles.reviewTitle} accessibilityRole="header">
          {t('approvalBanner.permissionReviewTitle')}
        </Text>
        <Text style={styles.reviewDescription}>
          {t('approvalBanner.permissionReviewDescription')}
        </Text>
      </View>

      <View style={styles.detailPanel}>
        <DecisionDetail label={t('approvalBanner.savedAction')} value={action} styles={styles} />
        <DecisionDetail
          label={t('approvalBanner.savedActionDetails')}
          value={description}
          styles={styles}
          bordered
        />
        <DecisionDetail
          label={t('approvalBanner.savedTarget')}
          value={presentation.target ?? scopeTarget(presentation.scope, t)}
          styles={styles}
          bordered
        />
        <DecisionDetail
          label={t('approvalBanner.savedScope')}
          value={scopeImpact(presentation.scope, t)}
          styles={styles}
          bordered
        />
        <DecisionDetail
          label={t('approvalBanner.duration')}
          value={t('approvalBanner.untilRevoked')}
          styles={styles}
          bordered
        />
        <DecisionDetail
          label={t('approvalBanner.boundaries')}
          value={t('approvalBanner.boundariesDescription')}
          styles={styles}
          bordered
        />
      </View>

      <Text style={styles.reviewPath}>{t('approvalBanner.revokePath')}</Text>

      <View style={styles.actions}>
        <TouchableOpacity
          style={[styles.actionButton, styles.cancelButton]}
          onPress={onCancel}
          accessibilityRole="button"
          accessibilityLabel={t('common.cancel')}
        >
          <Text style={styles.cancelText}>{t('common.cancel')}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.actionButton, styles.allowButton]}
          onPress={onConfirm}
          accessibilityRole="button"
          accessibilityLabel={t('approvalBanner.confirmPersistent')}
        >
          <CheckCheck size={17} color={colors.onPrimary} />
          <Text style={styles.allowText}>{t('approvalBanner.confirmPersistent')}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

const DecisionDetail: React.FC<{
  label: string;
  value: string;
  styles: ReturnType<typeof createApprovalBannerStyles>;
  bordered?: boolean;
}> = ({ label, value, styles, bordered = false }) => (
  <View style={[styles.detailRow, bordered && styles.detailRowBorder]}>
    <Text style={styles.detailLabel}>{label}</Text>
    <Text style={styles.detailValue}>{value}</Text>
  </View>
);

type Translate = (key: string, params?: Record<string, string | number>) => string;

function riskLabel(level: ApprovalRiskLevel, t: Translate): string {
  switch (level) {
    case 'medium':
      return t('approvalBanner.risk.medium');
    case 'high':
      return t('approvalBanner.risk.high');
    case 'critical':
      return t('approvalBanner.risk.critical');
    default:
      return t('approvalBanner.risk.low');
  }
}

function scopeImpact(scope: RemoteApprovalScope, t: Translate): string {
  switch (scope) {
    case 'ssh':
      return t('approvalBanner.scope.ssh');
    case 'workspace':
      return t('approvalBanner.scope.workspace');
    case 'browser':
      return t('approvalBanner.scope.browser');
    case 'expo':
      return t('approvalBanner.scope.expo');
    case 'native':
      return t('approvalBanner.scope.native');
    default:
      return t('approvalBanner.scope.other');
  }
}

function scopeTarget(scope: RemoteApprovalScope, t: Translate): string {
  return scope === 'native'
    ? t('approvalBanner.thisDevice')
    : t('approvalBanner.selectedDestination');
}

function reversibility(level: ApprovalRiskLevel, t: Translate): string {
  switch (level) {
    case 'medium':
      return t('approvalBanner.reversibilityLevel.medium');
    case 'high':
      return t('approvalBanner.reversibilityLevel.high');
    case 'critical':
      return t('approvalBanner.reversibilityLevel.critical');
    default:
      return t('approvalBanner.reversibilityLevel.low');
  }
}

function reviewReason(reason: ApprovalReviewReason, t: Translate): string {
  switch (reason) {
    case 'destructive':
      return t('approvalBanner.reviewReason.destructive');
    case 'sensitiveData':
      return t('approvalBanner.reviewReason.sensitiveData');
    case 'systemAccess':
      return t('approvalBanner.reviewReason.systemAccess');
    case 'compoundAction':
      return t('approvalBanner.reviewReason.compoundAction');
    default:
      return t('approvalBanner.reviewReason.unverified');
  }
}
