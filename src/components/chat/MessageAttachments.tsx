import React, { useMemo, useState } from 'react';
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

import { ArtifactCard } from '../artifacts/ArtifactCard';
import { useTranslation } from '../../i18n/useTranslation';
import { redactSensitiveText } from '../../services/security/toolDetailRedaction';
import { useAppTheme, type AppPalette } from '../../theme/useAppTheme';
import type { Attachment } from '../../types/attachment';

interface MessageAttachmentsProps {
  attachments: Attachment[];
  isUser?: boolean;
  onOpenWorkspaceFile?: (path: string) => void;
  onShareWorkspaceFile?: (attachment: Attachment) => void;
}

function getAttachmentWorkspacePath(attachment: Attachment): string | undefined {
  return typeof attachment.workspacePath === 'string' && attachment.workspacePath.trim()
    ? attachment.workspacePath.trim()
    : undefined;
}

function getSafeAttachmentName(attachment: Attachment, fallback: string): string {
  const name = typeof attachment.name === 'string' ? attachment.name : '';
  const safeName = redactSensitiveText(name)
    .replace(/[\u0000-\u001f\u007f-\u009f]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
    .slice(0, 160);
  return safeName || fallback;
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
  const artifactCardWidth = Math.max(220, Math.min(280, attachmentViewportWidth));
  const styles = useMemo(
    () => createStyles(colors, isUser, attachmentViewportWidth),
    [attachmentViewportWidth, colors, isUser],
  );
  const [previewAttachment, setPreviewAttachment] = useState<Attachment | null>(null);

  if (!attachments.length) return null;

  const closePreview = () => setPreviewAttachment(null);

  const handleOpenWorkspaceFile = (attachment: Attachment) => {
    const workspacePath = getAttachmentWorkspacePath(attachment);
    if (!workspacePath || !onOpenWorkspaceFile) return;
    setPreviewAttachment(null);
    onOpenWorkspaceFile(workspacePath);
  };

  const handleShareWorkspaceFile = (attachment: Attachment) => {
    if (!getAttachmentWorkspacePath(attachment) || !onShareWorkspaceFile) return;
    setPreviewAttachment(null);
    onShareWorkspaceFile(attachment);
  };

  const cards = attachments.map((attachment) => {
    const workspacePath = getAttachmentWorkspacePath(attachment);
    const canOpen = !!workspacePath && !!onOpenWorkspaceFile;
    const canShare = !!workspacePath && !!onShareWorkspaceFile;
    const canPreview =
      attachment.type === 'image' || attachment.mimeType?.toLowerCase().startsWith('image/') === true;

    return (
      <ArtifactCard
        key={attachment.id}
        artifact={attachment}
        isUser={isUser}
        width={artifactCardWidth}
        onPreview={canPreview ? () => setPreviewAttachment(attachment) : undefined}
        onOpen={canOpen ? () => handleOpenWorkspaceFile(attachment) : undefined}
        onShare={canShare ? () => handleShareWorkspaceFile(attachment) : undefined}
      />
    );
  });

  const previewName = previewAttachment
    ? getSafeAttachmentName(previewAttachment, t('artifactCard.untitled'))
    : '';

  return (
    <>
      <View style={styles.container} testID="message-attachments">
        {cards.length > 1 ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.content}
            style={styles.scrollViewport}
            bounces={false}
            nestedScrollEnabled
            accessibilityLabel={t('artifactCard.collectionLabel', { count: cards.length })}
          >
            {cards}
          </ScrollView>
        ) : (
          <View style={styles.singleContent}>{cards}</View>
        )}
      </View>

      <Modal
        visible={!!previewAttachment}
        transparent
        animationType="fade"
        onRequestClose={closePreview}
        statusBarTranslucent
      >
        <View
          style={styles.previewOverlay}
          accessibilityViewIsModal
          testID="message-attachment-preview-modal"
        >
          <TouchableOpacity
            style={styles.previewBackdrop}
            activeOpacity={1}
            onPress={closePreview}
            accessible={false}
          />
          {previewAttachment ? (
            <View style={styles.previewCard}>
              <View style={styles.previewHeader}>
                <View style={styles.previewTitleWrap}>
                  <Text style={styles.previewTitle} numberOfLines={2}>
                    {previewName}
                  </Text>
                  <Text style={styles.previewMeta}>
                    {isUser ? t('artifactCard.addedByYou') : t('artifactCard.createdInChat')}
                  </Text>
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
                  accessibilityLabel={t('artifactCard.imageLabel', { name: previewName })}
                />
              </View>
              {getAttachmentWorkspacePath(previewAttachment) &&
              (onOpenWorkspaceFile || onShareWorkspaceFile) ? (
                <View style={styles.previewActions}>
                  {onOpenWorkspaceFile ? (
                    <PreviewAction
                      label={t('common.open')}
                      accessibilityLabel={t('artifactCard.openLabel', { name: previewName })}
                      onPress={() => handleOpenWorkspaceFile(previewAttachment)}
                      styles={styles}
                    />
                  ) : null}
                  {onShareWorkspaceFile ? (
                    <PreviewAction
                      label={t('artifactCard.shareOrSave')}
                      accessibilityLabel={t('artifactCard.shareLabel', { name: previewName })}
                      onPress={() => handleShareWorkspaceFile(previewAttachment)}
                      styles={styles}
                    />
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

type MessageAttachmentStyles = ReturnType<typeof createStyles>;

const PreviewAction: React.FC<{
  label: string;
  accessibilityLabel: string;
  onPress: () => void;
  styles: MessageAttachmentStyles;
}> = ({ label, accessibilityLabel, onPress, styles }) => (
  <TouchableOpacity
    style={styles.previewAction}
    onPress={onPress}
    accessibilityRole="button"
    accessibilityLabel={accessibilityLabel}
  >
    <Text style={styles.previewActionText}>{label}</Text>
  </TouchableOpacity>
);

const createStyles = (colors: AppPalette, isUser: boolean, attachmentViewportWidth: number) =>
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
      paddingRight: 8,
    },
    singleContent: {
      alignItems: isUser ? 'flex-end' : 'flex-start',
      paddingVertical: 2,
    },
    previewOverlay: {
      flex: 1,
      backgroundColor: colors.overlay,
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
      maxHeight: '88%',
    },
    previewHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingHorizontal: 16,
      paddingVertical: 12,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    previewTitleWrap: {
      flex: 1,
      minWidth: 0,
      gap: 3,
    },
    previewTitle: {
      color: colors.text,
      fontSize: 15,
      fontWeight: '700',
      lineHeight: 20,
    },
    previewMeta: {
      color: colors.textSecondary,
      fontSize: 12,
    },
    previewCloseButton: {
      minWidth: 48,
      minHeight: 48,
      borderRadius: 12,
      paddingHorizontal: 12,
      justifyContent: 'center',
      alignItems: 'center',
      backgroundColor: colors.surfaceAlt,
    },
    previewCloseText: {
      color: colors.text,
      fontSize: 12,
      fontWeight: '700',
    },
    previewImageWrap: {
      minHeight: 280,
      maxHeight: 520,
      padding: 12,
      backgroundColor: colors.codeBackground,
    },
    previewImage: {
      width: '100%',
      height: '100%',
      minHeight: 256,
      backgroundColor: colors.surfaceAlt,
    },
    previewActions: {
      flexDirection: 'row',
      gap: 10,
      padding: 12,
    },
    previewAction: {
      minHeight: 48,
      flex: 1,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: colors.subtleBorder,
      justifyContent: 'center',
      alignItems: 'center',
      paddingHorizontal: 12,
    },
    previewActionText: {
      color: colors.text,
      fontSize: 13,
      fontWeight: '700',
    },
  });
