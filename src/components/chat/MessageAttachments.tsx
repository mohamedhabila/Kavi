import React from 'react';
import {
  Image,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from 'react-native';
import { FileText } from 'lucide-react-native';
import { Attachment } from '../../types';
import { AppPalette, useAppTheme } from '../../theme/useAppTheme';
import { useTranslation } from '../../i18n';
import { AudioAttachmentCard } from './AudioAttachmentCard';
import { isAudioAttachment } from '../../utils/messageAttachments';

interface MessageAttachmentsProps {
  attachments: Attachment[];
  isUser?: boolean;
  onOpenWorkspaceFile?: (path: string) => void;
  onShareWorkspaceFile?: (attachment: Attachment) => void;
}

function formatAttachmentSize(size: number): string | null {
  if (!Number.isFinite(size) || size <= 0) {
    return null;
  }

  if (size < 1024) {
    return `${Math.round(size)} B`;
  }

  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(size < 10 * 1024 ? 1 : 0)} KB`;
  }

  return `${(size / (1024 * 1024)).toFixed(size < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

function formatAttachmentMeta(attachment: Attachment): string | null {
  const parts = [attachment.mimeType?.trim() || null, formatAttachmentSize(attachment.size)].filter(
    Boolean,
  );
  return parts.length ? parts.join(' • ') : null;
}

function getAttachmentWorkspacePath(attachment: Attachment): string | undefined {
  return typeof attachment.workspacePath === 'string' && attachment.workspacePath.trim()
    ? attachment.workspacePath
    : undefined;
}

export const MessageAttachments: React.FC<MessageAttachmentsProps> = ({
  attachments,
  isUser = false,
  onOpenWorkspaceFile,
  onShareWorkspaceFile,
}) => {
  const { colors } = useAppTheme();
  const { t } = useTranslation();
  const { width: windowWidth } = useWindowDimensions();
  const resolvedWindowWidth = Number.isFinite(windowWidth) && windowWidth > 0 ? windowWidth : 360;
  const attachmentViewportWidth = Math.max(
    160,
    Math.floor(resolvedWindowWidth * (isUser ? 0.88 : 0.96)) - 24,
  );
  const imageCardWidth = Math.max(120, Math.min(176, attachmentViewportWidth));
  const fileCardWidth = Math.max(160, Math.min(220, attachmentViewportWidth));
  const styles = React.useMemo(
    () => createStyles(colors, isUser, attachmentViewportWidth, imageCardWidth, fileCardWidth),
    [attachmentViewportWidth, colors, fileCardWidth, imageCardWidth, isUser],
  );
  const [previewAttachment, setPreviewAttachment] = React.useState<Attachment | null>(null);

  if (!attachments.length) {
    return null;
  }

  const closePreview = () => setPreviewAttachment(null);

  const handleOpenWorkspaceFile = (attachment: Attachment) => {
    const workspacePath = getAttachmentWorkspacePath(attachment);
    if (!workspacePath || !onOpenWorkspaceFile) {
      return;
    }

    setPreviewAttachment(null);
    onOpenWorkspaceFile(workspacePath);
  };

  const handleShareWorkspaceFile = (attachment: Attachment) => {
    if (!getAttachmentWorkspacePath(attachment) || !onShareWorkspaceFile) {
      return;
    }

    setPreviewAttachment(null);
    onShareWorkspaceFile(attachment);
  };

  return (
    <>
      <View style={styles.container} testID="message-attachments">
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.content}
          style={styles.scrollViewport}
          bounces={false}
          nestedScrollEnabled
        >
          {attachments.map((attachment) => {
            const meta = formatAttachmentMeta(attachment);
            const workspacePath = getAttachmentWorkspacePath(attachment);
            const canOpenWorkspaceFile = !!workspacePath && !!onOpenWorkspaceFile;
            const canShareWorkspaceFile = !!workspacePath && !!onShareWorkspaceFile;
            const canPreviewInline = attachment.type === 'image';

            if (isAudioAttachment(attachment)) {
              return (
                <View
                  key={attachment.id}
                  style={[styles.attachmentColumn, styles.audioAttachmentColumn]}
                >
                  <AudioAttachmentCard attachment={attachment} isUser={isUser} />
                  {canOpenWorkspaceFile || canShareWorkspaceFile ? (
                    <View style={styles.actionRow}>
                      {canOpenWorkspaceFile ? (
                        <TouchableOpacity
                          style={styles.actionButton}
                          testID={`message-attachment-open-file-${attachment.id}`}
                          onPress={() => handleOpenWorkspaceFile(attachment)}
                          accessibilityRole="button"
                          accessibilityLabel={`Open ${attachment.name || 'attachment'} in Files`}
                        >
                          <Text style={styles.actionButtonText}>{t('common.files')}</Text>
                        </TouchableOpacity>
                      ) : null}
                      {canShareWorkspaceFile ? (
                        <TouchableOpacity
                          style={styles.actionButton}
                          testID={`message-attachment-share-file-${attachment.id}`}
                          onPress={() => handleShareWorkspaceFile(attachment)}
                          accessibilityRole="button"
                          accessibilityLabel={`Share ${attachment.name || 'attachment'}`}
                        >
                          <Text style={styles.actionButtonText}>{t('common.share')}</Text>
                        </TouchableOpacity>
                      ) : null}
                    </View>
                  ) : null}
                </View>
              );
            }

            if (attachment.type === 'image') {
              return (
                <View key={attachment.id} style={styles.attachmentColumn}>
                  <TouchableOpacity
                    activeOpacity={0.9}
                    style={styles.imageCard}
                    testID={`message-attachment-${attachment.id}`}
                    onPress={() => setPreviewAttachment(attachment)}
                    accessibilityRole="button"
                    accessibilityLabel={attachment.name || 'Image attachment'}
                  >
                    <Image
                      source={{ uri: attachment.uri }}
                      style={styles.image}
                      resizeMode="cover"
                      accessibilityLabel={attachment.name || 'Image attachment'}
                    />
                    <View style={styles.imageMeta}>
                      <Text style={styles.nameText} numberOfLines={1}>
                        {attachment.name}
                      </Text>
                      {meta ? (
                        <Text style={styles.metaText} numberOfLines={1}>
                          {meta}
                        </Text>
                      ) : null}
                    </View>
                  </TouchableOpacity>
                  {canOpenWorkspaceFile || canShareWorkspaceFile ? (
                    <View style={styles.actionRow}>
                      {canOpenWorkspaceFile ? (
                        <TouchableOpacity
                          style={styles.actionButton}
                          testID={`message-attachment-open-file-${attachment.id}`}
                          onPress={() => handleOpenWorkspaceFile(attachment)}
                          accessibilityRole="button"
                          accessibilityLabel={`Open ${attachment.name || 'attachment'} in Files`}
                        >
                          <Text style={styles.actionButtonText}>{t('common.files')}</Text>
                        </TouchableOpacity>
                      ) : null}
                      {canShareWorkspaceFile ? (
                        <TouchableOpacity
                          style={styles.actionButton}
                          testID={`message-attachment-share-file-${attachment.id}`}
                          onPress={() => handleShareWorkspaceFile(attachment)}
                          accessibilityRole="button"
                          accessibilityLabel={`Share ${attachment.name || 'attachment'}`}
                        >
                          <Text style={styles.actionButtonText}>{t('common.share')}</Text>
                        </TouchableOpacity>
                      ) : null}
                    </View>
                  ) : null}
                </View>
              );
            }

            return (
              <View key={attachment.id} style={styles.attachmentColumn}>
                <TouchableOpacity
                  activeOpacity={canOpenWorkspaceFile ? 0.85 : 1}
                  disabled={!canOpenWorkspaceFile && !canPreviewInline}
                  style={styles.fileCard}
                  testID={`message-attachment-${attachment.id}`}
                  onPress={() => {
                    if (workspacePath) {
                      handleOpenWorkspaceFile(attachment);
                    }
                  }}
                  accessibilityRole={canOpenWorkspaceFile ? 'button' : undefined}
                  accessibilityLabel={attachment.name || 'File attachment'}
                >
                  <View style={styles.fileIconWrap}>
                    <FileText size={18} color={isUser ? colors.onPrimary : colors.textSecondary} />
                  </View>
                  <View style={styles.fileTextWrap}>
                    <Text style={styles.nameText} numberOfLines={1}>
                      {attachment.name}
                    </Text>
                    {meta ? (
                      <Text style={styles.metaText} numberOfLines={1}>
                        {meta}
                      </Text>
                    ) : null}
                  </View>
                </TouchableOpacity>
                {canOpenWorkspaceFile || canShareWorkspaceFile ? (
                  <View style={styles.actionRow}>
                    {canOpenWorkspaceFile ? (
                      <TouchableOpacity
                        style={styles.actionButton}
                        testID={`message-attachment-open-file-${attachment.id}`}
                        onPress={() => handleOpenWorkspaceFile(attachment)}
                        accessibilityRole="button"
                        accessibilityLabel={`Open ${attachment.name || 'attachment'} in Files`}
                      >
                        <Text style={styles.actionButtonText}>{t('common.files')}</Text>
                      </TouchableOpacity>
                    ) : null}
                    {canShareWorkspaceFile ? (
                      <TouchableOpacity
                        style={styles.actionButton}
                        testID={`message-attachment-share-file-${attachment.id}`}
                        onPress={() => handleShareWorkspaceFile(attachment)}
                        accessibilityRole="button"
                        accessibilityLabel={`Share ${attachment.name || 'attachment'}`}
                      >
                        <Text style={styles.actionButtonText}>{t('common.share')}</Text>
                      </TouchableOpacity>
                    ) : null}
                  </View>
                ) : null}
              </View>
            );
          })}
        </ScrollView>
      </View>

      <Modal
        visible={!!previewAttachment}
        transparent
        animationType="fade"
        onRequestClose={closePreview}
      >
        <View style={styles.previewOverlay} testID="message-attachment-preview-modal">
          <TouchableOpacity
            style={styles.previewBackdrop}
            activeOpacity={1}
            onPress={closePreview}
          />
          {previewAttachment ? (
            <View style={styles.previewCard}>
              <View style={styles.previewHeader}>
                <View style={styles.previewTitleWrap}>
                  <Text style={styles.previewTitle} numberOfLines={1}>
                    {previewAttachment.name}
                  </Text>
                  {formatAttachmentMeta(previewAttachment) ? (
                    <Text style={styles.previewMeta} numberOfLines={1}>
                      {formatAttachmentMeta(previewAttachment)}
                    </Text>
                  ) : null}
                </View>
                <TouchableOpacity
                  style={styles.previewCloseButton}
                  onPress={closePreview}
                  accessibilityRole="button"
                  accessibilityLabel={t('common.close')}
                >
                  <Text style={styles.previewCloseText}>{t('common.close')}</Text>
                </TouchableOpacity>
              </View>
              <View style={styles.previewImageWrap}>
                <Image
                  source={{ uri: previewAttachment.uri }}
                  style={styles.previewImage}
                  resizeMode="contain"
                  testID="message-attachment-preview-image"
                  accessibilityLabel={previewAttachment.name || 'Image attachment'}
                />
              </View>
              {getAttachmentWorkspacePath(previewAttachment) &&
              (onOpenWorkspaceFile || onShareWorkspaceFile) ? (
                <View style={[styles.actionRow, styles.previewActionRow]}>
                  {onOpenWorkspaceFile ? (
                    <TouchableOpacity
                      style={[styles.actionButton, styles.previewActionButton]}
                      onPress={() => handleOpenWorkspaceFile(previewAttachment)}
                      accessibilityRole="button"
                      accessibilityLabel={`Open ${previewAttachment.name || 'attachment'} in Files`}
                    >
                      <Text style={styles.actionButtonText}>{t('common.files')}</Text>
                    </TouchableOpacity>
                  ) : null}
                  {onShareWorkspaceFile ? (
                    <TouchableOpacity
                      style={[styles.actionButton, styles.previewActionButton]}
                      testID={`message-attachment-share-file-${previewAttachment.id}`}
                      onPress={() => handleShareWorkspaceFile(previewAttachment)}
                      accessibilityRole="button"
                      accessibilityLabel={`Share ${previewAttachment.name || 'attachment'}`}
                    >
                      <Text style={styles.actionButtonText}>{t('common.share')}</Text>
                    </TouchableOpacity>
                  ) : null}
                </View>
              ) : null}
            </View>
          ) : null}
        </View>
      </Modal>
    </>
  );
};

const createStyles = (
  colors: AppPalette,
  isUser: boolean,
  attachmentViewportWidth: number,
  imageCardWidth: number,
  fileCardWidth: number,
) =>
  StyleSheet.create({
    container: {
      alignSelf: 'stretch',
      width: attachmentViewportWidth,
      maxWidth: '100%',
      minWidth: 0,
      flexShrink: 1,
      overflow: 'hidden',
    },
    scrollViewport: {
      width: '100%',
      maxWidth: '100%',
      minWidth: 0,
      flexShrink: 1,
    },
    content: {
      gap: 10,
      paddingVertical: 2,
      minWidth: attachmentViewportWidth,
    },
    attachmentColumn: {
      gap: 6,
      maxWidth: fileCardWidth,
      flexShrink: 1,
    },
    audioAttachmentColumn: {
      width: Math.min(Math.max(200, attachmentViewportWidth), 280),
      maxWidth: attachmentViewportWidth,
    },
    imageCard: {
      width: imageCardWidth,
      maxWidth: '100%',
      borderRadius: 12,
      overflow: 'hidden',
      backgroundColor: isUser ? 'rgba(255,255,255,0.12)' : colors.codeBackground,
      borderWidth: 1,
      borderColor: isUser ? 'rgba(255,255,255,0.18)' : colors.subtleBorder,
    },
    image: {
      width: '100%',
      height: 176,
      backgroundColor: isUser ? 'rgba(255,255,255,0.08)' : colors.surfaceAlt,
    },
    imageMeta: {
      paddingHorizontal: 10,
      paddingVertical: 8,
      gap: 2,
    },
    fileCard: {
      width: fileCardWidth,
      maxWidth: '100%',
      borderRadius: 12,
      borderWidth: 1,
      borderColor: isUser ? 'rgba(255,255,255,0.18)' : colors.subtleBorder,
      backgroundColor: isUser ? 'rgba(255,255,255,0.12)' : colors.codeBackground,
      paddingHorizontal: 12,
      paddingVertical: 10,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
    },
    fileIconWrap: {
      width: 32,
      height: 32,
      borderRadius: 10,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: isUser ? 'rgba(255,255,255,0.08)' : colors.surfaceAlt,
    },
    fileTextWrap: {
      flex: 1,
      minWidth: 0,
      gap: 2,
    },
    nameText: {
      color: isUser ? colors.onPrimary : colors.text,
      fontSize: 12,
      fontWeight: '600',
    },
    metaText: {
      color: isUser ? 'rgba(255,255,255,0.82)' : colors.textSecondary,
      fontSize: 11,
    },
    actionButton: {
      alignSelf: 'flex-start',
      borderRadius: 999,
      borderWidth: 1,
      borderColor: isUser ? 'rgba(255,255,255,0.22)' : colors.subtleBorder,
      backgroundColor: isUser ? 'rgba(255,255,255,0.12)' : colors.surfaceAlt,
      paddingHorizontal: 10,
      paddingVertical: 5,
    },
    actionRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8,
    },
    actionButtonText: {
      color: isUser ? colors.onPrimary : colors.text,
      fontSize: 11,
      fontWeight: '600',
    },
    previewOverlay: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.68)',
      justifyContent: 'center',
      padding: 20,
    },
    previewBackdrop: {
      ...StyleSheet.absoluteFillObject,
    },
    previewCard: {
      borderRadius: 18,
      overflow: 'hidden',
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      maxHeight: '86%',
    },
    previewHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingHorizontal: 16,
      paddingVertical: 14,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    previewTitleWrap: {
      flex: 1,
      minWidth: 0,
      gap: 2,
    },
    previewTitle: {
      color: colors.text,
      fontSize: 15,
      fontWeight: '700',
    },
    previewMeta: {
      color: colors.textSecondary,
      fontSize: 12,
    },
    previewCloseButton: {
      borderRadius: 999,
      paddingHorizontal: 12,
      paddingVertical: 7,
      backgroundColor: colors.surfaceAlt,
    },
    previewCloseText: {
      color: colors.text,
      fontSize: 12,
      fontWeight: '600',
    },
    previewImageWrap: {
      minHeight: 280,
      maxHeight: 520,
      paddingHorizontal: 12,
      paddingVertical: 12,
      backgroundColor: colors.codeBackground,
    },
    previewImage: {
      width: '100%',
      height: '100%',
      minHeight: 256,
      backgroundColor: colors.surfaceAlt,
    },
    previewActionRow: {
      padding: 12,
      paddingTop: 0,
    },
    previewActionButton: {
      marginTop: 0,
    },
  });
