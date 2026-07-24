import { useCallback, useMemo, type MutableRefObject, type RefObject } from 'react';
import {
  FlatList,
  Platform,
  Text,
  TouchableOpacity,
  View,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { ChatInput } from '../../components/chat/ChatInput';
import type { Attachment } from '../../types/attachment';
import type { Message } from '../../types/message';
import { USER_SCROLL_RELEASE_DELAY_MS } from '../chatScreenConstants';
import type { ResolvedDisplayMessageItem } from '../chatScreenDisplayState';
import { createStyles } from '../ChatScreen.styles';
import type { AppPalette } from '../../theme/useAppTheme';
import type { PersonaSwitchMarker } from '../../components/chat/personaSwitchMarkers';
import type { TemporalMarker } from '../../components/chat/temporalMarkers';
import { useConversationMessageRenderItem } from './useConversationMessageRenderItem';
import { ChatLatestActivityButton } from './ChatLatestActivityButton';
import { useLatestActivityPrompt } from './useLatestActivityPrompt';
import type { MemoryRetrievalFeedbackChoice } from '../../services/memory/retrievalOutcomeStore';
import { AssistantStart } from '../../components/chat/AssistantStart';

type TranslationFn = (key: string, params?: Record<string, string | number>) => string;

const MAINTAIN_VISIBLE_CONTENT_POSITION = { minIndexForVisible: 0 } as const;

type ChatScreenConversationPaneProps = {
  bottomInset: number;
  colors: AppPalette;
  composerAttachments: Attachment[];
  composerExactText: boolean;
  composerText: string;
  forceNextScrollRef: MutableRefObject<boolean>;
  handleComposerAttachmentsChange: (attachments: Attachment[]) => void;
  handleComposerExactTextChange: (exactText: boolean) => void;
  handleComposerTextChange: (text: string) => void;
  handleEdit: (messageId: string, content: string) => void;
  handleEditSend: (text: string, attachments?: Attachment[]) => Promise<void>;
  handleOpenSubAgentDetails: (snapshot: NonNullable<Message['subAgentEvent']>['snapshot']) => void;
  handleLoadMemoryFeedback: (
    messageId: string,
    eventId: string,
  ) => Promise<MemoryRetrievalFeedbackChoice | null>;
  handleMemoryFeedback: (
    messageId: string,
    eventId: string,
    outcome: MemoryRetrievalFeedbackChoice,
  ) => Promise<MemoryRetrievalFeedbackChoice>;
  handleRetry: (messageId: string) => Promise<void>;
  handleSend: (text: string, attachments?: Attachment[]) => Promise<void>;
  handleShareWorkspaceFile: (attachment: Attachment) => Promise<void>;
  handleShowEarlierMessages: () => void;
  handleStop: () => void;
  handleUserScrollEnd: () => void;
  handleUserScrollStart: () => void;
  handleViewCanvas: () => void;
  handleViewFiles: (path?: string) => void;
  hiddenSourceMessageCount: number;
  interactionReleaseTimerRef: MutableRefObject<ReturnType<typeof setTimeout> | null>;
  hasProviderReady: boolean;
  isConversationBusy: boolean;
  isEditing: boolean;
  listMetricsRef: MutableRefObject<{
    contentHeight: number;
    layoutHeight: number;
    offsetY: number;
  }>;
  maybeScrollToBottom: (animated: boolean) => void;
  onOpenProviderSetup: () => void;
  onResumeConversation: (conversationId: string) => void;
  personaSwitchMarkersByMessageId: Map<string, PersonaSwitchMarker>;
  providerName?: string;
  recentConversation?: { id: string; title: string };
  resolvedDisplayMessages: ResolvedDisplayMessageItem[];
  scrollToBottom: (animated: boolean) => void;
  setEditingContent: (content: string | undefined) => void;
  setEditingMessageId: (messageId: string | null) => void;
  shouldAutoFollowRef: MutableRefObject<boolean>;
  streamingMessageId: string | null;
  styles: ReturnType<typeof createStyles>;
  supportsVision: boolean;
  t: TranslationFn;
  temporalMarkersByMessageId: Map<string, TemporalMarker>;
  updateAutoFollowState: () => void;
  flatListRef: RefObject<FlatList<ResolvedDisplayMessageItem> | null>;
  clearInteractionReleaseTimer: () => void;
};

export function ChatScreenConversationPane(props: ChatScreenConversationPaneProps) {
  const {
    bottomInset,
    clearInteractionReleaseTimer,
    colors,
    composerAttachments,
    composerExactText,
    composerText,
    flatListRef,
    forceNextScrollRef,
    handleComposerAttachmentsChange,
    handleComposerExactTextChange,
    handleComposerTextChange,
    handleEdit,
    handleEditSend,
    handleOpenSubAgentDetails,
    handleLoadMemoryFeedback,
    handleMemoryFeedback,
    handleRetry,
    handleSend,
    handleShareWorkspaceFile,
    handleShowEarlierMessages,
    handleStop,
    handleUserScrollEnd,
    handleUserScrollStart,
    handleViewCanvas,
    handleViewFiles,
    hiddenSourceMessageCount,
    hasProviderReady,
    interactionReleaseTimerRef,
    isConversationBusy,
    isEditing,
    listMetricsRef,
    maybeScrollToBottom,
    onOpenProviderSetup,
    onResumeConversation,
    personaSwitchMarkersByMessageId,
    providerName,
    recentConversation,
    resolvedDisplayMessages,
    scrollToBottom,
    setEditingContent,
    setEditingMessageId,
    shouldAutoFollowRef,
    streamingMessageId,
    styles,
    supportsVision,
    t,
    temporalMarkersByMessageId,
    updateAutoFollowState,
  } = props;
  const renderMessageItem = useConversationMessageRenderItem({
    handleEdit,
    handleOpenSubAgentDetails,
    handleLoadMemoryFeedback,
    handleMemoryFeedback,
    handleRetry,
    handleShareWorkspaceFile,
    handleViewCanvas,
    handleViewFiles,
    personaSwitchMarkersByMessageId,
    styles,
    t,
    temporalMarkersByMessageId,
  });
  const { handleJumpToLatest, hasNewLatestActivity, syncLatestActivityPrompt } =
    useLatestActivityPrompt({
      forceNextScrollRef,
      resolvedDisplayMessages,
      scrollToBottom,
      shouldAutoFollowRef,
      streamingMessageId,
    });
  const listHeaderComponent = useMemo(
    () =>
      hiddenSourceMessageCount > 0 ? (
        <View style={styles.historyWindowHeader}>
          <TouchableOpacity
            style={styles.historyWindowButton}
            onPress={handleShowEarlierMessages}
            accessibilityRole="button"
            accessibilityLabel={t('chat.showEarlierMessages', {
              count: hiddenSourceMessageCount,
            })}
            testID="chat-show-earlier-messages"
          >
            <Text style={styles.historyWindowButtonText} numberOfLines={1}>
              {t('chat.showEarlierMessages', {
                count: hiddenSourceMessageCount,
              })}
            </Text>
          </TouchableOpacity>
        </View>
      ) : null,
    [handleShowEarlierMessages, hiddenSourceMessageCount, styles, t],
  );
  const listEmptyComponent = useMemo(
    () => (
      <AssistantStart
        hasProviderReady={hasProviderReady}
        onOpenProviderSetup={onOpenProviderSetup}
        onResumeConversation={onResumeConversation}
        onSelectStarter={handleComposerTextChange}
        providerName={providerName}
        recentConversation={recentConversation}
      />
    ),
    [
      handleComposerTextChange,
      hasProviderReady,
      onOpenProviderSetup,
      onResumeConversation,
      providerName,
      recentConversation,
    ],
  );
  const handleListLayout = useCallback(
    (event: LayoutChangeEvent) => {
      listMetricsRef.current.layoutHeight = event.nativeEvent.layout.height;
      updateAutoFollowState();
      syncLatestActivityPrompt();
    },
    [listMetricsRef, syncLatestActivityPrompt, updateAutoFollowState],
  );
  const handleListScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
      listMetricsRef.current = {
        contentHeight: contentSize.height,
        layoutHeight: layoutMeasurement.height,
        offsetY: contentOffset.y,
      };
      updateAutoFollowState();
      syncLatestActivityPrompt();
    },
    [listMetricsRef, syncLatestActivityPrompt, updateAutoFollowState],
  );
  const handleListScrollEndDrag = useCallback(() => {
    clearInteractionReleaseTimer();
    interactionReleaseTimerRef.current = setTimeout(() => {
      handleUserScrollEnd();
    }, USER_SCROLL_RELEASE_DELAY_MS);
  }, [clearInteractionReleaseTimer, handleUserScrollEnd, interactionReleaseTimerRef]);
  const handleContentSizeChange = useCallback(
    (_width: number, height: number) => {
      listMetricsRef.current.contentHeight = height;
      if (forceNextScrollRef.current || shouldAutoFollowRef.current) {
        maybeScrollToBottom(false);
      }
      syncLatestActivityPrompt();
    },
    [
      forceNextScrollRef,
      listMetricsRef,
      maybeScrollToBottom,
      shouldAutoFollowRef,
      syncLatestActivityPrompt,
    ],
  );
  const handleCancelEdit = useCallback(() => {
    setEditingMessageId(null);
    setEditingContent(undefined);
  }, [setEditingContent, setEditingMessageId]);

  return (
    <View style={styles.body}>
      <FlatList
        ref={flatListRef}
        data={resolvedDisplayMessages}
        keyExtractor={(item) => item.id}
        style={styles.flex}
        contentContainerStyle={[
          styles.messageList,
          resolvedDisplayMessages.length === 0 ? styles.messageListEmpty : null,
        ]}
        maxToRenderPerBatch={8}
        updateCellsBatchingPeriod={32}
        initialNumToRender={10}
        windowSize={7}
        removeClippedSubviews={Platform.OS === 'android'}
        maintainVisibleContentPosition={MAINTAIN_VISIBLE_CONTENT_POSITION}
        onLayout={handleListLayout}
        onScroll={handleListScroll}
        onScrollBeginDrag={handleUserScrollStart}
        onScrollEndDrag={handleListScrollEndDrag}
        onMomentumScrollBegin={handleUserScrollStart}
        onMomentumScrollEnd={handleUserScrollEnd}
        onContentSizeChange={handleContentSizeChange}
        scrollEventThrottle={16}
        renderItem={renderMessageItem}
        ListHeaderComponent={listHeaderComponent}
        ListEmptyComponent={listEmptyComponent}
      />
      <ChatLatestActivityButton
        bottomInset={bottomInset}
        colors={colors}
        onPress={handleJumpToLatest}
        t={t}
        visible={hasNewLatestActivity}
      />

      <ChatInput
        onSend={isEditing ? handleEditSend : handleSend}
        onStop={handleStop}
        isLoading={isConversationBusy}
        isInputDisabled={false}
        exactText={composerExactText}
        text={composerText}
        onChangeExactText={handleComposerExactTextChange}
        onChangeText={handleComposerTextChange}
        attachments={composerAttachments}
        onChangeAttachments={handleComposerAttachmentsChange}
        isEditing={isEditing}
        supportsVision={supportsVision}
        bottomInset={bottomInset}
        onCancelEdit={handleCancelEdit}
      />
    </View>
  );
}
