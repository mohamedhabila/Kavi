import React, { useMemo } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { Copy, Edit2 } from 'lucide-react-native';
import { AgentRun, Attachment, Message } from '../../types';
import { useAppTheme, AppPalette } from '../../theme/useAppTheme';
import { useTranslation } from '../../i18n';
import { stripInternalUserTranscriptArtifacts } from '../../utils/assistantTextSanitizer';
import { getPrimaryAudioAttachment } from '../../utils/messageAttachments';
import { AssistantBubble } from './AssistantBubble';
import { MessageAttachments } from './MessageAttachments';
import { MessageContentRenderer } from './MessageContentRenderer';
import { DisplayResponseSegment } from './messageGrouping';

interface MessageBubbleProps {
  message: Message;
  agentRun?: AgentRun;
  isStreaming?: boolean;
  responseSegments?: Array<DisplayResponseSegment & { isStreaming?: boolean }>;
  onEdit?: (id: string, content: string) => void;
  onRetry?: (messageId: string) => void;
  onViewFile?: (path: string) => void;
  onShareWorkspaceFile?: (attachment: Attachment) => void;
  onOpenSubAgentDetails?: (snapshot: NonNullable<Message['subAgentEvent']>['snapshot']) => void;
  retryMessageId?: string;
}

export const MessageBubble: React.FC<MessageBubbleProps> = React.memo(
  ({
    message,
    agentRun,
    isStreaming,
    responseSegments,
    onEdit,
    onRetry,
    onViewFile,
    onShareWorkspaceFile,
    onOpenSubAgentDetails,
    retryMessageId,
  }) => {
    const { colors } = useAppTheme();
    const { t } = useTranslation();
    const styles = useMemo(() => createStyles(colors), [colors]);
    const visibleUserContent = useMemo(
      () => stripInternalUserTranscriptArtifacts(message.content),
      [message.content],
    );
    const primaryAudioAttachment = useMemo(
      () => getPrimaryAudioAttachment(message.attachments),
      [message.attachments],
    );
    const shouldHidePlainUserText =
      message.role === 'user' &&
      !!primaryAudioAttachment &&
      visibleUserContent.trim().length > 0 &&
      visibleUserContent.trim() ===
        (primaryAudioAttachment.transcript?.trim() || visibleUserContent.trim());

    if (message.role === 'tool') {
      return null;
    }

    if (message.role === 'assistant') {
      return (
        <AssistantBubble
          message={message}
          agentRun={agentRun}
          isStreaming={isStreaming}
          responseSegments={responseSegments}
          onRetry={onRetry}
          onViewFile={onViewFile}
          onShareWorkspaceFile={onShareWorkspaceFile}
          onOpenSubAgentDetails={onOpenSubAgentDetails}
          retryMessageId={retryMessageId}
        />
      );
    }

    const handleCopy = () => {
      if (visibleUserContent) {
        Clipboard.setStringAsync(visibleUserContent);
      }
    };

    return (
      <View style={[styles.wrapper, styles.userWrapper]}>
        <View style={[styles.bubble, styles.userBubble]}>
          <View style={styles.contentStack}>
            {message.attachments?.length ? (
              <MessageAttachments
                attachments={message.attachments}
                isUser={true}
                onOpenWorkspaceFile={onViewFile}
                onShareWorkspaceFile={onShareWorkspaceFile}
              />
            ) : null}
            {!shouldHidePlainUserText && visibleUserContent ? (
              <MessageContentRenderer
                content={visibleUserContent}
                isUser={true}
                messageId={message.id}
              />
            ) : null}
          </View>

          {message.isError ? (
            <View style={styles.errorBadge}>
              <Text style={styles.errorText}>{t('common.error')}</Text>
            </View>
          ) : null}
        </View>

        {!isStreaming ? (
          <View style={[styles.actions, styles.actionsRight]}>
            <TouchableOpacity
              onPress={handleCopy}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={t('chat.copyMessage')}
            >
              <Copy size={14} color={colors.textTertiary} />
            </TouchableOpacity>
            {onEdit ? (
              <TouchableOpacity
                onPress={() => onEdit(message.id, visibleUserContent)}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel={t('chat.editMessage')}
              >
                <Edit2 size={14} color={colors.textTertiary} />
              </TouchableOpacity>
            ) : null}
          </View>
        ) : null}
      </View>
    );
  },
);

MessageBubble.displayName = 'MessageBubble';

const createStyles = (colors: AppPalette) =>
  StyleSheet.create({
    wrapper: {
      paddingHorizontal: 12,
      paddingVertical: 4,
    },
    userWrapper: {
      alignItems: 'flex-end',
    },
    bubble: {
      maxWidth: '88%',
      borderRadius: 16,
      padding: 12,
      overflow: 'hidden',
      minWidth: 0,
      flexGrow: 0,
      flexShrink: 1,
    },
    userBubble: {
      backgroundColor: colors.userBubble,
      borderBottomRightRadius: 4,
    },
    contentStack: {
      gap: 10,
      minWidth: 0,
      alignSelf: 'stretch',
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
    actionsRight: {
      justifyContent: 'flex-end',
    },
  });
