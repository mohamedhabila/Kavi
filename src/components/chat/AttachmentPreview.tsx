// ---------------------------------------------------------------------------
// Kavi — AttachmentPreview Component
// ---------------------------------------------------------------------------

import React from 'react';
import { Image, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { FileText, Mic, X } from 'lucide-react-native';
import { useTranslation } from '../../i18n';
import { Attachment } from '../../types';
import { useAppTheme, AppPalette } from '../../theme/useAppTheme';
import { isAudioAttachment } from '../../utils/messageAttachments';

interface AttachmentPreviewProps {
  attachments: Attachment[];
  onRemove: (id: string) => void;
}

export const AttachmentPreview: React.FC<AttachmentPreviewProps> = ({ attachments, onRemove }) => {
  const { colors } = useAppTheme();
  const { t } = useTranslation();
  const styles = createStyles(colors);

  return (
    <ScrollView horizontal style={styles.container} showsHorizontalScrollIndicator={false}>
      {attachments.map((att) => (
        <View key={att.id} style={styles.item}>
          {att.type === 'image' ? (
            <Image source={{ uri: att.uri }} style={styles.imageThumb} />
          ) : isAudioAttachment(att) ? (
            <View style={styles.audioThumb}>
              <View style={styles.audioIconWrap}>
                <Mic size={18} color={colors.textSecondary} />
              </View>
              <Text style={styles.audioTitle} numberOfLines={1}>
                {att.name || t('chat.voiceNoteAttachment')}
              </Text>
              {typeof att.durationMs === 'number' && att.durationMs > 0 ? (
                <Text style={styles.audioMeta}>
                  {t('common.secondsShort', {
                    count: Math.max(1, Math.round(att.durationMs / 1000)),
                  })}
                </Text>
              ) : null}
            </View>
          ) : (
            <View style={styles.fileThumb}>
              <FileText size={20} color={colors.textSecondary} />
              <Text style={styles.fileName} numberOfLines={1}>
                {att.name}
              </Text>
            </View>
          )}
          <TouchableOpacity
            style={styles.removeBtn}
            onPress={() => onRemove(att.id)}
            accessibilityRole="button"
            accessibilityLabel={t('chat.removeAttachment', {
              name: att.name || t('chat.attachmentFallbackName'),
            })}
          >
            <X size={12} color={colors.onPrimary} />
          </TouchableOpacity>
        </View>
      ))}
    </ScrollView>
  );
};

const createStyles = (colors: AppPalette) =>
  StyleSheet.create({
    container: {
      paddingHorizontal: 12,
      paddingTop: 8,
      maxHeight: 80,
    },
    item: {
      position: 'relative',
      marginRight: 8,
    },
    imageThumb: {
      width: 60,
      height: 60,
      borderRadius: 8,
    },
    fileThumb: {
      width: 80,
      height: 60,
      borderRadius: 8,
      backgroundColor: colors.surfaceAlt,
      justifyContent: 'center',
      alignItems: 'center',
      padding: 4,
    },
    audioThumb: {
      width: 120,
      height: 60,
      borderRadius: 10,
      backgroundColor: colors.surfaceAlt,
      justifyContent: 'center',
      paddingHorizontal: 10,
      gap: 2,
    },
    audioIconWrap: {
      width: 24,
      height: 24,
      borderRadius: 12,
      backgroundColor: 'rgba(255,255,255,0.08)',
      alignItems: 'center',
      justifyContent: 'center',
    },
    audioTitle: {
      fontSize: 10,
      fontWeight: '600',
      color: colors.textSecondary,
    },
    audioMeta: {
      fontSize: 9,
      color: colors.textSecondary,
    },
    fileName: {
      fontSize: 9,
      color: colors.textSecondary,
      marginTop: 2,
    },
    removeBtn: {
      position: 'absolute',
      top: -4,
      right: -4,
      backgroundColor: colors.danger,
      borderRadius: 10,
      width: 20,
      height: 20,
      justifyContent: 'center',
      alignItems: 'center',
    },
  });
