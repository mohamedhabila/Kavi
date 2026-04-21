import React, { useEffect, useMemo, useRef } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  Easing,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { Copy, RotateCcw, Share2 } from 'lucide-react-native';
import { AgentRun, Attachment, Message } from '../../types';
import { useAppTheme, AppPalette } from '../../theme/useAppTheme';
import { useTranslation } from '../../i18n';
import { SubAgentActivityCard } from '../agents/SubAgentActivityCard';
import { AgentWorkflowWidget } from './AgentWorkflowWidget';
import { ThinkingBlock } from './ThinkingBlock';
import { ToolCallDisplay, humanizeToolName, summarizeToolCall } from './ToolCallDisplay';
import TypingIndicator from './TypingIndicator';
import { MessageAttachments } from './MessageAttachments';
import { MessageContentRenderer } from './MessageContentRenderer';
import {
  buildAssistantBubbleTranscriptFileName,
  buildAssistantBubbleTranscriptMarkdown,
} from './assistantBubbleTranscript';
import {
  AssistantBubbleSegment,
  AssistantBubbleTimelineItem,
  buildAssistantBubbleViewModel,
} from './assistantBubbleModel';
import { DisplayResponseSegment } from './messageGrouping';
import { shareTextExport } from '../../services/share/localShare';

interface AssistantBubbleProps {
  message: Message;
  agentRun?: AgentRun;
  isStreaming?: boolean;
  responseSegments?: Array<DisplayResponseSegment & { isStreaming?: boolean }>;
  onRetry?: (messageId: string) => void;
  onViewFile?: (path: string) => void;
  onShareWorkspaceFile?: (attachment: Attachment) => void;
  onOpenSubAgentDetails?: (snapshot: NonNullable<Message['subAgentEvent']>['snapshot']) => void;
  retryMessageId?: string;
}

export const AssistantBubble: React.FC<AssistantBubbleProps> = React.memo(
  ({
    message,
    agentRun,
    isStreaming,
    responseSegments,
    onRetry,
    onViewFile,
    onShareWorkspaceFile,
    onOpenSubAgentDetails,
    retryMessageId,
  }) => {
    const { colors } = useAppTheme();
    const { t } = useTranslation();
    const styles = useMemo(() => createStyles(colors), [colors]);
    const effectProgress = useRef(new Animated.Value(message.effectId ? 0 : 1)).current;
    const previousEffectIdRef = useRef<Message['effectId']>(message.effectId);
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
      if (isStreaming || !agentRun || agentRun.status !== 'running') {
        return null;
      }

      const activePhase = agentRun.phases.find((phase) => phase.key === agentRun.currentPhase);
      if (activePhase && activePhase.status !== 'active') {
        return null;
      }

      if (agentRun.currentPhase === 'review') {
        return t('chat.reviewingWork');
      }

      if (agentRun.currentPhase === 'pilot') {
        return t('chat.pilotReviewingWork');
      }

      return null;
    }, [agentRun, isStreaming, t]);

    useEffect(() => {
      if (!message.effectId) {
        if (previousEffectIdRef.current) {
          effectProgress.setValue(1);
        }
        previousEffectIdRef.current = message.effectId;
        return;
      }

      previousEffectIdRef.current = message.effectId;
      effectProgress.setValue(0);
      Animated.timing(effectProgress, {
        toValue: 1,
        duration: 900,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start();
    }, [effectProgress, message.effectId]);

    const bubbleAnimationStyle = useMemo(
      () => ({
        opacity: effectProgress.interpolate({
          inputRange: [0, 1],
          outputRange: [0.72, 1],
        }),
        transform: [
          {
            scale: effectProgress.interpolate({
              inputRange: [0, 1],
              outputRange: [0.96, 1],
            }),
          },
        ],
      }),
      [effectProgress],
    );

    const effectDecorations = useMemo(() => {
      if (message.effectId === 'confetti') {
        return Array.from({ length: 6 }, (_, index) => {
          const translateY = effectProgress.interpolate({
            inputRange: [0, 1],
            outputRange: [-10 - index * 4, 12 + index * 2],
          });
          const translateX = effectProgress.interpolate({
            inputRange: [0, 1],
            outputRange: [index % 2 === 0 ? -8 : 8, index % 2 === 0 ? 10 : -10],
          });
          return (
            <Animated.View
              key={`confetti-${index}`}
              testID={index === 0 ? 'message-effect-confetti' : undefined}
              style={[
                styles.effectDot,
                {
                  backgroundColor:
                    index % 3 === 0
                      ? colors.primary
                      : index % 3 === 1
                        ? colors.link
                        : colors.textSecondary,
                  left: 12 + index * 14,
                  transform: [{ translateX }, { translateY }],
                  opacity: effectProgress.interpolate({
                    inputRange: [0, 1],
                    outputRange: [0.9, 0],
                  }),
                },
              ]}
            />
          );
        });
      }

      if (message.effectId === 'balloons') {
        return Array.from({ length: 3 }, (_, index) => {
          const translateY = effectProgress.interpolate({
            inputRange: [0, 1],
            outputRange: [18 + index * 10, -20 - index * 6],
          });
          return (
            <Animated.View
              key={`balloon-${index}`}
              testID={index === 0 ? 'message-effect-balloons' : undefined}
              style={[
                styles.effectBalloon,
                {
                  backgroundColor:
                    index === 0 ? colors.primary : index === 1 ? colors.link : colors.textSecondary,
                  right: 12 + index * 24,
                  transform: [{ translateY }],
                  opacity: effectProgress.interpolate({
                    inputRange: [0, 1],
                    outputRange: [0.5, 0],
                  }),
                },
              ]}
            />
          );
        });
      }

      if (message.effectId === 'spotlight') {
        return [
          <Animated.View
            key="spotlight"
            testID="message-effect-spotlight"
            style={[
              styles.effectSpotlight,
              {
                opacity: effectProgress.interpolate({
                  inputRange: [0, 1],
                  outputRange: [0.32, 0.08],
                }),
                transform: [
                  {
                    scale: effectProgress.interpolate({
                      inputRange: [0, 1],
                      outputRange: [0.92, 1.08],
                    }),
                  },
                ],
              },
            ]}
          />,
        ];
      }

      return [];
    }, [colors, effectProgress, message.effectId, styles]);

    const handleCopy = () => {
      if (bubbleModel.copyText) {
        Clipboard.setStringAsync(bubbleModel.copyText);
      }
    };

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

    const renderToolCalls = (toolCalls?: NonNullable<Message['toolCalls']>) =>
      toolCalls?.map((toolCall) => (
        <ToolCallDisplay key={toolCall.id} toolCall={toolCall} onViewFile={onViewFile} />
      ));

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

    const renderTimelineItem = (item: AssistantBubbleTimelineItem, index: number) => {
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
      <View style={[styles.wrapper, styles.assistantWrapper]}>
        {agentRun ? (
          <View style={styles.agentWorkflowSurface}>
            <AgentWorkflowWidget run={agentRun} />
          </View>
        ) : null}
        <Animated.View style={[styles.bubble, styles.assistantBubble, bubbleAnimationStyle]}>
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
          <View style={[styles.actions, styles.actionsLeft]}>
            <TouchableOpacity
              onPress={handleCopy}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={t('chat.copyMessage')}
            >
              <Copy size={14} color={colors.textTertiary} />
            </TouchableOpacity>
            {bubbleModel.timelineItems.length ? (
              <TouchableOpacity
                onPress={handleShare}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel={t('chat.shareMessage')}
              >
                <Share2 size={14} color={colors.textTertiary} />
              </TouchableOpacity>
            ) : null}
            {onRetry ? (
              <TouchableOpacity
                onPress={() => onRetry(retryMessageId || message.id)}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel={t('chat.retryMessage')}
              >
                <RotateCcw size={14} color={colors.textTertiary} />
              </TouchableOpacity>
            ) : null}
          </View>
        ) : null}
      </View>
    );
  },
);

AssistantBubble.displayName = 'AssistantBubble';

const createStyles = (colors: AppPalette) =>
  StyleSheet.create({
    wrapper: {
      paddingHorizontal: 12,
      paddingVertical: 4,
    },
    assistantWrapper: {
      alignItems: 'flex-start',
    },
    bubble: {
      borderRadius: 16,
      padding: 12,
      overflow: 'hidden',
      minWidth: 0,
      flexGrow: 0,
      flexShrink: 1,
    },
    assistantBubble: {
      backgroundColor: colors.assistantBubble,
      borderWidth: 1,
      borderColor: colors.border,
      borderBottomLeftRadius: 8,
      minWidth: '78%',
      maxWidth: '96%',
      shadowColor: colors.mode === 'dark' ? '#000000' : colors.text,
      shadowOpacity: colors.mode === 'dark' ? 0.22 : 0.08,
      shadowRadius: 16,
      shadowOffset: { width: 0, height: 6 },
      elevation: 3,
    },
    assistantContentContainer: {
      minWidth: 0,
      alignSelf: 'stretch',
      gap: 8,
    },
    agentWorkflowSurface: {
      maxWidth: '96%',
      minWidth: '72%',
      marginBottom: 6,
    },
    responseGroup: {
      gap: 4,
      minWidth: 0,
      alignSelf: 'stretch',
    },
    responseSegment: {
      minWidth: 0,
      alignSelf: 'stretch',
    },
    responseSegmentSpaced: {
      marginTop: 8,
      paddingTop: 8,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.subtleBorder,
    },
    assistantChrome: {
      marginHorizontal: -12,
      marginTop: -12,
      marginBottom: 12,
      paddingHorizontal: 12,
      paddingVertical: 10,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 10,
      backgroundColor: colors.surfaceAlt,
      borderBottomWidth: 1,
      borderBottomColor: colors.subtleBorder,
    },
    assistantChromeIdentity: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      minWidth: 0,
      flexShrink: 1,
    },
    assistantChromeDot: {
      width: 8,
      height: 8,
      borderRadius: 999,
      backgroundColor: colors.primary,
      opacity: 0.8,
    },
    assistantChromeDotStreaming: {
      opacity: 1,
    },
    assistantChromeLabel: {
      fontSize: 11,
      fontWeight: '700',
      letterSpacing: 0.6,
      textTransform: 'uppercase',
      color: colors.textSecondary,
    },
    assistantStatusPill: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      minWidth: 0,
      maxWidth: '72%',
      paddingHorizontal: 10,
      paddingVertical: 6,
      borderRadius: 999,
      borderWidth: 1,
      borderColor: colors.subtleBorder,
      backgroundColor: colors.primarySoft,
    },
    assistantStatusPillText: {
      flexShrink: 1,
      color: colors.text,
      fontSize: 12,
      fontWeight: '600',
    },
    contentNotice: {
      borderRadius: 12,
      paddingHorizontal: 12,
      paddingVertical: 10,
      marginBottom: 8,
      backgroundColor: colors.surfaceAlt,
      borderWidth: 1,
      borderColor: colors.subtleBorder,
    },
    contentNoticeText: {
      color: colors.textSecondary,
      fontSize: 13,
      lineHeight: 18,
    },
    reviewFooter: {
      marginTop: 12,
      paddingTop: 10,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.subtleBorder,
    },
    reviewPill: {
      flexDirection: 'row',
      alignItems: 'center',
      alignSelf: 'flex-start',
      gap: 8,
      minWidth: 0,
      paddingHorizontal: 10,
      paddingVertical: 7,
      borderRadius: 999,
      borderWidth: 1,
      borderColor: colors.subtleBorder,
      backgroundColor: colors.surfaceAlt,
    },
    reviewPillText: {
      flexShrink: 1,
      color: colors.textSecondary,
      fontSize: 12,
      fontWeight: '600',
    },
    effectDot: {
      position: 'absolute',
      top: 0,
      width: 8,
      height: 8,
      borderRadius: 4,
    },
    effectBalloon: {
      position: 'absolute',
      bottom: -4,
      width: 16,
      height: 20,
      borderRadius: 10,
    },
    effectSpotlight: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: colors.primarySoft,
      borderRadius: 16,
    },
    errorBadge: {
      backgroundColor: colors.dangerSoft,
      borderRadius: 4,
      paddingHorizontal: 6,
      paddingVertical: 2,
      marginTop: 6,
      alignSelf: 'flex-start',
    },
    errorText: {
      color: colors.danger,
      fontSize: 11,
      fontWeight: '600',
    },
    actions: {
      flexDirection: 'row',
      gap: 12,
      marginTop: 4,
      paddingHorizontal: 4,
    },
    actionsLeft: {
      justifyContent: 'flex-start',
    },
  });
