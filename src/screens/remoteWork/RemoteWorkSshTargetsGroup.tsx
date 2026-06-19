import { CheckCircle2, Play, RefreshCw } from 'lucide-react-native';
import React from 'react';
import { ActivityIndicator, Text, TouchableOpacity, View } from 'react-native';

import type { AppPalette } from '../../theme/useAppTheme';
import type { SshTargetConfig } from '../../types/remote';

type TranslationFn = (key: string, params?: any) => string;
type StyleMap = Record<string, any>;

type RemoteWorkSshTargetsGroupProps = {
  colors: AppPalette;
  styles: StyleMap;
  t: TranslationFn;
  sshTargets: SshTargetConfig[];
  sshSessions: any[];
  sshProbeResults: Record<string, any>;
  pendingSshChecks: Record<string, boolean | undefined>;
  activeSshSessionId?: string | null;
  openingShellTargetId?: string | null;
  getSshTargetReadiness: (target: SshTargetConfig) => { launchable: boolean };
  getSshTargetLabel: (target: SshTargetConfig) => string;
  getSshReadinessLabel: (target: SshTargetConfig) => string;
  getSshTargetAuthModeLabel: (target: SshTargetConfig) => string;
  getSshHostKeyPolicyLabel: (target: SshTargetConfig) => string;
  handleCreateSsh: () => void;
  handleOpenShell: (target: SshTargetConfig) => void | Promise<void>;
  handleProbeSsh: (target: SshTargetConfig) => void | Promise<void>;
  handleEditSshConfig: (target: SshTargetConfig) => void;
};

export const RemoteWorkSshTargetsGroup: React.FC<RemoteWorkSshTargetsGroupProps> = ({
  colors,
  styles,
  t,
  sshTargets,
  sshSessions,
  sshProbeResults,
  pendingSshChecks,
  activeSshSessionId,
  openingShellTargetId,
  getSshTargetReadiness,
  getSshTargetLabel,
  getSshReadinessLabel,
  getSshTargetAuthModeLabel,
  getSshHostKeyPolicyLabel,
  handleCreateSsh,
  handleOpenShell,
  handleProbeSsh,
  handleEditSshConfig,
}) => (
  <>
    <View style={styles.sectionHeader}>
      <Text style={styles.sectionTitle}>{t('remoteWork.sshTargetsTitle')}</Text>
      <Text style={styles.sectionCaption}>
        {t('remoteWork.activeSshSessions', {
          count: sshSessions.filter((session) => session.status === 'connected').length,
        })}
      </Text>
    </View>

    {sshTargets.length === 0 ? (
      <View style={styles.emptyCard}>
        <Text style={styles.emptyTitle}>{t('remoteWork.noSshTargetsTitle')}</Text>
        <Text style={styles.emptyText}>{t('remoteWork.noSshTargetsHint')}</Text>
        <TouchableOpacity
          style={styles.primaryBtn}
          onPress={handleCreateSsh}
          accessibilityRole="button"
          accessibilityLabel={t('settings.addSshTarget')}
        >
          <Text style={styles.primaryBtnText}>{t('settings.addSshTarget')}</Text>
        </TouchableOpacity>
      </View>
    ) : null}

    {sshTargets.map((target) => {
      const readiness = getSshTargetReadiness(target);
      const probe = sshProbeResults[target.id];
      const pending = Boolean(pendingSshChecks[target.id]);
      const existingSession = sshSessions.find(
        (session) => session.targetId === target.id && session.status !== 'closed',
      );
      const opening = openingShellTargetId === target.id || activeSshSessionId === target.id;
      return (
        <View key={target.id} style={styles.targetCard}>
          <View style={styles.targetHeader}>
            <View style={styles.targetHeaderText}>
              <Text style={styles.targetTitle}>{target.name}</Text>
              <Text style={styles.targetSubtitle}>{getSshTargetLabel(target)}</Text>
            </View>
            <View
              style={[styles.badge, readiness.launchable ? styles.badgeReady : styles.badgeWarn]}
            >
              <Text
                style={[
                  styles.badgeText,
                  readiness.launchable ? styles.badgeTextReady : styles.badgeTextWarn,
                ]}
              >
                {getSshReadinessLabel(target)}
              </Text>
            </View>
          </View>

          <Text style={styles.detailLabel}>{t('remoteWork.sshAuthMode')}</Text>
          <Text style={styles.detailValue}>
            {getSshTargetAuthModeLabel(target)} · {getSshHostKeyPolicyLabel(target)}
          </Text>

          {target.trustedHostFingerprint ? (
            <>
              <Text style={styles.detailLabel}>{t('remoteWork.sshTrustedFingerprint')}</Text>
              <Text style={styles.detailValue}>{target.trustedHostFingerprint}</Text>
            </>
          ) : null}

          {target.remoteRoot ? (
            <>
              <Text style={styles.detailLabel}>{t('remoteWork.rootPath')}</Text>
              <Text style={styles.detailValue}>{target.remoteRoot}</Text>
            </>
          ) : null}

          {probe ? (
            <View style={styles.probeRow}>
              <CheckCircle2
                size={14}
                color={probe.ok ? colors.success || colors.primary : colors.danger}
              />
              <Text
                style={[
                  styles.probeText,
                  { color: probe.ok ? colors.success || colors.primary : colors.danger },
                ]}
              >
                {probe.message}
              </Text>
            </View>
          ) : null}

          {existingSession ? (
            <Text style={styles.sessionHint}>{t('remoteWork.resumeShellHint')}</Text>
          ) : null}

          <View style={styles.actionRow}>
            <TouchableOpacity
              style={[styles.primaryBtn, !readiness.launchable && styles.disabledBtn]}
              onPress={() => void handleOpenShell(target)}
              disabled={!readiness.launchable || opening}
              accessibilityRole="button"
              accessibilityLabel={
                existingSession ? t('remoteWork.resumeShell') : t('remoteWork.openShell')
              }
            >
              {opening ? (
                <ActivityIndicator size="small" color={colors.onPrimary} />
              ) : (
                <Play size={14} color={colors.onPrimary} />
              )}
              <Text style={styles.primaryBtnText}>
                {existingSession ? t('remoteWork.resumeShell') : t('remoteWork.openShell')}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.secondaryBtn}
              onPress={() => void handleProbeSsh(target)}
              accessibilityRole="button"
              accessibilityLabel={t('remoteWork.checkConnection')}
            >
              {pending ? (
                <ActivityIndicator size="small" color={colors.primary} />
              ) : (
                <RefreshCw size={16} color={colors.primary} />
              )}
              <Text style={styles.secondaryBtnText}>
                {pending ? t('remoteWork.checkingConnection') : t('remoteWork.checkConnection')}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.secondaryBtn}
              onPress={() => handleEditSshConfig(target)}
              accessibilityRole="button"
              accessibilityLabel={t('settings.editSshTarget')}
            >
              <Text style={styles.secondaryBtnText}>{t('common.edit')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      );
    })}
  </>
);
