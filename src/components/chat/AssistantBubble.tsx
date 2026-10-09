import React, { useMemo } from 'react';
import { ActivityIndicator, Alert, Animated, Text, View } from 'react-native';
import { AgentRun } from '../../types/agentRun';
import { Attachment } from '../../types/attachment';
import { Message } from '../../types/message';
import { useAppTheme } from '../../theme/useAppTheme';
import { useTranslation } from '../../i18n/useTranslation';
import { SubAgentActivityCard } from '../agents/SubAgentActivityCard';
import { AgentWorkflowSummary } from './AgentWorkflowSummary';
import { ThinkingBlock } from './ThinkingBlock';
import { ToolCallDisplay, humanizeToolName, summarizeToolCall } from './ToolCallDisplay';
import { FetchBatchProgress } from './FetchBatchProgress';
import {
  buildFetchBatchTargets,
  groupAssistantToolCalls,
  isFetchOnlyToolRun,
} from './fetchBatchGrouping';
import { ToolActivityGroup } from './ToolActivityGroup';
import type { CompressedTimelineItem, ToolActivityTimelineItem } from './toolActivityTimeline';
import TypingIndicator from './TypingIndicator';
import { MessageAttachments } from './MessageAttachments';
import { MessageContentRenderer } from './MessageContentRenderer';
import {
  buildAssistantBubbleTranscriptFileName,
  buildAssistantBubbleTranscriptMarkdown,
} from './assistantBubbleTranscript';
import { AssistantBubbleSegment, buildAssistantBubbleViewModel } from './assistantBubbleModel';
import { DisplayResponseSegment } from './messageGrouping';
import { shareTextExport } from '../../services/share/localShare';
import { createAssistantBubbleStyles } from './AssistantBubble.styles';
import { useAssistantBubbleEffects } from './useAssistantBubbleEffects';
import { AssistantBubbleActions } from './AssistantBubbleActions';
import { AssistantMemoryFeedback } from './AssistantMemoryFeedback';
import type { MemoryRetrievalFeedbackChoice } from '../../services/memory/retrievalOutcomeStore';
import { isMemoryRetrievalEventId } from '../../utils/assistantMessageMetadata';
import type { AgentRunExecutionPresentation } from '../../services/agents/activeConversationExecutionState';

interface AssistantBubbleProps {
  message: Message;
  agentRun?: AgentRun;
  agentRunExecutionPresentation?: AgentRunExecutionPresentation;
  isStreaming?: boolean;
  responseSegments?: Array<DisplayResponseSegment & { isStreaming?: boolean }>;
  onRetry?: (messageId: string) => void;
  onViewCanvas?: () => void;
  onViewFile?: (path: string) => void;
  onShareWorkspaceFile?: (attachment: Attachment) => void;
  onOpenSubAgentDetails?: (snapshot: NonNullable<Message['subAgentEvent']>['snapshot']) => void;
  memoryFeedbackMessageId?: string | null;
  onLoadMemoryFeedback?: (
    messageId: string,
    eventId: string,
  ) => Promise<MemoryRetrievalFeedbackChoice | null>;
  onMemoryFeedback?: (
    messageId: string,
    eventId: string,
    outcome: MemoryRetrievalFeedbackChoice,
  ) => Promise<MemoryRetrievalFeedbackChoice>;
  retryMessageId?: string;
}

export const AssistantBubble: React.FC<AssistantBubbleProps> = React.memo(
  ({
    message,
    agentRun,
    agentRunExecutionPresentation,
    isStreaming,
    responseSegments,
    onRetry,
    onViewCanvas,
    onViewFile,
    onShareWorkspaceFile,
    onOpenSubAgentDetails,
    memoryFeedbackMessageId,
    onLoadMemoryFeedback,
    onMemoryFeedback,
    retryMessageId,
  }) => {
    const { colors } = useAppTheme();
    const { t } = useTranslation();
    const styles = useMemo(() => createAssistantBubbleStyles(colors), [colors]);
    const assistantTitle = useMemo(() => t('settings.personaDisplayNamePlaceholder'), [t]);
    const bubbleModel = useMemo(
      () => buildAssistantBubbleViewModel({ message, responseSegments, isStreaming }),
      [isStreaming, message, responseSegments],
    );
    const hasRenderableContent = bubbleModel.timelineItems.length > 0;
    const streamingStatusText = useMemo(() => {
      if (!isStreaming) {
        return null;
      }

      if (bubbleModel.activeToolCall) {
        return (
          summarizeToolCall(bubbleModel.activeToolCall, t) ||
          humanizeToolName(bubbleModel.activeToolCall.name, t)
        );
      }

      return t('chat.workingOnIt');
    }, [bubbleModel.activeToolCall, isStreaming, t]);
    const reviewStatusText = useMemo(() => {
      if (
        isStreaming ||
        !agentRun ||
        agentRun.status !== 'running' ||
        (agentRunExecutionPresentation ?? 'running') !== 'running'
      ) {
        return null;
      }

      const activePhase = agentRun.phases.find((phase) => phase.key === agentRun.currentPhase);
      if (activePhase && activePhase.status !== 'active') {
        return null;
      }

      if (agentRun.currentPhase === 'review') {
        return t('chat.reviewingWork');
      }

      return null;
    }, [agentRun, agentRunExecutionPresentation, isStreaming, t]);
    const { bubbleAnimationStyle, effectDecorations } = useAssistantBubbleEffects({
      colors,
      effectId: message.effectId,
      styles,
    });
    const candidateMemoryRetrievalEventId =
      message.assistantMetadata?.kind === 'final' &&
      message.assistantMetadata.completionStatus === 'complete'
        ? message.assistantMetadata.memoryRetrievalEventId
        : undefined;
    const memoryRetrievalEventId = isMemoryRetrievalEventId(candidateMemoryRetrievalEventId)
      ? candidateMemoryRetrievalEventId
      : undefined;
    const exactMemoryFeedbackMessageId =
      memoryFeedbackMessageId === undefined ? message.id : memoryFeedbackMessageId;

    const handleShare = async () => {
      try {
        await shareTextExport({
          content: buildAssistantBubbleTranscriptMarkdown({
            message,
            responseSegments,
            isStreaming: false,
            assistantLabel: assistantTitle,
            t,
          }),
          fileName: buildAssistantBubbleTranscriptFileName(message),
          dialogTitle: t('chat.shareMessage'),
          mimeType: 'text/markdown',
        });
      } catch (error) {
        Alert.alert(
          t('common.error'),
          error instanceof Error ? error.message : t('chat.shareMessageFailed'),
        );
      }
    };

    const renderToolCall = (toolCall: NonNullable<Message['toolCalls']>[number]) => (
      <ToolCallDisplay
        key={toolCall.id}
        toolCall={toolCall}
        onViewCanvas={onViewCanvas}
        onViewFile={onViewFile}
      />
    );

    // A research turn issues a dozen fetches; one row each buries the rest of the
    // transcript and shows the reader the least useful thing about them.
    const renderToolCalls = (toolCalls?: NonNullable<Message['toolCalls']>) =>
      groupAssistantToolCalls(toolCalls).map((group) =>
        group.kind === 'single' ? (
          renderToolCall(group.toolCall)
        ) : (
          <FetchBatchProgress key={group.toolCalls[0]!.id} targets={group.targets}>
            {group.toolCalls.map(renderToolCall)}
          </FetchBatchProgress>
        ),
      );

    // Folded steps render flat inside their single group, so the work is one expansion
    // away — never a group nested inside another group.
    const renderToolActivity = (item: ToolActivityTimelineItem) => {
      const steps = item.steps.map((step) =>
        step.kind === 'reasoning' ? (
          <ThinkingBlock
            key={step.id}
            reasoning={step.item.reasoning}
            isStreaming={step.item.isStreaming}
          />
        ) : (
          <React.Fragment key={step.id}>{step.toolCalls.map(renderToolCall)}</React.Fragment>
        ),
      );
      return isFetchOnlyToolRun(item.toolCalls) ? (
        <FetchBatchProgress targets={buildFetchBatchTargets(item.toolCalls)}>
          {steps}
        </FetchBatchProgress>
      ) : (
        <ToolActivityGroup toolCalls={item.toolCalls}>{steps}</ToolActivityGroup>
      );
    };

    const renderContentSegment = (segment: AssistantBubbleSegment) => {
      if (segment.subAgentEvent) {
        return (
          <>
            <SubAgentActivityCard
              snapshot={segment.subAgentEvent.snapshot}
              event={segment.subAgentEvent.event}
              visualDepth={segment.subAgentEvent.snapshot.depth}
              variant="transcript"
              showOpenDetailsAction={!!onOpenSubAgentDetails}
              onOpenDetails={onOpenSubAgentDetails}
            />
            {segment.attachments?.length ? (
              <MessageAttachments
                attachments={segment.attachments}
                isUser={false}
                onOpenWorkspaceFile={onViewFile}
                onShareWorkspaceFile={onShareWorkspaceFile}
              />
            ) : null}
            {renderToolCalls(segment.toolCalls)}
          </>
        );
      }

      return (
        <>
          <MessageContentRenderer
            content={segment.content}
            isUser={false}
            messageId={segment.messageId}
            streaming={segment.isStreaming}
          />
          {segment.attachments?.length ? (
            <MessageAttachments
              attachments={segment.attachments}
              isUser={false}
              onOpenWorkspaceFile={onViewFile}
              onShareWorkspaceFile={onShareWorkspaceFile}
            />
          ) : null}
          {renderToolCalls(segment.toolCalls)}
          {segment.isError ? (
            <View style={styles.errorBadge}>
              <Text style={styles.errorText}>{t('common.error')}</Text>
            </View>
          ) : null}
        </>
      );
    };

    const renderTimelineItem = (item: CompressedTimelineItem, index: number) => {
      const previousItem = bubbleModel.timelineItems[index - 1];
      const startsNewSegment =
        !!previousItem && previousItem.sourceSegmentId !== item.sourceSegmentId;

      return (
        <View
          key={item.id}
          style={[styles.responseSegment, startsNewSegment ? styles.responseSegmentSpaced : null]}
          testID={item.kind === 'reasoning' ? 'assistant-inline-reasoning' : undefined}
        >
          {item.kind === 'reasoning' ? (
            <ThinkingBlock reasoning={item.reasoning} isStreaming={item.isStreaming} />
          ) : item.kind === 'tool_activity' ? (
            renderToolActivity(item)
          ) : (
            renderContentSegment(item.segment)
          )}
        </View>
      );
    };

    const inlineResponseContent = hasRenderableContent ? (
      <View style={styles.responseGroup}>{bubbleModel.timelineItems.map(renderTimelineItem)}</View>
    ) : null;

    const bubbleMainContent = inlineResponseContent ? (
      <>
        {bubbleModel.contentWarnings.usesPlainTextFallback ? (
          <View style={styles.contentNotice}>
            <Text style={styles.contentNoticeText}>{t('chat.plainTextFallback')}</Text>
          </View>
        ) : null}
        {bubbleModel.contentWarnings.hasTruncatedContent ? (
          <View style={styles.contentNotice}>
            <Text style={styles.contentNoticeText}>{t('chat.responseTruncated')}</Text>
          </View>
        ) : null}
        <View style={styles.assistantContentContainer} testID="assistant-content-container">
          {inlineResponseContent}
        </View>
      </>
    ) : isStreaming ? (
      <TypingIndicator color={colors.accent ?? colors.primary} />
    ) : null;

    return (
      <View style={[styles.wrapper, styles.assistantWrapper]} testID="message-assistant-wrapper">
        {agentRun ? (
          <AgentWorkflowSummary
            run={agentRun}
            executionPresentation={agentRunExecutionPresentation}
          />
        ) : null}
        <Animated.View
          style={[styles.bubble, styles.assistantBubble, bubbleAnimationStyle]}
          testID="message-assistant-bubble"
        >
          {effectDecorations}
          <View style={styles.assistantChrome} testID="assistant-bubble-chrome">
            <View style={styles.assistantChromeIdentity}>
              <View
                style={[
                  styles.assistantChromeDot,
                  isStreaming ? styles.assistantChromeDotStreaming : null,
                ]}
              />
              <Text style={styles.assistantChromeLabel}>{assistantTitle}</Text>
            </View>
            {streamingStatusText ? (
              <View style={styles.assistantStatusPill} testID="assistant-bubble-status-pill">
                <ActivityIndicator size="small" color={colors.primary} />
                <Text style={styles.assistantStatusPillText} numberOfLines={1}>
                  {streamingStatusText}
                </Text>
              </View>
            ) : null}
          </View>
          {bubbleMainContent}
          {reviewStatusText ? (
            <View style={styles.reviewFooter}>
              <View style={styles.reviewPill} testID="assistant-bubble-review-indicator">
                <ActivityIndicator size="small" color={colors.info ?? colors.primary} />
                <Text style={styles.reviewPillText}>{reviewStatusText}</Text>
              </View>
            </View>
          ) : null}
        </Animated.View>

        {!isStreaming ? (
          <>
            <AssistantBubbleActions
              canShare={bubbleModel.timelineItems.length > 0}
              colors={colors}
              copyText={bubbleModel.copyText}
              onRetry={onRetry ? () => onRetry(retryMessageId || message.id) : undefined}
              onShare={handleShare}
              styles={styles}
              t={t}
            />
            {memoryRetrievalEventId && exactMemoryFeedbackMessageId && onMemoryFeedback ? (
              <AssistantMemoryFeedback
                eventId={memoryRetrievalEventId}
                messageId={exactMemoryFeedbackMessageId}
                onLoad={onLoadMemoryFeedback}
                onSubmit={onMemoryFeedback}
                styles={styles}
                t={t}
              />
            ) : null}
          </>
        ) : null}
      </View>
    );
  },
);

AssistantBubble.displayName = 'AssistantBubble';
