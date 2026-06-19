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

type TranslationFn = (key: string, params?: Record<string, string | number>) => string;

type ChatScreenConversationPaneProps = {
  bottomInset: number;
  colors: AppPalette;
  composerAttachments: Attachment[];
  composerText: string;
  forceNextScrollRef: MutableRefObject<boolean>;
  handleComposerAttachmentsChange: (attachments: Attachment[]) => void;
  handleComposerTextChange: (text: string) => void;
  handleEdit: (messageId: string, content: string) => void;
  handleEditSend: (text: string, attachments?: Attachment[]) => void;
  handleOpenSubAgentDetails: (snapshot: NonNullable<Message['subAgentEvent']>['snapshot']) => void;
  handleRetry: (messageId: string) => void;
  handleSend: (text: string, attachments?: Attachment[]) => Promise<void>;
  handleShareWorkspaceFile: (attachment: Attachment) => Promise<void>;
  handleShowEarlierMessages: () => void;
  handleStop: () => void;
  handleUserScrollEnd: () => void;
  handleUserScrollStart: () => void;
  handleViewFiles: (path?: string) => void;
  hiddenSourceMessageCount: number;
  interactionReleaseTimerRef: MutableRefObject<ReturnType<typeof setTimeout> | null>;
  isConversationBusy: boolean;
  isEditing: boolean;
  listMetricsRef: MutableRefObject<{
    contentHeight: number;
    layoutHeight: number;
    offsetY: number;
  }>;
  maybeScrollToBottom: (animated: boolean) => void;
  personaSwitchMarkersByMessageId: Map<string, PersonaSwitchMarker>;
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
    composerText,
    flatListRef,
    forceNextScrollRef,
    handleComposerAttachmentsChange,
    handleComposerTextChange,
    handleEdit,
    handleEditSend,
    handleOpenSubAgentDetails,
    handleRetry,
    handleSend,
    handleShareWorkspaceFile,
    handleShowEarlierMessages,
    handleStop,
    handleUserScrollEnd,
    handleUserScrollStart,
    handleViewFiles,
    hiddenSourceMessageCount,
    interactionReleaseTimerRef,
    isConversationBusy,
    isEditing,
    listMetricsRef,
    maybeScrollToBottom,
    personaSwitchMarkersByMessageId,
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
    handleRetry,
    handleShareWorkspaceFile,
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
      <View style={styles.emptyState}>
        <Text style={styles.emptyTitle}>{t('common.appName')}</Text>
        <Text style={styles.emptyHint}>{t('chat.emptyStateHint')}</Text>
      </View>
    ),
    [styles, t],
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
      if (streamingMessageId) {
        if (forceNextScrollRef.current || shouldAutoFollowRef.current) {
          scrollToBottom(false);
          forceNextScrollRef.current = false;
        }
      } else if (forceNextScrollRef.current || shouldAutoFollowRef.current) {
        maybeScrollToBottom(false);
      }
      syncLatestActivityPrompt();
    },
    [
      forceNextScrollRef,
      listMetricsRef,
      maybeScrollToBottom,
      scrollToBottom,
      shouldAutoFollowRef,
      syncLatestActivityPrompt,
      streamingMessageId,
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
        maintainVisibleContentPosition={{ minIndexForVisible: 0 }}
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
        text={composerText}
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
