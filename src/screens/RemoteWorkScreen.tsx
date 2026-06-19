import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, Text, TouchableOpacity, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { useShallow } from 'zustand/react/shallow';
import { ArrowLeft, ShieldCheck } from 'lucide-react-native';
import { useSettingsStore } from '../store/useSettingsStore';
import { RemoteWorkExpoWorkflowPromptModal } from './remoteWork/RemoteWorkExpoWorkflowPromptModal';
import { RemoteWorkWorkspaceHubSection } from './remoteWork/RemoteWorkWorkspaceHubSection';
import { RemoteWorkInfrastructureTargetsSection } from './remoteWork/RemoteWorkInfrastructureTargetsSection';
import { RemoteWorkExpoTargetsSection } from './remoteWork/RemoteWorkExpoTargetsSection';
import { RemoteWorkSessionsSection } from './remoteWork/RemoteWorkSessionsSection';
import { RemoteWorkJobsSection } from './remoteWork/RemoteWorkJobsSection';
import { RemoteWorkConfigModals } from './remoteWork/RemoteWorkConfigModals';
import { RemoteWorkWorkspaceSessionModal } from './remoteWork/RemoteWorkWorkspaceSessionModal';
import { RemoteWorkSshSessionModal } from './remoteWork/RemoteWorkSshSessionModal';
import { RemoteWorkBrowserSessionModal } from './remoteWork/RemoteWorkBrowserSessionModal';
import { useAppTheme } from '../theme/useAppTheme';
import { useTranslation } from '../i18n/useTranslation';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { selectRemoteConfigSettingsSlice } from '../features/remoteConfig/hooks/useRemoteConfigStore';
import { getBrowserProviderLabel } from '../services/browser/providers/labels';
import { getBrowserProviderReadiness } from '../services/browser/providers/readiness';
import { getWorkspaceTargetDisplayName } from '../services/workspaces/config';
import {
  getSshHostKeyPolicyLabel,
  getSshTargetAuthModeLabel,
  getSshTargetLabel,
  getSshTargetReadiness,
} from '../services/ssh/connector';
import { selectSshSessionRuntimeSlice } from '../services/ssh/sessionSelectors';
import { useSshSessionStore } from '../services/ssh/sessionStore';
import { mcpManager, type McpServerStatus } from '../services/mcp/manager';
import { selectRemoteRuntimeSlice } from '../services/remote/storeSelectors';
import { useRemoteStore } from '../services/remote/store';
import type {
  BrowserProviderConfig,
  ExpoProjectConfig,
  RemoteJobRecord,
  RemoteSessionRecord,
  SshTargetConfig,
  WorkspaceTargetConfig,
} from '../types/remote';
import { useBackToChat } from '../navigation/useBackToChat';
import { useRemoteWorkConfigStudioFlow } from './remoteWork/useRemoteWorkConfigStudioFlow';
import { useRemoteWorkDerivedState } from './remoteWork/useRemoteWorkDerivedState';
import { useRemoteWorkSummaryCards } from './remoteWork/useRemoteWorkSummaryCards';
import { useRemoteWorkRuntimeActions } from './remoteWork/useRemoteWorkRuntimeActions';
import { useRemoteWorkSshSessionFlow } from './remoteWork/useRemoteWorkSshSessionFlow';
import { createRemoteWorkScreenStyles } from './remoteWork/remoteWorkScreenStyles';

// Lazy-load WebView to prevent crash when the native module is missing
let WebView: any = null;
try {
  WebView = require('react-native-webview').WebView;
} catch {
  // WebView unavailable — will fall back to placeholder
}

const EMPTY_WORKSPACE_TARGETS: WorkspaceTargetConfig[] = [];
const EMPTY_SSH_TARGETS: SshTargetConfig[] = [];
const EMPTY_BROWSER_PROVIDERS: BrowserProviderConfig[] = [];
const EMPTY_MCP_SERVERS: NonNullable<ReturnType<typeof useSettingsStore.getState>['mcpServers']> =
  [];
const EMPTY_EXPO_PROJECTS: ExpoProjectConfig[] = [];
const EMPTY_EXPO_ACCOUNTS: NonNullable<
  ReturnType<typeof useSettingsStore.getState>['expoAccounts']
> = [];
const EMPTY_REMOTE_JOBS_BY_ID: Record<string, RemoteJobRecord> = {};
const EMPTY_REMOTE_SESSIONS_BY_ID: Record<string, RemoteSessionRecord> = {};
const EMPTY_SSH_SESSIONS_BY_ID: Record<
  string,
  ReturnType<typeof useSshSessionStore.getState>['sessions'][string]
> = {};

const RemoteWorkScreenInner: React.FC = () => {
  const navigation = useNavigation();
  const handleBack = useBackToChat();
  const { colors } = useAppTheme();
  const { t } = useTranslation();
  const { width } = useWindowDimensions();
  const isTablet = width >= 900;
  const isWide = width >= 680;
  const summaryColumns = width >= 1040 ? 4 : width >= 760 ? 3 : 2;
  const styles = useMemo(() => createRemoteWorkScreenStyles(colors), [colors]);

  const settingsSlice = useSettingsStore(useShallow(selectRemoteConfigSettingsSlice));
  const sshStoreSlice = useSshSessionStore(useShallow(selectSshSessionRuntimeSlice));
  const remoteStoreSlice = useRemoteStore(useShallow(selectRemoteRuntimeSlice));

  const workspaceTargets = settingsSlice.workspaceTargets ?? EMPTY_WORKSPACE_TARGETS;
  const sshTargets = settingsSlice.sshTargets ?? EMPTY_SSH_TARGETS;
  const browserProviders = settingsSlice.browserProviders ?? EMPTY_BROWSER_PROVIDERS;
  const mcpServers = settingsSlice.mcpServers ?? EMPTY_MCP_SERVERS;
  const expoAccounts = settingsSlice.expoAccounts ?? EMPTY_EXPO_ACCOUNTS;
  const expoProjects = settingsSlice.expoProjects ?? EMPTY_EXPO_PROJECTS;
  const sshSessionMap = sshStoreSlice.sessions ?? EMPTY_SSH_SESSIONS_BY_ID;
  const openShellSession = sshStoreSlice.openShellSession;
  const writeShellInput = sshStoreSlice.writeShellInput;
  const closeShellSession = sshStoreSlice.closeShellSession;
  const remoteJobsById = remoteStoreSlice.jobs ?? EMPTY_REMOTE_JOBS_BY_ID;
  const remoteSessionsById = remoteStoreSlice.sessions ?? EMPTY_REMOTE_SESSIONS_BY_ID;

  const sshSessions = useMemo(() => Object.values(sshSessionMap), [sshSessionMap]);
  const remoteJobs = useMemo(() => Object.values(remoteJobsById), [remoteJobsById]);
  const remoteSessions = useMemo(() => Object.values(remoteSessionsById), [remoteSessionsById]);
  const [mcpStatuses, setMcpStatuses] = useState<McpServerStatus[]>(() =>
    mcpManager.getAllStatuses(),
  );
  const {
    activeWorkspaceSession,
    setActiveWorkspaceSession,
    activeBrowserSession,
    setActiveBrowserSession,
    workspaceProbeResults,
    sshProbeResults,
    browserProbeResults,
    expoProbeResults,
    pendingWorkspaceChecks,
    pendingSshChecks,
    pendingBrowserChecks,
    pendingExpoChecks,
    pendingBrowserLaunches,
    pendingExpoActions,
    expoWorkflowPrompt,
    setExpoWorkflowPrompt,
    workspaceSessionError,
    setWorkspaceSessionError,
    clearWorkspaceProbeResult,
    getExpoActionLabel,
    handleOpenWorkspace,
    handleProbeWorkspace,
    handleProbeSsh,
    handleProbeBrowser,
    handleLaunchBrowser,
    handleProbeExpo,
    handleRunExpoAction,
    handleConfirmExpoWorkflowPrompt,
    handleStopBrowser,
  } = useRemoteWorkRuntimeActions({
    t,
    expoAccounts,
    expoProjects,
  });
  const {
    activeConfigSurface,
    setActiveConfigSurface,
    selectedWorkspaceId,
    setSelectedWorkspaceId,
    getLocalizedWorkspaceProviderLabel,
    getWorkspaceAuthModeLabel,
    handleEditWorkspaceConfig,
    handleEditSshConfig,
    handleEditBrowserConfig,
    handleEditExpoProject,
    handleSyncExpoAccount,
    handleEditMcpConfig,
    handleCreateWorkspace,
    handleCreateSsh,
    handleCreateBrowser,
    handleCreateExpo,
    handleCreateMcp,
    modalGroups,
  } = useRemoteWorkConfigStudioFlow({
    settings: settingsSlice,
    t,
    clearWorkspaceProbeResult,
  });
  const scrollRef = useRef<ScrollView>(null);
  const {
    activeSshSession,
    activeSshSessionId,
    openingShellTargetId,
    sshTerminalRef,
    handleOpenShell,
    handleSshTerminalReady,
    handleSshTerminalInput,
    handleTerminalLink,
    handleCloseSshModal,
  } = useRemoteWorkSshSessionFlow({
    t,
    sshSessions,
    openShellSession,
    writeShellInput,
  });

  useEffect(() => {
    setMcpStatuses(mcpManager.getAllStatuses());
    return mcpManager.subscribe(() => {
      setMcpStatuses(mcpManager.getAllStatuses());
    });
  }, []);
  const {
    commandCenter,
    mcpTargets,
    trackedRemoteSessions,
    trackedRemoteJobs,
    isWorkspaceControlReady,
    workspaceReadyCount,
    workspaceNeedsSetupCount,
    workspaceDisabledCount,
    selectedWorkspaceTarget,
    selectedWorkspaceReadiness,
    selectedWorkspaceControlStatus,
    selectedWorkspaceProbe,
    selectedWorkspaceCheckPending,
    getWorkspaceReadinessLabel,
    getWorkspaceBrowserProviderName,
    getWorkspaceAiHandoffSummary,
    getSshReadinessLabel,
    getBrowserReadinessLabel,
  } = useRemoteWorkDerivedState({
    t,
    width,
    summaryColumns,
    workspaceTargets,
    sshTargets,
    browserProviders,
    mcpServers,
    expoAccounts,
    expoProjects,
    mcpStatuses,
    sshSessions,
    remoteSessions,
    remoteJobs,
    selectedWorkspaceId,
    workspaceProbeResults,
    pendingWorkspaceChecks,
  });

  const { summaryCards, activeConfigSurfaceCard } = useRemoteWorkSummaryCards({
    activeConfigSurface,
    t,
    commandCenter,
    workspaceCount: workspaceTargets.length,
    sshCount: sshTargets.length,
    mcpCount: mcpServers.length,
    browserCount: browserProviders.length,
    expoProjectCount: expoProjects.length,
    expoAccountCount: expoAccounts.length,
    handleCreateWorkspace,
    handleCreateSsh,
    handleCreateBrowser,
    handleCreateExpo,
    handleCreateMcp,
  });

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
        <Text style={styles.headerTitle}>{t('remoteWork.title')}</Text>
        <TouchableOpacity
          onPress={() => navigation.navigate('Settings' as never)}
          accessibilityRole="button"
          accessibilityLabel={t('remoteWork.openSettings')}
        >
          <ShieldCheck size={22} color={colors.primary} />
        </TouchableOpacity>
      </View>

      <ScrollView
        ref={scrollRef}
        style={styles.content}
        contentContainerStyle={styles.contentInner}
      >
        <View style={[styles.infoCard, styles.heroCard, isTablet ? styles.heroCardWide : null]}>
          <View style={styles.heroCopy}>
            <Text style={styles.infoTitle}>{t('remoteWork.summaryTitle')}</Text>
            <Text style={styles.infoText}>{t('remoteWork.summaryHint')}</Text>
          </View>
          <View style={styles.heroStats}>
            <View style={styles.heroStatPill}>
              <Text style={styles.heroStatValue}>
                {commandCenter.readyCounts.workspace +
                  commandCenter.readyCounts.ssh +
                  commandCenter.readyCounts.browser}
              </Text>
              <Text style={styles.heroStatLabel}>{t('remoteWork.launchableSurfacesStat')}</Text>
            </View>
            <View style={styles.heroStatPillMuted}>
              <Text style={styles.heroStatValueMuted}>
                {trackedRemoteSessions.filter((session) => session.status !== 'closed').length}
              </Text>
              <Text style={styles.heroStatLabel}>{t('remoteWork.liveSessionsStat')}</Text>
            </View>
          </View>
        </View>

        <View style={styles.summaryGrid}>
          {summaryCards.map((card) => {
            const Icon = card.icon;
            const selected = activeConfigSurface === card.key;

            return (
              <TouchableOpacity
                key={card.key}
                style={styles.surfaceOverviewCard}
                onPress={() => setActiveConfigSurface(card.key as typeof activeConfigSurface)}
                accessibilityRole="button"
                accessibilityLabel={card.title}
              >
                <View style={styles.surfaceOverviewCopy}>
                  <Text style={styles.targetTitle}>{card.title}</Text>
                  <Text style={styles.targetSubtitle}>{card.value}</Text>
                </View>
                <View style={styles.surfaceOverviewStatPill}>
                  <Icon size={16} color={colors.primary} />
                  <Text style={styles.surfaceOverviewLabel}>
                    {selected ? t('remoteWork.editSettings') : t('remoteWork.openSettings')}
                  </Text>
                </View>
              </TouchableOpacity>
            );
          })}
        </View>

        <View style={styles.infoCard}>
          <View style={styles.surfaceOverviewCopy}>
            <Text style={styles.targetTitle}>{activeConfigSurfaceCard.title}</Text>
            <Text style={styles.targetSubtitle}>{activeConfigSurfaceCard.hint}</Text>
          </View>
          <View style={styles.surfaceOverviewStatPill}>
            <Text style={styles.surfaceOverviewValue}>{activeConfigSurfaceCard.value}</Text>
            <Text style={styles.surfaceOverviewLabel}>{t('settings.configured')}</Text>
          </View>
          <View style={styles.configActionRow}>
            <TouchableOpacity
              style={styles.primaryBtn}
              onPress={activeConfigSurfaceCard.onPress}
              accessibilityRole="button"
              accessibilityLabel={activeConfigSurfaceCard.actionLabel}
            >
              <Text style={styles.primaryBtnText}>{activeConfigSurfaceCard.actionLabel}</Text>
            </TouchableOpacity>
          </View>
        </View>
        <RemoteWorkWorkspaceHubSection
          colors={colors}
          styles={styles}
          t={t}
          isWide={isWide}
          workspaceTargets={workspaceTargets}
          workspaceReadyCount={workspaceReadyCount}
          workspaceNeedsSetupCount={workspaceNeedsSetupCount}
          workspaceDisabledCount={workspaceDisabledCount}
          selectedWorkspaceTarget={selectedWorkspaceTarget || undefined}
          selectedWorkspaceReadiness={selectedWorkspaceReadiness}
          selectedWorkspaceControlStatus={selectedWorkspaceControlStatus}
          selectedWorkspaceCheckPending={selectedWorkspaceCheckPending}
          selectedWorkspaceProbe={selectedWorkspaceProbe}
          workspaceProbeResults={workspaceProbeResults}
          handleCreateWorkspace={handleCreateWorkspace}
          setSelectedWorkspaceId={setSelectedWorkspaceId}
          isWorkspaceControlReady={isWorkspaceControlReady}
          getWorkspaceTargetDisplayName={getWorkspaceTargetDisplayName}
          getLocalizedWorkspaceProviderLabel={getLocalizedWorkspaceProviderLabel}
          getWorkspaceReadinessLabel={getWorkspaceReadinessLabel}
          getWorkspaceAuthModeLabel={getWorkspaceAuthModeLabel}
          getWorkspaceBrowserProviderName={getWorkspaceBrowserProviderName}
          getWorkspaceAiHandoffSummary={getWorkspaceAiHandoffSummary}
          handleOpenWorkspace={handleOpenWorkspace}
          handleProbeWorkspace={handleProbeWorkspace}
          handleEditWorkspaceConfig={handleEditWorkspaceConfig}
        />
        <RemoteWorkInfrastructureTargetsSection
          colors={colors}
          styles={styles}
          t={t}
          mcpTargets={mcpTargets}
          mcpServers={mcpServers}
          sshTargets={sshTargets}
          sshSessions={sshSessions}
          browserProviders={browserProviders}
          trackedRemoteSessions={trackedRemoteSessions}
          sshProbeResults={sshProbeResults}
          browserProbeResults={browserProbeResults}
          pendingSshChecks={pendingSshChecks}
          pendingBrowserChecks={pendingBrowserChecks}
          pendingBrowserLaunches={pendingBrowserLaunches}
          activeSshSessionId={activeSshSessionId}
          openingShellTargetId={openingShellTargetId}
          activeBrowserSession={activeBrowserSession}
          getSshTargetReadiness={getSshTargetReadiness}
          getSshTargetLabel={getSshTargetLabel}
          getSshReadinessLabel={getSshReadinessLabel}
          getSshTargetAuthModeLabel={getSshTargetAuthModeLabel}
          getSshHostKeyPolicyLabel={getSshHostKeyPolicyLabel}
          getBrowserProviderReadiness={getBrowserProviderReadiness}
          getBrowserProviderLabel={getBrowserProviderLabel}
          getBrowserReadinessLabel={getBrowserReadinessLabel}
          handleCreateMcp={handleCreateMcp}
          handleEditMcpConfig={handleEditMcpConfig}
          handleCreateSsh={handleCreateSsh}
          handleOpenShell={handleOpenShell}
          handleProbeSsh={handleProbeSsh}
          handleEditSshConfig={handleEditSshConfig}
          handleCreateBrowser={handleCreateBrowser}
          handleLaunchBrowser={handleLaunchBrowser}
          handleProbeBrowser={handleProbeBrowser}
          handleEditBrowserConfig={handleEditBrowserConfig}
        />

        <RemoteWorkExpoTargetsSection
          colors={colors}
          styles={styles}
          t={t}
          expoProjects={expoProjects}
          expoAccounts={expoAccounts}
          sshTargets={sshTargets}
          expoProbeResults={expoProbeResults}
          pendingExpoChecks={pendingExpoChecks}
          pendingExpoActions={pendingExpoActions}
          handleCreateExpo={handleCreateExpo}
          handleSyncExpoAccount={handleSyncExpoAccount}
          handleRunExpoAction={handleRunExpoAction}
          handleProbeExpo={handleProbeExpo}
          handleEditExpoProject={handleEditExpoProject}
        />
        <RemoteWorkSessionsSection
          colors={colors}
          styles={styles}
          t={t}
          trackedRemoteSessions={trackedRemoteSessions}
          setActiveBrowserSession={setActiveBrowserSession}
          handleStopBrowser={handleStopBrowser}
        />
        <RemoteWorkJobsSection
          colors={colors}
          styles={styles}
          t={t}
          trackedRemoteJobs={trackedRemoteJobs}
        />
      </ScrollView>

      <RemoteWorkConfigModals
        colors={colors}
        styles={styles}
        t={t}
        isWide={isWide}
        modalGroups={modalGroups}
      />

      <RemoteWorkExpoWorkflowPromptModal
        styles={styles}
        t={t}
        colors={{ textTertiary: colors.textTertiary }}
        expoWorkflowPrompt={expoWorkflowPrompt}
        setExpoWorkflowPrompt={setExpoWorkflowPrompt}
        getExpoActionLabel={getExpoActionLabel}
        handleConfirmExpoWorkflowPrompt={handleConfirmExpoWorkflowPrompt}
      />

      <RemoteWorkWorkspaceSessionModal
        colors={colors}
        styles={styles}
        t={t}
        activeWorkspaceSession={activeWorkspaceSession}
        setActiveWorkspaceSession={setActiveWorkspaceSession}
        workspaceSessionError={workspaceSessionError}
        setWorkspaceSessionError={setWorkspaceSessionError}
        getWorkspaceTargetDisplayName={getWorkspaceTargetDisplayName}
        WebViewComponent={WebView}
      />

      <RemoteWorkSshSessionModal
        colors={colors}
        styles={styles}
        t={t}
        activeSshSession={activeSshSession}
        closeShellSession={closeShellSession}
        handleCloseSshModal={handleCloseSshModal}
        sshTerminalRef={sshTerminalRef}
        handleSshTerminalInput={handleSshTerminalInput}
        handleSshTerminalReady={handleSshTerminalReady}
        handleTerminalLink={handleTerminalLink}
      />

      <RemoteWorkBrowserSessionModal
        colors={colors}
        styles={styles}
        t={t}
        activeBrowserSession={activeBrowserSession}
        setActiveBrowserSession={setActiveBrowserSession}
        WebViewComponent={WebView}
      />
    </SafeAreaView>
  );
};

export const RemoteWorkScreen: React.FC = () => {
  const { t } = useTranslation();

  return (
    <ErrorBoundary
      fallbackTitle={t('errorBoundary.title')}
      fallbackMessage={t('errorBoundary.message')}
    >
      <RemoteWorkScreenInner />
    </ErrorBoundary>
  );
};
