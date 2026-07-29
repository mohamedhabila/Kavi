import React, { useMemo } from 'react';
import { Image, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import {
  Archive,
  Code2,
  ExternalLink,
  File,
  FileSpreadsheet,
  FileText,
  Image as ImageIcon,
  Music2,
  Presentation,
  Share2,
} from 'lucide-react-native';

import { useTranslation } from '../../i18n/useTranslation';
import { redactSensitiveText } from '../../services/security/toolDetailRedaction';
import { useAppTheme, type AppPalette } from '../../theme/useAppTheme';
import type { Attachment } from '../../types/attachment';
import { AudioAttachmentCard } from '../chat/AudioAttachmentCard';

type ArtifactKind =
  | 'image'
  | 'audio'
  | 'pdf'
  | 'document'
  | 'spreadsheet'
  | 'presentation'
  | 'archive'
  | 'code'
  | 'file';

interface ArtifactCardProps {
  artifact: Attachment;
  isUser: boolean;
  width: number;
  onOpen?: () => void;
  onPreview?: () => void;
  onShare?: () => void;
}

function safeArtifactName(name: unknown): string {
  if (typeof name !== 'string') return '';
  return redactSensitiveText(name)
    .replace(/[\u0000-\u001f\u007f-\u009f]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
    .slice(0, 160);
}

function getExtension(name: string): string {
  const finalSegment = name.toLowerCase().split('/').pop() ?? '';
  const extension = finalSegment.includes('.') ? finalSegment.split('.').pop() : '';
  return extension ?? '';
}

function getArtifactKind(artifact: Attachment): ArtifactKind {
  const mimeType = typeof artifact.mimeType === 'string' ? artifact.mimeType.toLowerCase() : '';
  const extension = getExtension(typeof artifact.name === 'string' ? artifact.name : '');

  if (artifact.type === 'image' || mimeType.startsWith('image/')) return 'image';
  if (artifact.type === 'audio' || mimeType.startsWith('audio/')) return 'audio';
  if (mimeType === 'application/pdf' || extension === 'pdf') return 'pdf';
  if (['csv', 'numbers', 'ods', 'xls', 'xlsx'].includes(extension)) return 'spreadsheet';
  if (['key', 'odp', 'ppt', 'pptx'].includes(extension)) return 'presentation';
  if (['7z', 'gz', 'rar', 'tar', 'tgz', 'zip'].includes(extension)) return 'archive';
  if (
    [
      'css',
      'go',
      'html',
      'java',
      'js',
      'json',
      'jsx',
      'kt',
      'md',
      'py',
      'rb',
      'rs',
      'sh',
      'swift',
      'toml',
      'ts',
      'tsx',
      'xml',
      'yaml',
      'yml',
    ].includes(extension)
  ) {
    return 'code';
  }
  if (['doc', 'docx', 'odt', 'pages', 'rtf', 'txt'].includes(extension)) return 'document';
  return 'file';
}

function formatArtifactSize(size: unknown): string | null {
  if (typeof size !== 'number' || !Number.isFinite(size) || size <= 0) return null;
  if (size < 1024) return `${Math.round(size)} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(size < 10 * 1024 ? 1 : 0)} KB`;
  return `${(size / (1024 * 1024)).toFixed(size < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

export const ArtifactCard: React.FC<ArtifactCardProps> = ({
  artifact,
  isUser,
  width,
  onOpen,
  onPreview,
  onShare,
}) => {
  const { colors } = useAppTheme();
  const { t } = useTranslation();
  const styles = useMemo(() => createStyles(colors, isUser, width), [colors, isUser, width]);
  const name = safeArtifactName(artifact.name) || t('artifactCard.untitled');
  const kind = getArtifactKind(artifact);
  const kindLabel = getArtifactKindLabel(kind, t);
  const size = formatArtifactSize(artifact.size);
  const provenance = isUser ? t('artifactCard.addedByYou') : t('artifactCard.createdInChat');
  const safeArtifact = useMemo(() => ({ ...artifact, name }), [artifact, name]);

  return (
    <View style={styles.card} testID={`artifact-card-${artifact.id}`}>
      <View style={styles.provenanceRow}>
        <Text style={styles.kindLabel}>{kindLabel}</Text>
        <Text style={styles.provenance} numberOfLines={1}>
          {provenance}
        </Text>
      </View>

      {kind === 'image' ? (
        <TouchableOpacity
          activeOpacity={0.88}
          disabled={!onPreview}
          onPress={onPreview}
          style={styles.imagePreview}
          accessibilityRole={onPreview ? 'button' : 'image'}
          accessibilityLabel={t('artifactCard.previewLabel', { name })}
          accessibilityHint={onPreview ? t('artifactCard.previewHint') : undefined}
          testID={`message-attachment-${artifact.id}`}
        >
          <Image
            source={{ uri: artifact.uri }}
            style={styles.image}
            resizeMode="cover"
            accessible={false}
          />
        </TouchableOpacity>
      ) : kind === 'audio' ? (
        <AudioAttachmentCard attachment={safeArtifact} isUser={isUser} />
      ) : (
        <View style={styles.filePreview} testID={`message-attachment-${artifact.id}`}>
          <View style={styles.iconWrap}>{renderArtifactIcon(kind, colors, isUser)}</View>
          <View style={styles.fileInfo}>
            <Text style={styles.name} numberOfLines={2}>
              {name}
            </Text>
            {size ? <Text style={styles.meta}>{size}</Text> : null}
          </View>
        </View>
      )}

      {kind === 'image' ? (
        <View style={styles.imageInfo}>
          <Text style={styles.name} numberOfLines={2}>
            {name}
          </Text>
          {size ? <Text style={styles.meta}>{size}</Text> : null}
        </View>
      ) : null}

      {onPreview || onOpen || onShare ? (
        <View style={styles.actions}>
          {onPreview ? (
            <ArtifactAction
              icon={<ImageIcon size={17} color={isUser ? colors.onPrimary : colors.primary} />}
              label={t('artifactCard.preview')}
              accessibilityLabel={t('artifactCard.previewLabel', { name })}
              onPress={onPreview}
              styles={styles}
              testID={`artifact-preview-${artifact.id}`}
            />
          ) : null}
          {onOpen ? (
            <ArtifactAction
              icon={<ExternalLink size={17} color={isUser ? colors.onPrimary : colors.primary} />}
              label={t('common.open')}
              accessibilityLabel={t('artifactCard.openLabel', { name })}
              onPress={onOpen}
              styles={styles}
              testID={`message-attachment-open-file-${artifact.id}`}
            />
          ) : null}
          {onShare ? (
            <ArtifactAction
              icon={<Share2 size={17} color={isUser ? colors.onPrimary : colors.primary} />}
              label={t('artifactCard.shareOrSave')}
              accessibilityLabel={t('artifactCard.shareLabel', { name })}
              onPress={onShare}
              styles={styles}
              testID={`message-attachment-share-file-${artifact.id}`}
            />
          ) : null}
        </View>
      ) : null}
    </View>
  );
};

type ArtifactCardStyles = ReturnType<typeof createStyles>;

const ArtifactAction: React.FC<{
  icon: React.ReactNode;
  label: string;
  accessibilityLabel: string;
  onPress: () => void;
  styles: ArtifactCardStyles;
  testID: string;
}> = ({ icon, label, accessibilityLabel, onPress, styles, testID }) => (
  <TouchableOpacity
    style={styles.actionButton}
    onPress={onPress}
    accessibilityRole="button"
    accessibilityLabel={accessibilityLabel}
    testID={testID}
  >
    {icon}
    <Text style={styles.actionText}>{label}</Text>
  </TouchableOpacity>
);

type Translate = (key: string, params?: Record<string, string | number>) => string;

function getArtifactKindLabel(kind: ArtifactKind, t: Translate): string {
  switch (kind) {
    case 'image':
      return t('artifactCard.type.image');
    case 'audio':
      return t('artifactCard.type.audio');
    case 'pdf':
      return t('artifactCard.type.pdf');
    case 'document':
      return t('artifactCard.type.document');
    case 'spreadsheet':
      return t('artifactCard.type.spreadsheet');
    case 'presentation':
      return t('artifactCard.type.presentation');
    case 'archive':
      return t('artifactCard.type.archive');
    case 'code':
      return t('artifactCard.type.code');
    default:
      return t('artifactCard.type.file');
  }
}

function renderArtifactIcon(kind: ArtifactKind, colors: AppPalette, isUser: boolean) {
  const color = isUser ? colors.onPrimary : colors.textSecondary;
  switch (kind) {
    case 'audio':
      return <Music2 size={24} color={color} />;
    case 'pdf':
    case 'document':
      return <FileText size={24} color={color} />;
    case 'spreadsheet':
      return <FileSpreadsheet size={24} color={color} />;
    case 'presentation':
      return <Presentation size={24} color={color} />;
    case 'archive':
      return <Archive size={24} color={color} />;
    case 'code':
      return <Code2 size={24} color={color} />;
    default:
      return <File size={24} color={color} />;
  }
}

const createStyles = (colors: AppPalette, isUser: boolean, width: number) =>
  StyleSheet.create({
    card: {
      width,
      maxWidth: '100%',
      borderRadius: 16,
      borderWidth: 1,
      borderColor: isUser ? 'rgba(255,255,255,0.22)' : colors.subtleBorder,
      backgroundColor: isUser ? 'rgba(255,255,255,0.1)' : colors.codeBackground,
      padding: 10,
      gap: 9,
      overflow: 'hidden',
    },
    provenanceRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    kindLabel: {
      color: isUser ? colors.onPrimary : colors.primary,
      fontSize: 11,
      fontWeight: '800',
      textTransform: 'uppercase',
    },
    provenance: {
      flex: 1,
      color: isUser ? 'rgba(255,255,255,0.8)' : colors.textSecondary,
      fontSize: 11,
      textAlign: 'right',
    },
    imagePreview: {
      borderRadius: 11,
      overflow: 'hidden',
      backgroundColor: isUser ? 'rgba(255,255,255,0.08)' : colors.surfaceAlt,
    },
    image: {
      width: '100%',
      height: 170,
      backgroundColor: isUser ? 'rgba(255,255,255,0.08)' : colors.surfaceAlt,
    },
    imageInfo: {
      gap: 2,
    },
    filePreview: {
      minHeight: 72,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingHorizontal: 4,
    },
    iconWrap: {
      width: 44,
      height: 44,
      borderRadius: 12,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: isUser ? 'rgba(255,255,255,0.12)' : colors.surfaceAlt,
    },
    fileInfo: {
      flex: 1,
      minWidth: 0,
      gap: 3,
    },
    name: {
      color: isUser ? colors.onPrimary : colors.text,
      fontSize: 13,
      fontWeight: '700',
      lineHeight: 18,
    },
    meta: {
      color: isUser ? 'rgba(255,255,255,0.8)' : colors.textSecondary,
      fontSize: 11,
    },
    actions: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8,
    },
    actionButton: {
      minHeight: 48,
      minWidth: 96,
      flexGrow: 1,
      flexBasis: 96,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: isUser ? 'rgba(255,255,255,0.24)' : colors.subtleBorder,
      backgroundColor: isUser ? 'rgba(255,255,255,0.12)' : colors.surfaceAlt,
      paddingHorizontal: 10,
      paddingVertical: 9,
    },
    actionText: {
      color: isUser ? colors.onPrimary : colors.text,
      fontSize: 12,
      fontWeight: '700',
    },
  });
