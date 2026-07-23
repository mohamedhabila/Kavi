import { ShieldCheck, ShieldQuestion, Trash2 } from 'lucide-react-native';
import React, { useMemo } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { useTranslation } from '../../i18n/useTranslation';
import type { AllowlistEntry } from '../../services/remote/approvalGrants';
import { useAppTheme, type AppPalette } from '../../theme/useAppTheme';

type ApprovalPermissionsSectionProps = {
  entries: readonly AllowlistEntry[];
  onRevoke: (key: string) => void;
};

function targetDescription(entry: AllowlistEntry, t: (key: string, params?: any) => string) {
  if (entry.targetId) {
    return t('approvalHistory.permissions.targetLabel', { target: entry.targetId });
  }
  switch (entry.targetKind) {
    case 'local-device':
      return t('approvalHistory.permissions.localDevice');
    case 'mcp-tool':
      return t('approvalHistory.permissions.exactMcpTool');
    default:
      return t('approvalHistory.permissions.exactTool');
  }
}

export const ApprovalPermissionsSection: React.FC<ApprovalPermissionsSectionProps> = ({
  entries,
  onRevoke,
}) => {
  const { colors } = useAppTheme();
  const { t } = useTranslation();
  const styles = useMemo(() => createStyles(colors), [colors]);

  return (
    <View style={styles.section}>
      <Text style={styles.title}>{t('approvalHistory.permissions.title')}</Text>
      <Text style={styles.description}>{t('approvalHistory.permissions.description')}</Text>

      {entries.length === 0 ? (
        <View style={styles.emptyCard}>
          <ShieldCheck size={18} color={colors.textTertiary} />
          <Text style={styles.emptyText}>{t('approvalHistory.permissions.empty')}</Text>
        </View>
      ) : (
        entries.map((entry) => {
          const needsReview = entry.status === 'review-required';
          const statusColor = needsReview ? colors.warning : colors.success;
          const revokeLabel = t('approvalHistory.permissions.revokeLabel', {
            tool: entry.toolName,
          });

          return (
            <View
              key={`${entry.key}:${entry.personaId || 'all'}`}
              style={[styles.card, needsReview && { borderColor: colors.warning }]}
            >
              <View style={styles.cardHeader}>
                {needsReview ? (
                  <ShieldQuestion size={18} color={statusColor} />
                ) : (
                  <ShieldCheck size={18} color={statusColor} />
                )}
                <Text style={styles.toolName} numberOfLines={1}>
                  {entry.toolName}
                </Text>
                <View style={[styles.statusBadge, { borderColor: statusColor }]}>
                  <Text style={[styles.statusText, { color: statusColor }]}>
                    {needsReview
                      ? t('approvalHistory.permissions.reviewRequired')
                      : t('approvalHistory.permissions.active')}
                  </Text>
                </View>
              </View>

              {needsReview ? (
                <Text style={styles.detail}>
                  {t('approvalHistory.permissions.legacyDescription', {
                    permission: entry.legacyKey || entry.toolName,
                  })}
                </Text>
              ) : (
                <>
                  {entry.actionClass !== entry.toolName && (
                    <Text style={styles.detail}>
                      {t('approvalHistory.permissions.actionLabel', {
                        action: entry.actionClass,
                      })}
                    </Text>
                  )}
                  <Text style={styles.detail}>{targetDescription(entry, t)}</Text>
                  {entry.personaId && (
                    <Text style={styles.detail}>
                      {t('approvalHistory.permissions.personaLabel', {
                        persona: entry.personaId,
                      })}
                    </Text>
                  )}
                </>
              )}

              <TouchableOpacity
                style={styles.revokeButton}
                onPress={() => onRevoke(entry.key)}
                accessibilityRole="button"
                accessibilityLabel={revokeLabel}
              >
                <Trash2 size={16} color={colors.danger} />
                <Text style={styles.revokeText}>{t('approvalHistory.permissions.revoke')}</Text>
              </TouchableOpacity>
            </View>
          );
        })
      )}
    </View>
  );
};

const createStyles = (colors: AppPalette) =>
  StyleSheet.create({
    section: { gap: 8, marginBottom: 8 },
    title: { fontSize: 15, fontWeight: '700', color: colors.text },
    description: { fontSize: 12, lineHeight: 17, color: colors.textSecondary },
    emptyCard: {
      minHeight: 48,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      paddingHorizontal: 12,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
    },
    emptyText: { flex: 1, fontSize: 12, color: colors.textSecondary },
    card: {
      gap: 6,
      padding: 12,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
    },
    cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    toolName: { flex: 1, fontSize: 13, fontWeight: '700', color: colors.text },
    statusBadge: {
      borderRadius: 999,
      borderWidth: 1,
      paddingHorizontal: 8,
      paddingVertical: 3,
    },
    statusText: { fontSize: 10, fontWeight: '700' },
    detail: { fontSize: 12, lineHeight: 17, color: colors.textSecondary },
    revokeButton: {
      minHeight: 48,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      marginTop: 2,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: colors.danger,
    },
    revokeText: { fontSize: 13, fontWeight: '700', color: colors.danger },
  });
