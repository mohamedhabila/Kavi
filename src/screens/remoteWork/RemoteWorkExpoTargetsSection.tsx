import { CheckCircle2, Globe, Play, RefreshCw } from 'lucide-react-native';
import React from 'react';
import { ActivityIndicator, Text, TouchableOpacity, View } from 'react-native';

import { buildExpoProjectSurfaces } from '../../features/expo/projectSurfaces';
import type { AppPalette } from '../../theme/useAppTheme';
import type { ExpoAccountConfig, ExpoProjectConfig, SshTargetConfig } from '../../types/remote';

type TranslationFn = (key: string, params?: any) => string;
type StyleMap = Record<string, any>;
type PendingMap = Record<string, boolean | undefined>;
type ProbeResult = { ok: boolean; message: string } | undefined;

type RemoteWorkExpoTargetsSectionProps = {
  colors: AppPalette;
  styles: StyleMap;
  t: TranslationFn;
  expoProjects: ExpoProjectConfig[];
  expoAccounts: ExpoAccountConfig[];
  sshTargets: SshTargetConfig[];
  expoProbeResults: Record<string, ProbeResult>;
  pendingExpoChecks: PendingMap;
  pendingExpoActions: PendingMap;
  handleCreateExpo: () => void;
  handleSyncExpoAccount: (accountId?: string) => void | Promise<void>;
  handleRunExpoAction: (
    project: ExpoProjectConfig,
    action: 'build' | 'update' | 'submit' | 'deploy-web',
    options?: { platform?: 'android' | 'ios' },
  ) => void | Promise<void>;
  handleProbeExpo: (project: ExpoProjectConfig) => void | Promise<void>;
  handleEditExpoProject: (project: ExpoProjectConfig) => void;
};

export const RemoteWorkExpoTargetsSection: React.FC<RemoteWorkExpoTargetsSectionProps> = ({
  colors,
  styles,
  t,
  expoProjects,
  expoAccounts,
  sshTargets,
  expoProbeResults,
  pendingExpoChecks,
  pendingExpoActions,
  handleCreateExpo,
  handleSyncExpoAccount,
  handleRunExpoAction,
  handleProbeExpo,
  handleEditExpoProject,
}) => {
  const projectSurfaces = buildExpoProjectSurfaces(expoProjects, expoAccounts, { sshTargets }, t);
  const readyCount = projectSurfaces.filter(
    (surface) => surface.readiness.reason === 'ready',
  ).length;
  const enabledCount =
    projectSurfaces.filter((surface) => surface.readiness.reason !== 'disabled').length ||
    projectSurfaces.length ||
    0;

  return (
    <>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>{t('remoteWork.expoTargetsTitle')}</Text>
        <Text style={styles.sectionCaption}>{`${readyCount}/${enabledCount}`}</Text>
      </View>

      {expoProjects.length === 0 ? (
        <View style={styles.emptyCard}>
          <Text style={styles.emptyTitle}>
            {expoAccounts.length > 0 ? t('settings.noExpoProjects') : t('settings.noExpoAccounts')}
          </Text>
          <Text style={styles.emptyText}>
            {expoAccounts.length > 0
              ? t('remoteWork.expoEmptyHintWithAccounts')
              : t('remoteWork.expoEmptyHintNoAccounts')}
          </Text>
          <TouchableOpacity
            style={styles.primaryBtn}
            onPress={() =>
              expoAccounts.length > 0 ? void handleSyncExpoAccount() : handleCreateExpo()
            }
            accessibilityRole="button"
            accessibilityLabel={
              expoAccounts.length > 0
                ? t('remoteWork.syncExpoProjects')
                : t('remoteWork.linkExpoAccount')
            }
          >
            <Text style={styles.primaryBtnText}>
              {expoAccounts.length > 0
                ? t('remoteWork.syncExpoProjects')
                : t('remoteWork.linkExpoAccount')}
            </Text>
          </TouchableOpacity>
        </View>
      ) : null}

      {projectSurfaces.map((surface) => {
        const probe = expoProbeResults[surface.id];
        const probing = Boolean(pendingExpoChecks[surface.id]);
        const buildPending = Boolean(pendingExpoActions[`${surface.id}:build`]);
        const updatePending = Boolean(pendingExpoActions[`${surface.id}:update`]);
        const submitPending = Boolean(pendingExpoActions[`${surface.id}:submit`]);
        const deployPending = Boolean(pendingExpoActions[`${surface.id}:deploy-web`]);
        const supportsAndroid = surface.platforms.includes('android');
        const supportsIos = surface.platforms.includes('ios');
        const supportsWeb = surface.platforms.includes('web');

        return (
          <View key={surface.id} style={styles.targetCard}>
            <View style={styles.targetHeader}>
              <View style={styles.targetHeaderText}>
                <Text style={styles.targetTitle}>{surface.name}</Text>
                <Text style={styles.targetSubtitle}>{surface.ownerSlugLabel}</Text>
              </View>
              <View
                style={[
                  styles.badge,
                  surface.badgeTone === 'ready' ? styles.badgeReady : styles.badgeWarn,
                ]}
              >
                <Text
                  style={[
                    styles.badgeText,
                    surface.badgeTone === 'ready' ? styles.badgeTextReady : styles.badgeTextWarn,
                  ]}
                >
                  {surface.readinessLabel}
                </Text>
              </View>
            </View>

            <Text style={styles.detailLabel}>{t('settings.expoExecutionMode')}</Text>
            <Text style={styles.detailValue}>{surface.modeLabel}</Text>

            <Text style={styles.detailLabel}>{t('settings.expoTargetPlatforms')}</Text>
            <Text style={styles.detailValue}>{surface.platformText}</Text>

            {surface.webUrl ? (
              <>
                <Text style={styles.detailLabel}>{t('settings.expoProductionWebUrl')}</Text>
                <Text style={styles.detailValue}>{surface.webUrl}</Text>
              </>
            ) : null}

            {surface.previewUrl ? (
              <>
                <Text style={styles.detailLabel}>{t('settings.expoPreviewUrl')}</Text>
                <Text style={styles.detailValue}>{surface.previewUrl}</Text>
              </>
            ) : null}

            {surface.customDomain ? (
              <>
                <Text style={styles.detailLabel}>{t('settings.expoCustomDomain')}</Text>
                <Text style={styles.detailValue}>{surface.customDomain}</Text>
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

            <View style={styles.actionRow}>
              <TouchableOpacity
                style={[styles.primaryBtn, !surface.readiness.launchable && styles.disabledBtn]}
                onPress={() =>
                  void handleRunExpoAction(surface.project, 'build', { platform: 'android' })
                }
                disabled={!surface.readiness.launchable || buildPending || !supportsAndroid}
                accessibilityRole="button"
                accessibilityLabel={t('remoteWork.expoBuildAndroid')}
              >
                {buildPending ? (
                  <ActivityIndicator size="small" color={colors.onPrimary} />
                ) : (
                  <Play size={14} color={colors.onPrimary} />
                )}
                <Text style={styles.primaryBtnText}>{t('remoteWork.expoBuildAndroid')}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.secondaryBtn,
                  (!surface.readiness.launchable || !supportsIos) && styles.disabledBtn,
                ]}
                onPress={() =>
                  void handleRunExpoAction(surface.project, 'build', { platform: 'ios' })
                }
                disabled={!surface.readiness.launchable || buildPending || !supportsIos}
                accessibilityRole="button"
                accessibilityLabel={t('remoteWork.expoBuildIos')}
              >
                {buildPending ? (
                  <ActivityIndicator size="small" color={colors.primary} />
                ) : (
                  <Play size={16} color={colors.primary} />
                )}
                <Text style={styles.secondaryBtnText}>{t('remoteWork.expoBuildIos')}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.secondaryBtn}
                onPress={() => void handleProbeExpo(surface.project)}
                accessibilityRole="button"
                accessibilityLabel={t('remoteWork.expoCheckSetup')}
              >
                {probing ? (
                  <ActivityIndicator size="small" color={colors.primary} />
                ) : (
                  <RefreshCw size={16} color={colors.primary} />
                )}
                <Text style={styles.secondaryBtnText}>
                  {probing ? t('remoteWork.checkingConnection') : t('remoteWork.expoCheckSetup')}
                </Text>
              </TouchableOpacity>
            </View>

            <View style={styles.actionRow}>
              <TouchableOpacity
                style={[styles.secondaryBtn, !surface.readiness.launchable && styles.disabledBtn]}
                onPress={() => void handleRunExpoAction(surface.project, 'update')}
                disabled={!surface.readiness.launchable || updatePending}
                accessibilityRole="button"
                accessibilityLabel={t('remoteWork.expoPublishUpdate')}
              >
                {updatePending ? (
                  <ActivityIndicator size="small" color={colors.primary} />
                ) : (
                  <Globe size={16} color={colors.primary} />
                )}
                <Text style={styles.secondaryBtnText}>{t('remoteWork.expoPublishUpdate')}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.secondaryBtn,
                  (!surface.readiness.launchable || !supportsIos) && styles.disabledBtn,
                ]}
                onPress={() =>
                  void handleRunExpoAction(surface.project, 'submit', { platform: 'ios' })
                }
                disabled={!surface.readiness.launchable || submitPending || !supportsIos}
                accessibilityRole="button"
                accessibilityLabel={t('remoteWork.expoSubmitIos')}
              >
                {submitPending ? (
                  <ActivityIndicator size="small" color={colors.primary} />
                ) : (
                  <Play size={16} color={colors.primary} />
                )}
                <Text style={styles.secondaryBtnText}>{t('remoteWork.expoSubmitIos')}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.secondaryBtn,
                  (!surface.readiness.launchable || !supportsWeb) && styles.disabledBtn,
                ]}
                onPress={() => void handleRunExpoAction(surface.project, 'deploy-web')}
                disabled={!surface.readiness.launchable || deployPending || !supportsWeb}
                accessibilityRole="button"
                accessibilityLabel={t('remoteWork.expoDeployWeb')}
              >
                {deployPending ? (
                  <ActivityIndicator size="small" color={colors.primary} />
                ) : (
                  <Globe size={16} color={colors.primary} />
                )}
                <Text style={styles.secondaryBtnText}>{t('remoteWork.expoDeployWeb')}</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.actionRow}>
              <TouchableOpacity
                style={styles.secondaryBtn}
                onPress={() => handleEditExpoProject(surface.project)}
                accessibilityRole="button"
                accessibilityLabel={t('settings.editExpoProject')}
              >
                <Text style={styles.secondaryBtnText}>{t('common.edit')}</Text>
              </TouchableOpacity>
            </View>
          </View>
        );
      })}
    </>
  );
};
