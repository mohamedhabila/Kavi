// ---------------------------------------------------------------------------
// Kavi — Settings Screen
// ---------------------------------------------------------------------------

import React, { useCallback, useMemo, useState } from 'react';
import { Alert, Text, TouchableOpacity, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';
import { ArrowLeft } from 'lucide-react-native';
import { useSettingsStore } from '../store/useSettingsStore';
import { SettingsAssistantSection } from './settings/SettingsAssistantSection';
import { SettingsDataSection } from './settings/SettingsDataSection';
import { SettingsOverviewSection } from './settings/SettingsOverviewSection';
import { SettingsPersonasSection } from './settings/SettingsPersonasSection';
import { SettingsSurfacesSection } from './settings/SettingsSurfacesSection';
import { SettingsToolsSection } from './settings/SettingsToolsSection';
import { SettingsRemoteConfigModals } from './settings/SettingsRemoteConfigModals';
import {
  SettingsCollapsibleSection,
  SettingsManagedScrollView,
} from './settings/SettingsScreenChrome';
import { createSettingsScreenStyles } from './settings/settingsScreenStyles';
import { useChatStore } from '../store/useChatStore';
import { useAppTheme } from '../theme/useAppTheme';
import { useTranslation } from '../i18n/useTranslation';
import { LOCALE_DISPLAY_NAMES, SUPPORTED_LOCALES } from '../i18n/registry';
import { useBackToChat } from '../navigation/useBackToChat';
import { useToolPermissionsStore } from '../services/security/permissions';
import { usePersonaConfigStore } from '../services/agents/store';
import { getBrowserProviderAuthLabel } from '../services/browser/providers/labels';
import { getSshHostKeyPolicyLabel, getSshTargetAuthModeLabel } from '../services/ssh/connector';
import { getLocalLlmModelDisplayName } from '../services/localLlm/catalog';
import { isOnDeviceLlmProvider } from '../services/localLlm/provider';
import { deriveConsolidationStatusSnapshot } from '../services/memory/consolidationStatus';
import { SettingsProviderEditor } from './components/settings/SettingsProviderEditor';
import { SettingsHome } from './settings/SettingsHome';
import { SettingsNotificationsVoiceSection } from './settings/SettingsNotificationsVoiceSection';
import { SettingsProviderSurfaces } from './settings/SettingsProviderSurfaces';
import {
  getSettingsDestinationTitleKey,
  resolveSettingsDestination,
  type SettingsDestination,
} from './settings/settingsDestination';
import {
  useSettingsRemoteConfigFlow,
  type SettingsSection,
} from './settings/useSettingsRemoteConfigFlow';
import { useSettingsProviderFlow } from './settings/useSettingsProviderFlow';
import {
  useSettingsSectionNavigation,
  type MainSettingsSectionId,
} from './settings/useSettingsSectionNavigation';
import { useSettingsPersonaFlow } from './settings/useSettingsPersonaFlow';
import { useSettingsToolsFlow } from './settings/useSettingsToolsFlow';
import { useSettingsThinkingAndLocale } from './settings/useSettingsThinkingAndLocale';
import { useSettingsLocalRuntimeStatuses } from './settings/useSettingsLocalRuntimeStatuses';
import { useSettingsRemoteConfigDraftHydration } from './settings/useSettingsRemoteConfigDraftHydration';

export const SettingsScreen: React.FC = () => {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const destination = resolveSettingsDestination(route.params?.destination);
  const clearTransientRouteState = useCallback(
    (continueNavigation: () => void) => {
      if (destination && destination !== 'home' && route.params?.parentDestination === 'home') {
        navigation.navigate('Settings', {
          destination: 'home',
          parentDestination: undefined,
          returnTo: route.params?.returnTo,
        });
        return;
      }

      if (
        route.params?.destination ||
        route.params?.parentDestination ||
        route.params?.returnTo ||
        route.params?.section ||
        route.params?.serverId
      ) {
        navigation.setParams({
          destination: undefined,
          parentDestination: undefined,
          returnTo: undefined,
          section: undefined,
          serverId: undefined,
        });
      }
      continueNavigation();
    },
    [destination, navigation, route.params],
  );
  const handleBack = useBackToChat({ beforeNavigate: clearTransientRouteState });
  const { colors } = useAppTheme();
  const { t } = useTranslation();
  const { width } = useWindowDimensions();
  const isWide = width >= 680;
  const styles = useMemo(() => createSettingsScreenStyles(colors), [colors]);

  const providers = useSettingsStore((s) => s.providers);
  const theme = useSettingsStore((s) => s.theme);
  const systemPrompt = useSettingsStore((s) => s.systemPrompt);
  const locale = useSettingsStore((s) => s.locale);
  const thinkingLevel = useSettingsStore((s) => s.thinkingLevel);
  const webSearchProvider = useSettingsStore((s) => s.webSearchProvider);
  const linkUnderstandingEnabled = useSettingsStore((s) => s.linkUnderstandingEnabled);
  const mediaUnderstandingEnabled = useSettingsStore((s) => s.mediaUnderstandingEnabled);
  const maxLinks = useSettingsStore((s) => s.maxLinks);
  const defaultConversationMode = useSettingsStore((s) => s.defaultConversationMode);
  const addProvider = useSettingsStore((s) => s.addProvider);
  const updateProvider = useSettingsStore((s) => s.updateProvider);
  const removeProvider = useSettingsStore((s) => s.removeProvider);
  const setTheme = useSettingsStore((s) => s.setTheme);
  const setSystemPrompt = useSettingsStore((s) => s.setSystemPrompt);
  const setLocale = useSettingsStore((s) => s.setLocale);
  const setThinkingLevel = useSettingsStore((s) => s.setThinkingLevel);
  const setWebSearchProvider = useSettingsStore((s) => s.setWebSearchProvider);
  const setLinkUnderstandingEnabled = useSettingsStore((s) => s.setLinkUnderstandingEnabled);
  const setMediaUnderstandingEnabled = useSettingsStore((s) => s.setMediaUnderstandingEnabled);
  const setMaxLinks = useSettingsStore((s) => s.setMaxLinks);
  const setDefaultConversationMode = useSettingsStore((s) => s.setDefaultConversationMode);
  const disableLongTermMemory = useSettingsStore((s) => s.disableLongTermMemory === true);
  const setDisableLongTermMemory = useSettingsStore((s) => s.setDisableLongTermMemory);
  const consolidationProviderId = useSettingsStore((s) => s.consolidationProvider ?? null);
  const memoryConsolidationMode = useSettingsStore((s) => s.memoryConsolidationMode ?? 'auto');
  const setMemoryConsolidationMode = useSettingsStore((s) => s.setMemoryConsolidationMode);
  const compactionProviderId = useSettingsStore((s) => s.compactionProvider ?? null);
  const compactionModel = useSettingsStore((s) => s.compactionModel ?? null);
  const setCompactionProvider = useSettingsStore((s) => s.setCompactionProvider);
  const setCompactionModel = useSettingsStore((s) => s.setCompactionModel);
  const activeProviderId = useSettingsStore((s) => s.activeProviderId ?? null);
  const consolidationStatus = useMemo(
    () =>
      deriveConsolidationStatusSnapshot({
        disableLongTermMemory,
        memoryConsolidationMode,
        consolidationProviderId,
        activeProviderId,
        providers,
      }),
    [
      activeProviderId,
      consolidationProviderId,
      disableLongTermMemory,
      memoryConsolidationMode,
      providers,
    ],
  );
  const clearAllConversations = useChatStore((s) => s.clearAllConversations);
  const permissions = useToolPermissionsStore((s) => s.permissions);
  const setToolPermission = useToolPermissionsStore((s) => s.setPermission);
  const personaOverrides = usePersonaConfigStore((s) => s.overrides);
  const customPersonas = usePersonaConfigStore((s) => s.customPersonas);
  const setPersonaOverride = usePersonaConfigStore((s) => s.setOverride);
  const upsertCustomPersona = usePersonaConfigStore((s) => s.upsertCustomPersona);

  const [section, setSection] = useState<SettingsSection>('main');
  const {
    browserProviders,
    expoAccounts,
    expoProjects,
    mcpServers,
    sshTargets,
    workspaceTargets,
    editingWorkspace,
    editingSsh,
    editingBrowser,
    editingExpoAccount,
    setWorkspaceAccessToken,
    setBrowserApiKey,
    setExpoAccountToken,
    setSshPassword,
    setSshPrivateKey,
    setSshPassphrase,
    modalGroups,
    isRemoteConfigModalActive,
    getMcpMetadataChips,
    handleNewMcp,
    handleEditMcp,
    handleNewSsh,
    handleEditSsh,
    handleNewWorkspace,
    handleEditWorkspace,
    handleNewBrowserProvider,
    handleEditBrowserProvider,
    handleNewExpoAccount,
    handleEditExpoAccount,
    handleSyncExpoAccount,
    handleEditExpoProject,
  } = useSettingsRemoteConfigFlow({
    section,
    setSection,
    routeParams: route.params,
    t,
  });
  const {
    editingProvider,
    editingProviderIsOnDevice,
    editingProviderIsExisting,
    localCatalog,
    selectedLocalCatalogEntry,
    canSaveProvider,
    showApiKey,
    tempApiKey,
    editingLocalModelDownloadState,
    editingLocalModelWasJustDownloaded,
    editingLocalModelInvalidInstallIssue,
    editingLocalModelFallbackName,
    canSwitchEditingLocalModelToCpu,
    handleNewProvider,
    handleEditProvider,
    handleDownloadSelectedLocalModel,
    handleClearSelectedLocalModelInstall,
    handleSwitchSelectedLocalModelToCpu,
    handleChooseFallbackLocalModel,
    handleSaveProvider,
    handleDeleteProvider,
    closeProviderEditor,
    onToggleShowApiKey,
    setEditingProvider,
    setTempApiKey,
    isLocalLlmModelInstalled,
  } = useSettingsProviderFlow({
    t,
    providers,
    setSection,
    addProvider,
    updateProvider,
    removeProvider,
  });
  const {
    personas,
    editingPersonaId,
    setEditingPersonaId,
    personaDraft,
    setPersonaDraft,
    currentPersona,
    handleSavePersona,
  } = useSettingsPersonaFlow({
    personaOverrides,
    customPersonas,
    setPersonaOverride,
    upsertCustomPersona,
  });
  const {
    serviceSetupFields,
    toolGroups,
    serviceKeys,
    setServiceKeys,
    expandedGroups,
    toggleGroup,
    webSearchProviderOptions,
    builtInToolSections,
    getServiceFieldCopy,
    persistServiceKey,
    handleOpenUrl,
    permissionStateByTool,
  } = useSettingsToolsFlow({
    t,
    permissions,
  });
  const { localRuntimeStatusesByProviderId, formatLocalLlmRuntimeStatusLabel } =
    useSettingsLocalRuntimeStatuses(providers);
  const {
    showLanguagePicker,
    setShowLanguagePicker,
    thinkingLevelOptions,
    personaThinkingLevelOptions,
    handleLocaleChange,
  } = useSettingsThinkingAndLocale({
    t,
    setLocale,
  });
  const [expandedPanels, setExpandedPanels] = useState({
    toolPermissions: true,
    personas: true,
    executionSurfaces: true,
  });
  const {
    activeMainSection,
    mainScrollRef,
    editorScrollRef,
    mainSectionOffsetsRef,
    mainSections,
    updateTrackedScroll,
    restoreTrackedScroll,
    handleJumpToMainSection,
  } = useSettingsSectionNavigation({
    mainContentKey: destination ?? 'legacy',
    section,
    t,
  });
  useSettingsRemoteConfigDraftHydration({
    section,
    editingWorkspace,
    editingSsh,
    editingBrowser,
    editingExpoAccount,
    setWorkspaceAccessToken,
    setBrowserApiKey,
    setExpoAccountToken,
    setSshPassword,
    setSshPrivateKey,
    setSshPassphrase,
  });

  const togglePanel = useCallback((panel: keyof typeof expandedPanels) => {
    setExpandedPanels((current) => ({ ...current, [panel]: !current[panel] }));
  }, []);

  // --- MCP Server Edit ---
  const handleClearAllConversations = useCallback(() => {
    Alert.alert(t('chat.clearAll'), t('chat.clearAllConfirm'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('common.delete'), style: 'destructive', onPress: clearAllConversations },
    ]);
  }, [clearAllConversations, t]);

  const handleManageMemory = useCallback(() => {
    navigation.navigate('Memory');
  }, [navigation]);

  const handleManageApprovals = useCallback(() => {
    navigation.navigate('ApprovalHistory');
  }, [navigation]);

  const handleOpenDestination = useCallback(
    (nextDestination: SettingsDestination) => {
      navigation.navigate('Settings', {
        destination: nextDestination,
        parentDestination: 'home',
        returnTo: route.params?.returnTo,
      });
    },
    [navigation, route.params?.returnTo],
  );

  const handleOpenDeveloperWork = useCallback(() => {
    navigation.navigate('DeveloperWork', {
      returnTo: { name: 'Settings', params: { destination: 'home' } },
    });
  }, [navigation]);

  const handleOpenVoice = useCallback(() => {
    navigation.navigate('Voice', {
      returnTo: {
        name: 'Settings',
        params: { destination: 'notifications-voice', parentDestination: 'home' },
      },
    });
  }, [navigation]);

  const handleOpenScheduler = useCallback(() => {
    navigation.navigate('Scheduler', {
      returnTo: {
        name: 'Settings',
        params: { destination: 'notifications-voice', parentDestination: 'home' },
      },
    });
  }, [navigation]);

  const blockedToolsCount = useMemo(
    () =>
      Array.from(permissionStateByTool.values()).filter((permission) => !permission.allowed).length,
    [permissionStateByTool],
  );
  const settingsTitle = destination
    ? t(getSettingsDestinationTitleKey(destination))
    : t('settings.title');
  const themeLabel =
    theme === 'light'
      ? t('settings.light')
      : theme === 'dark'
        ? t('settings.dark')
        : t('settings.system');
  const showLegacySettings = destination === null;

  // --- Provider Edit Section ---
  if (section === 'provider-edit' && editingProvider) {
    return (
      <SettingsProviderEditor
        editingProvider={editingProvider}
        isExisting={editingProviderIsExisting}
        isOnDevice={editingProviderIsOnDevice}
        canSave={canSaveProvider}
        localCatalog={localCatalog}
        selectedLocalCatalogEntry={selectedLocalCatalogEntry}
        tempApiKey={tempApiKey}
        showApiKey={showApiKey}
        editingLocalModelDownloadState={editingLocalModelDownloadState}
        editingLocalModelWasJustDownloaded={editingLocalModelWasJustDownloaded}
        editingLocalModelRuntimeStatus={localRuntimeStatusesByProviderId[editingProvider.id]}
        editingLocalModelInvalidInstallIssue={editingLocalModelInvalidInstallIssue}
        editingLocalModelFallbackName={editingLocalModelFallbackName}
        canSwitchEditingLocalModelToCpu={canSwitchEditingLocalModelToCpu}
        handleDeleteProvider={handleDeleteProvider}
        handleDownloadSelectedLocalModel={handleDownloadSelectedLocalModel}
        handleClearSelectedLocalModelInstall={handleClearSelectedLocalModelInstall}
        handleSwitchSelectedLocalModelToCpu={handleSwitchSelectedLocalModelToCpu}
        handleChooseFallbackLocalModel={handleChooseFallbackLocalModel}
        handleSaveProvider={handleSaveProvider}
        isLocalLlmModelInstalled={isLocalLlmModelInstalled}
        onToggleShowApiKey={onToggleShowApiKey}
        setEditingProvider={(provider) => setEditingProvider(provider)}
        setTempApiKey={setTempApiKey}
        colors={colors}
        styles={styles}
        t={t}
        scrollRef={editorScrollRef}
        onBack={closeProviderEditor}
        onTrackedScroll={(y) => updateTrackedScroll('provider-edit', y)}
        onRestore={() => restoreTrackedScroll('provider-edit', editorScrollRef)}
      />
    );
  }

  // --- Main Settings ---
  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {isRemoteConfigModalActive ? null : (
        <>
          <View style={styles.header}>
            <TouchableOpacity
              onPress={handleBack}
              accessibilityRole="button"
              accessibilityLabel={t('common.back')}
              style={styles.headerAction}
              testID="settings-back"
            >
              <ArrowLeft size={24} color={colors.text} />
            </TouchableOpacity>
            <Text style={styles.headerTitle}>{settingsTitle}</Text>
            <View style={styles.headerAction} />
          </View>

          <SettingsManagedScrollView
            ref={mainScrollRef}
            style={styles.content}
            contentContainerStyle={styles.contentContainer}
            onTrackedScroll={(y) => updateTrackedScroll('main', y)}
            onRestore={() => restoreTrackedScroll('main', mainScrollRef)}
          >
            {destination === 'home' ? (
              <SettingsHome
                assistantStylesCount={personas.length}
                blockedToolsCount={blockedToolsCount}
                colors={colors}
                connectionsCount={browserProviders.length + mcpServers.length}
                localeLabel={LOCALE_DISPLAY_NAMES[locale]}
                memoryEnabled={!disableLongTermMemory}
                onOpenDestination={handleOpenDestination}
                onOpenDeveloperWork={handleOpenDeveloperWork}
                providersCount={providers.length}
                remoteTargetsCount={
                  sshTargets.length + workspaceTargets.length + expoProjects.length
                }
                t={t}
                themeLabel={themeLabel}
              />
            ) : null}

            {showLegacySettings ? (
              <SettingsOverviewSection
                colors={colors}
                styles={styles}
                t={t}
                onLayout={(event) => {
                  mainSectionOffsetsRef.current.overview = event.nativeEvent.layout.y;
                }}
                mainSections={mainSections}
                activeMainSection={activeMainSection}
                handleJumpToMainSection={(sectionId) =>
                  handleJumpToMainSection(sectionId as MainSettingsSectionId)
                }
                providersCount={providers.length}
                mcpServersCount={mcpServers.length}
                expoAccountsCount={expoAccounts.length}
                expoProjectsCount={expoProjects.length}
                sshTargetsCount={sshTargets.length}
                browserProvidersCount={browserProviders.length}
                workspaceTargetsCount={workspaceTargets.length}
                handleEditFirstProvider={() => handleEditProvider(providers[0])}
                handleNewProvider={() => handleNewProvider()}
                handleEditFirstMcp={() => handleEditMcp(mcpServers[0])}
                handleNewMcp={handleNewMcp}
                handleEditFirstExpoAccount={() => handleEditExpoAccount(expoAccounts[0])}
                handleNewExpoAccount={handleNewExpoAccount}
                handleEditFirstSsh={() => handleEditSsh(sshTargets[0])}
                handleNewSsh={handleNewSsh}
                handleEditFirstBrowserProvider={() =>
                  handleEditBrowserProvider(browserProviders[0])
                }
                handleNewBrowserProvider={handleNewBrowserProvider}
                handleEditFirstWorkspace={() => handleEditWorkspace(workspaceTargets[0])}
                handleNewWorkspace={handleNewWorkspace}
              />
            ) : null}

            {showLegacySettings ||
            destination === 'assistant-personalization' ||
            destination === 'appearance-language' ? (
              <SettingsAssistantSection
                colors={colors}
                styles={styles}
                t={t}
                onLayout={(event) => {
                  mainSectionOffsetsRef.current.assistant = event.nativeEvent.layout.y;
                }}
                theme={theme}
                setTheme={setTheme}
                locale={locale}
                localeDisplayNames={LOCALE_DISPLAY_NAMES}
                supportedLocales={SUPPORTED_LOCALES}
                showLanguagePicker={showLanguagePicker}
                setShowLanguagePicker={setShowLanguagePicker}
                handleLocaleChange={handleLocaleChange}
                linkUnderstandingEnabled={linkUnderstandingEnabled}
                setLinkUnderstandingEnabled={setLinkUnderstandingEnabled}
                maxLinks={maxLinks}
                setMaxLinks={setMaxLinks}
                mediaUnderstandingEnabled={mediaUnderstandingEnabled}
                setMediaUnderstandingEnabled={setMediaUnderstandingEnabled}
                defaultConversationMode={defaultConversationMode}
                setDefaultConversationMode={setDefaultConversationMode}
                thinkingLevel={thinkingLevel}
                thinkingLevelOptions={thinkingLevelOptions}
                setThinkingLevel={setThinkingLevel}
                systemPrompt={systemPrompt}
                setSystemPrompt={setSystemPrompt}
                mode={
                  destination === 'assistant-personalization'
                    ? 'assistant'
                    : destination === 'appearance-language'
                      ? 'appearance'
                      : 'all'
                }
              />
            ) : null}

            {showLegacySettings || destination === 'tools-permissions' ? (
              <SettingsToolsSection
                CollapsibleSectionComponent={SettingsCollapsibleSection}
                colors={colors}
                styles={styles}
                t={t}
                onLayout={(event) => {
                  mainSectionOffsetsRef.current.tools = event.nativeEvent.layout.y;
                }}
                webSearchProvider={webSearchProvider}
                setWebSearchProvider={setWebSearchProvider}
                webSearchProviderOptions={webSearchProviderOptions}
                serviceSetupFields={serviceSetupFields}
                serviceKeys={serviceKeys}
                setServiceKeys={setServiceKeys}
                getServiceFieldCopy={getServiceFieldCopy}
                persistServiceKey={persistServiceKey}
                handleOpenUrl={handleOpenUrl}
                builtInToolSections={builtInToolSections}
                toolGroups={toolGroups}
                permissionStateByTool={permissionStateByTool}
                expandedToolPermissions={expandedPanels.toolPermissions}
                toggleToolPermissions={() => togglePanel('toolPermissions')}
                expandedGroups={expandedGroups}
                toggleGroup={toggleGroup}
                setToolPermission={setToolPermission}
                mode={destination === 'tools-permissions' ? 'focused' : 'all'}
              />
            ) : null}

            {showLegacySettings || destination === 'assistant-personalization' ? (
              <SettingsPersonasSection
                CollapsibleSectionComponent={SettingsCollapsibleSection}
                colors={colors}
                styles={styles}
                t={t}
                onLayout={(event: any) => {
                  mainSectionOffsetsRef.current.personas = event.nativeEvent.layout.y;
                }}
                expandedPersonas={expandedPanels.personas}
                togglePersonas={() => togglePanel('personas')}
                personas={personas}
                editingPersonaId={editingPersonaId}
                setEditingPersonaId={setEditingPersonaId}
                currentPersona={currentPersona}
                personaDraft={personaDraft}
                setPersonaDraft={setPersonaDraft}
                personaThinkingLevelOptions={personaThinkingLevelOptions}
                handleSavePersona={handleSavePersona}
              />
            ) : null}

            {showLegacySettings || destination === 'connections' ? (
              <SettingsSurfacesSection
                CollapsibleSectionComponent={SettingsCollapsibleSection}
                colors={colors}
                styles={styles}
                t={t}
                expandedExecutionSurfaces={expandedPanels.executionSurfaces}
                onToggleExecutionSurfaces={() => togglePanel('executionSurfaces')}
                onLayout={(event) => {
                  mainSectionOffsetsRef.current.surfaces = event.nativeEvent.layout.y;
                }}
                sshTargets={sshTargets}
                workspaceTargets={workspaceTargets}
                browserProviders={browserProviders}
                expoAccounts={expoAccounts}
                expoProjects={expoProjects}
                providers={providers}
                mcpServers={mcpServers}
                localRuntimeStatusesByProviderId={localRuntimeStatusesByProviderId}
                getSshTargetAuthModeLabel={getSshTargetAuthModeLabel}
                getSshHostKeyPolicyLabel={getSshHostKeyPolicyLabel}
                getBrowserProviderAuthLabel={getBrowserProviderAuthLabel}
                getMcpMetadataChips={getMcpMetadataChips}
                isOnDeviceLlmProvider={isOnDeviceLlmProvider}
                getLocalLlmModelDisplayName={getLocalLlmModelDisplayName}
                formatLocalLlmRuntimeStatusLabel={formatLocalLlmRuntimeStatusLabel}
                handleNewSsh={handleNewSsh}
                handleEditSsh={handleEditSsh}
                handleNewWorkspace={handleNewWorkspace}
                handleEditWorkspace={handleEditWorkspace}
                handleNewBrowserProvider={handleNewBrowserProvider}
                handleEditBrowserProvider={handleEditBrowserProvider}
                handleNewExpoAccount={handleNewExpoAccount}
                handleEditExpoAccount={handleEditExpoAccount}
                handleSyncExpoAccount={handleSyncExpoAccount}
                handleEditExpoProject={handleEditExpoProject}
                handleNewProvider={handleNewProvider}
                handleEditProvider={handleEditProvider}
                handleNewMcp={handleNewMcp}
                handleEditMcp={handleEditMcp}
                mode={destination === 'connections' ? 'connections' : 'all'}
              />
            ) : null}

            {showLegacySettings || destination === 'memory-privacy' ? (
              <SettingsDataSection
                colors={colors}
                styles={styles}
                t={t}
                providers={providers}
                disableLongTermMemory={disableLongTermMemory}
                memoryConsolidationMode={memoryConsolidationMode}
                consolidationProviderId={consolidationProviderId}
                compactionProviderId={compactionProviderId}
                compactionModel={compactionModel}
                setDisableLongTermMemory={setDisableLongTermMemory}
                setMemoryConsolidationMode={setMemoryConsolidationMode}
                setCompactionProvider={setCompactionProvider}
                setCompactionModel={setCompactionModel}
                consolidationStatus={consolidationStatus}
                onLayout={(event) => {
                  mainSectionOffsetsRef.current.data = event.nativeEvent.layout.y;
                }}
                onManageMemory={handleManageMemory}
                onManageApprovals={handleManageApprovals}
                onClearAllConversations={handleClearAllConversations}
                mode={destination === 'memory-privacy' ? 'focused' : 'all'}
              />
            ) : null}

            {destination === 'notifications-voice' ? (
              <SettingsNotificationsVoiceSection
                colors={colors}
                onOpenScheduler={handleOpenScheduler}
                onOpenVoice={handleOpenVoice}
                styles={styles}
                t={t}
              />
            ) : null}

            {destination === 'advanced-ai' ? (
              <View style={styles.sectionCard} testID="settings-advanced-ai">
                <Text style={styles.sectionCardHint}>
                  {t('settings.destinations.advancedAI.hint')}
                </Text>
                <SettingsProviderSurfaces
                  colors={colors}
                  styles={styles}
                  t={t}
                  providers={providers}
                  localRuntimeStatusesByProviderId={localRuntimeStatusesByProviderId}
                  isOnDeviceLlmProvider={isOnDeviceLlmProvider}
                  getLocalLlmModelDisplayName={getLocalLlmModelDisplayName}
                  formatLocalLlmRuntimeStatusLabel={formatLocalLlmRuntimeStatusLabel}
                  handleNewProvider={handleNewProvider}
                  handleEditProvider={handleEditProvider}
                />
              </View>
            ) : null}
          </SettingsManagedScrollView>
        </>
      )}
      <SettingsRemoteConfigModals colors={colors} t={t} isWide={isWide} modalGroups={modalGroups} />
    </SafeAreaView>
  );
};
