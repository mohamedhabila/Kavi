import { CheckCircle2, RefreshCw } from 'lucide-react-native';
import React from 'react';
import { ActivityIndicator, ScrollView, Text, TouchableOpacity, View } from 'react-native';

import type { AppPalette } from '../../theme/useAppTheme';
import type { WorkspaceTargetConfig } from '../../types/remote';

type TranslationFn = (key: string, params?: any) => string;
type StyleMap = Record<string, any>;

type ProbeResult = { ok: boolean; message: string } | undefined;
type WorkspaceReadiness = { launchable: boolean } | null | undefined;
type WorkspaceControlStatus = { summary: string } | null | undefined;

type RemoteWorkWorkspaceHubSectionProps = {
  colors: AppPalette;
  styles: StyleMap;
  t: TranslationFn;
  isWide: boolean;
  workspaceTargets: WorkspaceTargetConfig[];
  workspaceReadyCount: number;
  workspaceNeedsSetupCount: number;
  workspaceDisabledCount: number;
  selectedWorkspaceTarget?: WorkspaceTargetConfig;
  selectedWorkspaceReadiness?: WorkspaceReadiness;
  selectedWorkspaceControlStatus?: WorkspaceControlStatus;
  selectedWorkspaceCheckPending: boolean;
  selectedWorkspaceProbe?: ProbeResult;
  workspaceProbeResults: Record<string, ProbeResult>;
  handleCreateWorkspace: () => void;
  setSelectedWorkspaceId: (id: string) => void;
  isWorkspaceControlReady: (target: WorkspaceTargetConfig) => boolean;
  getWorkspaceTargetDisplayName: (target: WorkspaceTargetConfig) => string;
  getLocalizedWorkspaceProviderLabel: (provider?: WorkspaceTargetConfig['provider']) => string;
  getWorkspaceReadinessLabel: (target: WorkspaceTargetConfig) => string;
  getWorkspaceAuthModeLabel: (authMode?: WorkspaceTargetConfig['authMode']) => string;
  getWorkspaceBrowserProviderName: (browserProviderId?: string) => string;
  getWorkspaceAiHandoffSummary: (target: WorkspaceTargetConfig) => string;
  handleOpenWorkspace: (target: WorkspaceTargetConfig) => void | Promise<void>;
  handleProbeWorkspace: (target: WorkspaceTargetConfig) => void | Promise<void>;
  handleEditWorkspaceConfig: (target: WorkspaceTargetConfig) => void;
};

export const RemoteWorkWorkspaceHubSection: React.FC<RemoteWorkWorkspaceHubSectionProps> = ({
  colors,
  styles,
  t,
  isWide,
  workspaceTargets,
  workspaceReadyCount,
  workspaceNeedsSetupCount,
  workspaceDisabledCount,
  selectedWorkspaceTarget,
  selectedWorkspaceReadiness,
  selectedWorkspaceControlStatus,
  selectedWorkspaceCheckPending,
  selectedWorkspaceProbe,
  workspaceProbeResults,
  handleCreateWorkspace,
  setSelectedWorkspaceId,
  isWorkspaceControlReady,
  getWorkspaceTargetDisplayName,
  getLocalizedWorkspaceProviderLabel,
  getWorkspaceReadinessLabel,
  getWorkspaceAuthModeLabel,
  getWorkspaceBrowserProviderName,
  getWorkspaceAiHandoffSummary,
  handleOpenWorkspace,
  handleProbeWorkspace,
  handleEditWorkspaceConfig,
}) => {
  return (
    <>
      <View style={styles.sectionHeader}>
        <View style={styles.sectionHeaderText}>
          <Text style={styles.sectionTitle}>{t('remoteWork.configuredTargets')}</Text>
          <Text style={styles.sectionCaption}>{t('remoteWork.workspaceHubHint')}</Text>
        </View>
        <TouchableOpacity
          style={styles.primaryBtn}
          onPress={handleCreateWorkspace}
          accessibilityRole="button"
          accessibilityLabel={t('settings.addWorkspaceTarget')}
        >
          <Text style={styles.primaryBtnText}>{t('settings.addWorkspaceTarget')}</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.workspaceHubCard}>
        <View style={[styles.workspaceHubTopRow, isWide ? styles.workspaceHubTopRowWide : null]}>
          <View style={styles.workspaceHubCopy}>
            <Text style={styles.infoTitle}>{t('remoteWork.configuredTargets')}</Text>
            <Text style={styles.infoText}>
              {workspaceTargets.length === 0
                ? t('remoteWork.noWorkspaceTargetsHint')
                : t('remoteWork.workspaceHubHint')}
            </Text>
          </View>
          <View style={styles.workspaceHubStats}>
            <View style={styles.workspaceHubStatCard}>
              <Text style={styles.workspaceHubStatValue}>{workspaceReadyCount}</Text>
              <Text style={styles.workspaceHubStatLabel}>
                {t('remoteWork.workspaceReadyCount', { count: workspaceReadyCount })}
              </Text>
            </View>
            <View style={styles.workspaceHubStatCard}>
              <Text style={styles.workspaceHubStatValue}>{workspaceNeedsSetupCount}</Text>
              <Text style={styles.workspaceHubStatLabel}>
                {t('remoteWork.workspaceNeedsSetupCount', { count: workspaceNeedsSetupCount })}
              </Text>
            </View>
            <View style={styles.workspaceHubStatCard}>
              <Text style={styles.workspaceHubStatValue}>{workspaceDisabledCount}</Text>
              <Text style={styles.workspaceHubStatLabel}>
                {t('remoteWork.workspaceDisabledCount', { count: workspaceDisabledCount })}
              </Text>
            </View>
          </View>
        </View>

        {workspaceTargets.length === 0 ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>{t('remoteWork.noWorkspaceTargetsTitle')}</Text>
            <Text style={styles.emptyText}>{t('remoteWork.noWorkspaceTargetsHint')}</Text>
            <TouchableOpacity
              style={styles.primaryBtn}
              onPress={handleCreateWorkspace}
              accessibilityRole="button"
              accessibilityLabel={t('settings.addWorkspaceTarget')}
            >
              <Text style={styles.primaryBtnText}>{t('settings.addWorkspaceTarget')}</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.workspaceSelectorRail}
            >
              {workspaceTargets.map((target) => {
                const controlReady = isWorkspaceControlReady(target);
                const selected = target.id === selectedWorkspaceTarget?.id;
                const probe = workspaceProbeResults[target.id];
                return (
                  <TouchableOpacity
                    key={target.id}
                    style={[
                      styles.workspaceSelectorCard,
                      selected ? styles.workspaceSelectorCardActive : null,
                    ]}
                    onPress={() => setSelectedWorkspaceId(target.id)}
                    accessibilityRole="button"
                    accessibilityLabel={getWorkspaceTargetDisplayName(target)}
                  >
                    <View style={styles.targetHeader}>
                      <View style={styles.targetHeaderText}>
                        <Text style={styles.targetTitle} numberOfLines={1}>
                          {getWorkspaceTargetDisplayName(target)}
                        </Text>
                        <Text style={styles.targetSubtitle} numberOfLines={1}>
                          {getLocalizedWorkspaceProviderLabel(target.provider)}
                        </Text>
                      </View>
                      <View
                        style={[styles.badge, controlReady ? styles.badgeReady : styles.badgeWarn]}
                      >
                        <Text
                          style={[
                            styles.badgeText,
                            controlReady ? styles.badgeTextReady : styles.badgeTextWarn,
                          ]}
                          numberOfLines={1}
                        >
                          {getWorkspaceReadinessLabel(target)}
                        </Text>
                      </View>
                    </View>
                    <Text style={styles.workspaceSelectorPath} numberOfLines={1}>
                      {target.rootPath || t('remoteWork.missingRootPath')}
                    </Text>
                    <Text style={styles.workspaceSelectorPath} numberOfLines={1}>
                      {target.baseUrl?.trim() || t('remoteWork.notConfigured')}
                    </Text>
                    {probe ? (
                      <View style={styles.probeRow}>
                        <CheckCircle2
                          size={14}
                          color={probe.ok ? colors.success || colors.primary : colors.danger}
                        />
                        <Text
                          style={[
                            styles.probeText,
                            {
                              color: probe.ok ? colors.success || colors.primary : colors.danger,
                            },
                          ]}
                          numberOfLines={1}
                        >
                          {probe.message}
                        </Text>
                      </View>
                    ) : null}
                  </TouchableOpacity>
                );
              })}
            </ScrollView>

            {selectedWorkspaceTarget && selectedWorkspaceReadiness ? (
              <View style={styles.workspaceDetailCard}>
                <View style={styles.targetHeader}>
                  <View style={styles.targetHeaderText}>
                    <Text style={styles.targetTitle}>
                      {getWorkspaceTargetDisplayName(selectedWorkspaceTarget)}
                    </Text>
                    <Text style={styles.targetSubtitle}>
                      {getLocalizedWorkspaceProviderLabel(selectedWorkspaceTarget.provider)}
                    </Text>
                  </View>
                  <View
                    style={[
                      styles.badge,
                      isWorkspaceControlReady(selectedWorkspaceTarget)
                        ? styles.badgeReady
                        : styles.badgeWarn,
                    ]}
                  >
                    <Text
                      style={[
                        styles.badgeText,
                        isWorkspaceControlReady(selectedWorkspaceTarget)
                          ? styles.badgeTextReady
                          : styles.badgeTextWarn,
                      ]}
                    >
                      {getWorkspaceReadinessLabel(selectedWorkspaceTarget)}
                    </Text>
                  </View>
                </View>

                <View
                  style={[
                    styles.workspaceDetailGrid,
                    isWide ? styles.workspaceDetailGridWide : null,
                  ]}
                >
                  <View style={styles.workspaceDetailCell}>
                    <Text style={styles.detailLabel}>{t('remoteWork.rootPath')}</Text>
                    <Text style={styles.detailValue}>{selectedWorkspaceTarget.rootPath}</Text>
                  </View>
                  <View style={styles.workspaceDetailCell}>
                    <Text style={styles.detailLabel}>{t('remoteWork.baseUrl')}</Text>
                    <Text style={styles.detailValue}>
                      {selectedWorkspaceTarget.baseUrl?.trim() || t('remoteWork.notConfigured')}
                    </Text>
                  </View>
                  <View style={styles.workspaceDetailCell}>
                    <Text style={styles.detailLabel}>{t('settings.workspaceProvider')}</Text>
                    <Text style={styles.detailValue}>
                      {getLocalizedWorkspaceProviderLabel(selectedWorkspaceTarget.provider)}
                    </Text>
                  </View>
                  <View style={styles.workspaceDetailCell}>
                    <Text style={styles.detailLabel}>{t('settings.workspaceAuthMode')}</Text>
                    <Text style={styles.detailValue}>
                      {getWorkspaceAuthModeLabel(selectedWorkspaceTarget.authMode)}
                    </Text>
                  </View>
                  <View style={styles.workspaceDetailCell}>
                    <Text style={styles.detailLabel}>{t('settings.workspaceConfigRoots')}</Text>
                    <Text style={styles.detailValue}>
                      {t('settings.workspaceConfigRootsCount', {
                        count: selectedWorkspaceTarget.configRoots?.length || 0,
                      })}
                    </Text>
                  </View>
                  <View style={styles.workspaceDetailCell}>
                    <Text style={styles.detailLabel}>
                      {t('remoteWork.workspaceBrowserProvider')}
                    </Text>
                    <Text style={styles.detailValue}>
                      {getWorkspaceBrowserProviderName(selectedWorkspaceTarget.browserProviderId)}
                    </Text>
                  </View>
                  <View style={styles.workspaceDetailCell}>
                    <Text style={styles.detailLabel}>{t('remoteWork.workspaceAiHandoff')}</Text>
                    <Text style={styles.detailValue}>
                      {getWorkspaceAiHandoffSummary(selectedWorkspaceTarget)}
                    </Text>
                  </View>
                  {selectedWorkspaceControlStatus ? (
                    <View style={styles.workspaceDetailCell}>
                      <Text style={styles.detailLabel}>{t('remoteWork.summaryTitle')}</Text>
                      <Text style={styles.detailValue}>
                        {selectedWorkspaceControlStatus.summary}
                      </Text>
                    </View>
                  ) : null}
                </View>

                {selectedWorkspaceCheckPending ? (
                  <View style={styles.probeRow}>
                    <ActivityIndicator size="small" color={colors.primary} />
                    <Text style={styles.probeText}>{t('remoteWork.checkingConnection')}</Text>
                  </View>
                ) : selectedWorkspaceProbe ? (
                  <View style={styles.probeRow}>
                    <CheckCircle2
                      size={14}
                      color={
                        selectedWorkspaceProbe.ok ? colors.success || colors.primary : colors.danger
                      }
                    />
                    <Text
                      style={[
                        styles.probeText,
                        {
                          color: selectedWorkspaceProbe.ok
                            ? colors.success || colors.primary
                            : colors.danger,
                        },
                      ]}
                    >
                      {selectedWorkspaceProbe.message}
                    </Text>
                  </View>
                ) : null}

                <View style={styles.actionRow}>
                  <TouchableOpacity
                    style={[
                      styles.primaryBtn,
                      !selectedWorkspaceReadiness.launchable && styles.disabledBtn,
                    ]}
                    onPress={() => void handleOpenWorkspace(selectedWorkspaceTarget)}
                    disabled={!selectedWorkspaceReadiness.launchable}
                    accessibilityRole="button"
                    accessibilityLabel={t('remoteWork.launchWorkspace')}
                  >
                    <Text style={styles.primaryBtnText}>{t('remoteWork.launchWorkspace')}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.secondaryBtn}
                    onPress={() => void handleProbeWorkspace(selectedWorkspaceTarget)}
                    accessibilityRole="button"
                    accessibilityLabel={t('remoteWork.checkConnection')}
                  >
                    {selectedWorkspaceCheckPending ? (
                      <ActivityIndicator size="small" color={colors.primary} />
                    ) : (
                      <RefreshCw size={16} color={colors.primary} />
                    )}
                    <Text style={styles.secondaryBtnText}>
                      {selectedWorkspaceCheckPending
                        ? t('remoteWork.checkingConnection')
                        : t('remoteWork.checkConnection')}
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.secondaryBtn}
                    onPress={() => handleEditWorkspaceConfig(selectedWorkspaceTarget)}
                    accessibilityRole="button"
                    accessibilityLabel={t('settings.editWorkspaceTarget')}
                  >
                    <Text style={styles.secondaryBtnText}>{t('common.edit')}</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ) : null}
          </>
        )}
      </View>
    </>
  );
};
