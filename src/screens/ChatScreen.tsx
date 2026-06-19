// ---------------------------------------------------------------------------
// Kavi — Chat Screen
// ---------------------------------------------------------------------------
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, Text, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { DrawerNavigationProp } from '@react-navigation/drawer';
import { useIsFocused, useNavigation } from '@react-navigation/native';
import { useShallow } from 'zustand/react/shallow';
import { AlertTriangle } from 'lucide-react-native';
import { requestChatStorePersistenceCheckpoint } from '../store/chatStorePersistence';
import { useChatStore } from '../store/useChatStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { SubAgentDetailModal } from '../components/agents/SubAgentDetailModal';
import { ApprovalBanner } from '../components/approval/ApprovalBanner';
import { type EnsureAgentRunFinalResponse } from '../engine/graph/foregroundRun/contracts';
import { useConversationGraphController } from '../engine/graph/conversation/useConversationGraphController';
import { useForegroundConversationActions } from '../engine/graph/foregroundRun/useForegroundConversationActions';
import { useForegroundRunRecoveryEffects } from '../engine/graph/foregroundRun/useForegroundRunRecoveryEffects';
import { useForegroundConversationRunner } from '../engine/graph/foregroundRun/useForegroundConversationRunner';
import { useAppTheme } from '../theme/useAppTheme';
import { AgentRunAsyncOperation } from '../types/agentRun';
import { usePersonaConfigStore } from '../services/agents/store';
import { generateId } from '../utils/id';
import { useTranslation } from '../i18n/useTranslation';
import { selectChatScreenChatSlice, selectChatScreenSettingsSlice } from './chatScreenSelectors';
import {
  clearChatDisplayStateCache,
  createChatDisplayStateCache,
  INITIAL_CHAT_SOURCE_MESSAGE_LIMIT,
  type ResolvedDisplayMessageItem,
} from './chatScreenDisplayState';
import { clearAgentRunCancellation } from '../services/agents/agentRunCancellation';
import {
  STREAM_STORE_CHECKPOINT_INTERVAL_MS,
  STREAM_UI_DRAFT_PUBLISH_INTERVAL_MS,
  TOOL_RESULT_PERSISTENCE_CHECKPOINT_DELAY_MS,
} from './chatScreenConstants';
import { createStyles } from './ChatScreen.styles';
import { ChatScreenConversationPane } from './chatScreen/ChatScreenConversationPane';
import { useChatScreenConversationState } from './chatScreen/useChatScreenConversationState';
import { ChatScreenHeader } from './chatScreen/ChatScreenHeader';
import { useChatScreenPresentationState } from './chatScreen/useChatScreenPresentationState';
import { useChatScreenRuntimeHelpers } from './chatScreen/useChatScreenRuntimeHelpers';
import { ChatScreenTelemetryPanel } from './chatScreen/ChatScreenTelemetryPanel';
import { useChatScreenUiCallbacks } from './chatScreen/useChatScreenUiCallbacks';
import { useChatComposerState } from './useChatComposerState';
import { useChatScrollController } from './useChatScrollController';
import { useAgentRunFinalResponse } from './useAgentRunFinalResponse';
import { useForegroundRequest } from './useForegroundRequest';
import { useLocalModelRuntimeState } from './useLocalModelRuntimeState';
import { useStreamingDrafts } from './useStreamingDrafts';
import { useSubAgentRunBridge } from './useSubAgentRunBridge';
import { useRecoveredAsyncRunResume } from './useRecoveredAsyncRunResume';
import { useTerminalBackgroundReviewQueue } from './useTerminalBackgroundReviewQueue';

export const ChatScreen: React.FC = () => {
  const navigation = useNavigation<DrawerNavigationProp<any>>();
  const isFocused = useIsFocused();
  const flatListRef = useRef<FlatList<ResolvedDisplayMessageItem>>(null);
  const runInvocationSequenceRef = useRef(0);
  const { colors } = useAppTheme();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const chatSlice = useChatStore(useShallow(selectChatScreenChatSlice));
  const {
    conversations,
    activeConversation,
    activeConversationId,
    isLoading,
    getOrCreateCanonicalThread,
    addMessage,
    updateMessage,
    updateMessageEnrichedContent,
    updateMessageReasoning,
    updateMessageProviderReplay,
    updateMessageAssistantMetadata,
    updateMessageEffect,
    editMessage,
    setLoading,
    addToolCall,
    updateToolCallStatus,
    addConversationLog,
    startAgentRun,
    setAgentRunPhase,
    appendAgentRunCheckpoint,
    updateAgentRunSummary,
    updateAgentRunAsyncWork,
    updateAgentRunControlGraph,
    updateAgentRunPlan,
    completeAgentRun,
    updateModelInConversation,
    updatePersonaInConversation,
    updateModeInConversation,
  } = chatSlice;
  const createSideThread = chatSlice.createSideThread;
  const discardSideThread = chatSlice.discardSideThread;

  const settingsSlice = useSettingsStore(useShallow(selectChatScreenSettingsSlice));
  const {
    providers,
    activeProviderId,
    activeModel,
    thinkingLevel,
    systemPrompt,
    setActiveProviderAndModel,
    setLastUsedModel,
    linkUnderstandingEnabled,
    mediaUnderstandingEnabled,
    maxLinks,
    defaultConversationMode,
  } = settingsSlice;

  const [chatError, setChatError] = useState<string | null>(null);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editingContent, setEditingContent] = useState<string | undefined>(undefined);
  const [streamingMessageId, setStreamingMessageId] = useState<string | null>(null);
  const [visibleSourceMessageLimit, setVisibleSourceMessageLimit] = useState(
    INITIAL_CHAT_SOURCE_MESSAGE_LIMIT,
  );
  const [showLogs, setShowLogs] = useState(false);
  const {
    clearStreamingDraft,
    mergeStreamingDraft,
    resetStreamingDrafts,
    streamingDraftState,
    streamingDraftsRef,
    updateStreamingDraft,
  } = useStreamingDrafts();
  const {
    abortForegroundRequestForConversation,
    abortRef,
    clearForegroundRequest,
    clearForegroundRequestForConversation,
    foregroundRequestConversationId,
    isCurrentForegroundRequest,
    registerForegroundRequest,
  } = useForegroundRequest({ setLoading, setStreamingMessageId });
  const previousVisibleCountRef = useRef(0);
  const previousSourceMessageCountRef = useRef(0);
  const displayStateCacheRef = useRef(createChatDisplayStateCache());
  const pendingAgentRunFinalizationsRef = useRef(new Map<string, Promise<string | undefined>>());
  const pendingAgentRunTerminalReviewsRef = useRef(new Map<string, Promise<void>>());
  const pendingAgentRunAsyncResumesRef = useRef(new Map<string, Promise<void>>());
  const ensureAgentRunFinalResponseRef = useRef<EnsureAgentRunFinalResponse | null>(null);
  const resumeAgentRunRef = useRef<
    | ((params: {
        conversationId: string;
        runId: string;
        additionalSystemPrompt: string;
        additionalUserPrompt?: string;
        disableTools?: boolean;
        reuseAssistantDraft?: boolean;
        initialPendingAsyncOperations?: AgentRunAsyncOperation[];
      }) => Promise<void>)
    | null
  >(null);
  const {
    clearInteractionReleaseTimer,
    clearPendingScrollFrames,
    forceNextScrollRef,
    handleUserScrollEnd,
    handleUserScrollStart,
    interactionReleaseTimerRef,
    listMetricsRef,
    maybeScrollToBottom,
    resetScrollState,
    scrollToBottom,
    shouldAutoFollowRef,
    updateAutoFollowState,
  } = useChatScrollController({ flatListRef });
  const {
    activeProvider,
    currentModel,
    effectiveMode,
    effectivePersonaId,
    isAgenticMode,
    isConversationBusy,
    supportsVision,
  } = useChatScreenConversationState({
    activeConversation: activeConversation ?? undefined,
    activeModel,
    activeProviderId,
    defaultConversationMode,
    foregroundRequestConversationId,
    providers,
  });

  const { activeLocalRuntimeStatus, activeErrorMessage } = useLocalModelRuntimeState({
    activeProvider,
    currentModel: currentModel ?? undefined,
    chatError,
    isFocused,
  });
  const {
    appendConversationLog,
    clearPendingRunState,
    getConversation,
    getConversations,
    recordConversationTurnMemory,
  } = useChatScreenRuntimeHelpers({
    addConversationLog,
    pendingAgentRunAsyncResumesRef,
    pendingAgentRunFinalizationsRef,
    pendingAgentRunTerminalReviewsRef,
  });

  const {
    ensureCanonicalConversation,
    handleModelSelect,
    handlePersonaSelect,
    handleToggleMode,
    resolveConversationFinalizationContext,
    resolveConversationFinalizationContextRef,
  } = useConversationGraphController({
    activeConversationId,
    activeModel,
    activeProviderId,
    effectiveMode,
    effectivePersonaId,
    getOrCreateCanonicalThread,
    noProviderMessage: t('chat.noProvider'),
    providers,
    setActiveProviderAndModel,
    setChatError,
    setLastUsedModel,
    systemPrompt,
    updateModeInConversation,
    updateModelInConversation,
    updatePersonaInConversation,
  });

  const ensureAgentRunFinalResponse = useAgentRunFinalResponse({
    appendAgentRunCheckpoint,
    appendConversationLog,
    ensureAgentRunFinalResponseRef,
    pendingAgentRunFinalizationsRef,
    resolveConversationFinalizationContextRef,
    setAgentRunPhase,
    updateAgentRunSummary,
    updateMessage,
    updateMessageAssistantMetadata,
    updateMessageProviderReplay,
  });

  const queueTerminalBackgroundReview = useTerminalBackgroundReviewQueue({
    appendConversationLog,
    completeAgentRun,
    ensureAgentRunFinalResponseRef,
    pendingAgentRunTerminalReviewsRef,
    resolveConversationFinalizationContextRef,
    resumeAgentRunRef,
    setAgentRunPhase,
    updateAgentRunAsyncWork,
    updateAgentRunControlGraph,
    updateAgentRunSummary,
    updateMessageAssistantMetadata,
  });

  useRecoveredAsyncRunResume({
    abortRef,
    appendConversationLog,
    conversations,
    isLoading,
    pendingAgentRunAsyncResumesRef,
    resumeAgentRunRef,
    setAgentRunPhase,
    updateAgentRunSummary,
  });

  const {
    liveSubAgentSnapshotsById,
    resetSubAgentRunBridge,
    selectedSubAgentSnapshot,
    setSelectedSubAgentSnapshot,
    subAgentActivityVersion,
  } = useSubAgentRunBridge({
    activeConversationId,
    forceNextScrollRef,
    queueTerminalBackgroundReview,
    shouldAutoFollowRef,
  });

  const {
    clearComposerDraft,
    composerAttachments,
    composerText,
    handleComposerAttachmentsChange,
    handleComposerTextChange,
  } = useChatComposerState({
    activeConversationId,
    editingContent,
    editingMessageId,
    setEditingContent,
  });

  // Clear error when switching conversations
  useEffect(() => {
    setChatError(null);
    setShowLogs(false);
    previousVisibleCountRef.current = 0;
    previousSourceMessageCountRef.current = 0;
    resetScrollState();
    clearChatDisplayStateCache(displayStateCacheRef.current);
    resetSubAgentRunBridge();
    setEditingMessageId(null);
    setEditingContent(undefined);
    resetStreamingDrafts();
    setVisibleSourceMessageLimit(INITIAL_CHAT_SOURCE_MESSAGE_LIMIT);
  }, [activeConversationId, resetScrollState, resetStreamingDrafts, resetSubAgentRunBridge]);

  useEffect(
    () => () => {
      resetStreamingDrafts();
      clearChatDisplayStateCache(displayStateCacheRef.current);
      clearInteractionReleaseTimer();
      clearPendingScrollFrames();
      pendingAgentRunFinalizationsRef.current.clear();
      pendingAgentRunTerminalReviewsRef.current.clear();
      pendingAgentRunAsyncResumesRef.current.clear();
    },
    [clearInteractionReleaseTimer, clearPendingScrollFrames, resetStreamingDrafts],
  );

  useForegroundRunRecoveryEffects({
    conversations,
    ensureAgentRunFinalResponse,
    queueTerminalBackgroundReview,
    resolveConversationFinalizationContext,
    subAgentActivityVersion,
  });

  const runChat = useForegroundConversationRunner({
    appendConversationLog,
    clearForegroundRequest,
    clearPendingRunState,
    clearStreamingDraft,
    clearTrackedRunCancellation: clearAgentRunCancellation,
    createId: generateId,
    ensureAgentRunFinalResponse,
    ensureCanonicalConversation,
    getConversation,
    getConversations,
    isCurrentForegroundRequest,
    mergeStreamingDraft,
    recordConversationTurnMemory,
    registerForegroundRequest,
    requestPersistenceCheckpoint: requestChatStorePersistenceCheckpoint,
    resumeAgentRunRef,
    refs: {
      forceNextScrollRef,
      pendingAgentRunAsyncResumesRef,
      pendingAgentRunFinalizationsRef,
      pendingAgentRunTerminalReviewsRef,
      runInvocationSequenceRef,
      shouldAutoFollowRef,
      streamingDraftsRef,
    },
    requests: {
      abortForegroundRequestForConversation,
      setStreamingMessageId,
    },
    setChatError,
    state: {
      activeModel,
      activeProviderId,
      chatNoApiKeyMessage: t('chat.noApiKey'),
      chatNoModelMessage: t('chat.noModel'),
      chatNoProviderMessage: t('chat.noProvider'),
      defaultConversationMode,
      effectiveMode,
      effectivePersonaId,
      exportDialogTitle: t('chat.exportConversation'),
      linkUnderstandingEnabled,
      maxLinks,
      mediaUnderstandingEnabled,
      providers,
      streamStoreCheckpointIntervalMs: STREAM_STORE_CHECKPOINT_INTERVAL_MS,
      streamUiDraftPublishIntervalMs: STREAM_UI_DRAFT_PUBLISH_INTERVAL_MS,
      systemPrompt,
      thinkingLevel,
      toolResultPersistenceCheckpointDelayMs: TOOL_RESULT_PERSISTENCE_CHECKPOINT_DELAY_MS,
    },
    store: {
      addMessage,
      addToolCall,
      appendAgentRunCheckpoint,
      completeAgentRun,
      setAgentRunPhase,
      startAgentRun,
      updateAgentRunAsyncWork,
      updateAgentRunControlGraph,
      updateAgentRunPlan,
      updateAgentRunSummary,
      updateMessage,
      updateMessageAssistantMetadata,
      updateMessageEffect,
      updateMessageEnrichedContent,
      updateMessageProviderReplay,
      updateMessageReasoning,
      updateToolCallStatus,
      applyConversationCompaction: (conversationId, messages) => {
        useChatStore.getState().applyConversationCompaction(conversationId, messages);
      },
    },
    updateStreamingDraft,
  });

  const { handleEditSend, handleRetry, handleSend, handleStop } = useForegroundConversationActions({
    activeConversation: activeConversation ?? undefined,
    activeConversationId,
    addMessage,
    appendConversationLog,
    attachmentWorkspaceImportFailedMessage: t('chat.attachmentWorkspaceImportFailed'),
    abortForegroundRequestForConversation,
    clearComposerDraft,
    clearForegroundRequestForConversation,
    completeAgentRun,
    defaultConversationMode,
    editMessage,
    editingMessageId,
    ensureAgentRunFinalResponse,
    ensureCanonicalConversation,
    forceNextScrollRef,
    generateId,
    isAgenticMode,
    pendingAgentRunAsyncResumesRef,
    pendingAgentRunFinalizationsRef,
    pendingAgentRunTerminalReviewsRef,
    requestChatStorePersistenceCheckpoint,
    runChat,
    setChatError,
    setEditingContent,
    setEditingMessageId,
    updateAgentRunControlGraph,
  });

  const personaCustomList = usePersonaConfigStore((state) => state.customPersonas);
  const personaOverrides = usePersonaConfigStore((state) => state.overrides);
  const {
    availableSubAgentSnapshotsById,
    hiddenSourceMessageCount,
    messages,
    personaSwitchMarkersByMessageId,
    resolvedDisplayMessages,
    temporalMarkersByMessageId,
    workspaceFallbackConversationIds,
  } = useChatScreenPresentationState({
    activeConversation: activeConversation ?? undefined,
    activeConversationId,
    displayStateCacheRef,
    liveSubAgentSnapshotsById,
    personaCustomList,
    personaOverrides,
    streamingDrafts: streamingDraftState.drafts,
    streamingMessageId,
    visibleSourceMessageLimit,
  });

  useEffect(() => {
    const sourceMessageCount = messages.length;
    if (
      sourceMessageCount > previousSourceMessageCountRef.current &&
      resolvedDisplayMessages.length > previousVisibleCountRef.current
    ) {
      maybeScrollToBottom(!streamingMessageId);
    }

    previousVisibleCountRef.current = resolvedDisplayMessages.length;
    previousSourceMessageCountRef.current = sourceMessageCount;
  }, [maybeScrollToBottom, messages.length, resolvedDisplayMessages.length, streamingMessageId]);
  const {
    handleEdit,
    handleOpenSubAgentDetails,
    handleShareWorkspaceFile,
    handleShowEarlierMessages,
    handleToggleSideThread,
    handleViewFiles,
  } = useChatScreenUiCallbacks({
    activeConversation: activeConversation ?? undefined,
    activeConversationId,
    createSideThread,
    discardSideThread,
    navigation,
    setChatError,
    setEditingContent,
    setEditingMessageId,
    setSelectedSubAgentSnapshot,
    setVisibleSourceMessageLimit,
    shareFileFailedMessage: t('chat.shareFileFailed'),
    t,
    workspaceFallbackConversationIds,
  });

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <SubAgentDetailModal
        visible={!!selectedSubAgentSnapshot}
        selectedSnapshot={selectedSubAgentSnapshot}
        availableSnapshots={Array.from(availableSubAgentSnapshotsById.values())}
        onClose={() => setSelectedSubAgentSnapshot(null)}
      />

      <ChatScreenHeader
        activeConversation={activeConversation ?? undefined}
        activeLocalRuntimeStatus={activeLocalRuntimeStatus}
        activeProviderId={activeProviderId}
        colors={colors}
        currentModel={currentModel}
        isAgenticMode={isAgenticMode}
        isConversationBusy={isConversationBusy}
        onModelSelect={handleModelSelect}
        onOpenFiles={() => handleViewFiles()}
        onOpenMenu={() => navigation.openDrawer()}
        onOpenTerminal={() => navigation.navigate('Terminal' as any)}
        onPersonaSelect={handlePersonaSelect}
        onToggleMode={handleToggleMode}
        onToggleSideThread={handleToggleSideThread}
        styles={styles}
        t={t}
      />

      {activeErrorMessage && (
        <View style={styles.errorBanner}>
          <AlertTriangle size={16} color={colors.danger} />
          <Text style={styles.errorText} numberOfLines={2}>
            {activeErrorMessage}
          </Text>
        </View>
      )}

      <ApprovalBanner />

      <ChatScreenTelemetryPanel
        activeConversation={activeConversation ?? undefined}
        colors={colors}
        onToggleLogs={() => setShowLogs((current) => !current)}
        showLogs={showLogs}
        styles={styles}
        t={t}
      />

      <ChatScreenConversationPane
        bottomInset={insets.bottom}
        clearInteractionReleaseTimer={clearInteractionReleaseTimer}
        colors={colors}
        composerAttachments={composerAttachments}
        composerText={composerText}
        flatListRef={flatListRef}
        forceNextScrollRef={forceNextScrollRef}
        handleComposerAttachmentsChange={handleComposerAttachmentsChange}
        handleComposerTextChange={handleComposerTextChange}
        handleEdit={handleEdit}
        handleEditSend={handleEditSend}
        handleOpenSubAgentDetails={handleOpenSubAgentDetails}
        handleRetry={handleRetry}
        handleSend={handleSend}
        handleShareWorkspaceFile={handleShareWorkspaceFile}
        handleShowEarlierMessages={handleShowEarlierMessages}
        handleStop={handleStop}
        handleUserScrollEnd={handleUserScrollEnd}
        handleUserScrollStart={handleUserScrollStart}
        handleViewFiles={handleViewFiles}
        hiddenSourceMessageCount={hiddenSourceMessageCount}
        interactionReleaseTimerRef={interactionReleaseTimerRef}
        isConversationBusy={isConversationBusy}
        isEditing={editingMessageId !== null}
        listMetricsRef={listMetricsRef}
        maybeScrollToBottom={maybeScrollToBottom}
        personaSwitchMarkersByMessageId={personaSwitchMarkersByMessageId}
        resolvedDisplayMessages={resolvedDisplayMessages}
        scrollToBottom={scrollToBottom}
        setEditingContent={setEditingContent}
        setEditingMessageId={setEditingMessageId}
        shouldAutoFollowRef={shouldAutoFollowRef}
        streamingMessageId={streamingMessageId}
        styles={styles}
        supportsVision={supportsVision}
        t={t}
        temporalMarkersByMessageId={temporalMarkersByMessageId}
        updateAutoFollowState={updateAutoFollowState}
      />
    </SafeAreaView>
  );
};
