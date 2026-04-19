import React, { useMemo } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { CheckCircle2, Download, TriangleAlert } from 'lucide-react-native';
import type { LocalLlmModelCatalogEntry } from '../../types';
import { useTranslation } from '../../i18n';
import { useAppTheme, type AppPalette } from '../../theme/useAppTheme';
import type { LocalLlmModelInstallProgress } from '../../services/localLlm/runtime';

type PanelStatus = 'idle' | 'blocked' | 'downloading' | 'ready' | 'failed';

interface LocalModelDownloadPanelProps {
  entry: LocalLlmModelCatalogEntry;
  status: PanelStatus;
  progress: LocalLlmModelInstallProgress | null;
  message?: string | null;
  alreadyInstalled: boolean;
  wasJustDownloaded: boolean;
  onDownload: () => void;
}

function formatBytes(value: number, locale: string): string {
  if (!Number.isFinite(value) || value <= 0) {
    return '0 B';
  }

  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let normalized = value;
  let unitIndex = 0;

  while (normalized >= 1024 && unitIndex < units.length - 1) {
    normalized /= 1024;
    unitIndex += 1;
  }

  const maximumFractionDigits = normalized >= 10 || unitIndex === 0 ? 0 : 2;
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits }).format(normalized)} ${units[unitIndex]}`;
}

function createStyles(colors: AppPalette) {
  return StyleSheet.create({
    card: {
      borderRadius: 14,
      borderWidth: 1,
      padding: 14,
      marginTop: 16,
      gap: 10,
    },
    cardWarning: {
      borderColor: colors.warning,
      backgroundColor: colors.warningBackground,
    },
    cardReady: {
      borderColor: colors.primary,
      backgroundColor: colors.primarySoft,
    },
    cardError: {
      borderColor: colors.danger,
      backgroundColor: colors.dangerSoft,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
    },
    headerBody: {
      flex: 1,
    },
    title: {
      fontSize: 15,
      fontWeight: '700',
      color: colors.text,
    },
    body: {
      fontSize: 13,
      lineHeight: 18,
      color: colors.textSecondary,
    },
    metrics: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      gap: 12,
    },
    metricText: {
      fontSize: 12,
      color: colors.textSecondary,
    },
    progressTrack: {
      height: 8,
      borderRadius: 999,
      backgroundColor: colors.surfaceAlt,
      overflow: 'hidden',
    },
    progressFill: {
      height: '100%',
      borderRadius: 999,
      backgroundColor: colors.primary,
    },
    button: {
      minHeight: 44,
      borderRadius: 12,
      paddingHorizontal: 14,
      paddingVertical: 12,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      backgroundColor: colors.primary,
    },
    buttonDisabled: {
      opacity: 0.7,
    },
    buttonReady: {
      backgroundColor: 'transparent',
      borderWidth: 1,
      borderColor: colors.primary,
    },
    buttonText: {
      fontSize: 14,
      fontWeight: '700',
      color: colors.onPrimary,
    },
    buttonReadyText: {
      color: colors.primary,
    },
  });
}

export const LocalModelDownloadPanel: React.FC<LocalModelDownloadPanelProps> = ({
  entry,
  status,
  progress,
  message,
  alreadyInstalled,
  wasJustDownloaded,
  onDownload,
}) => {
  const { colors } = useAppTheme();
  const { locale, t } = useTranslation();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const totalBytes = progress?.totalBytes || entry.sizeBytes;
  const bytesWritten = progress?.bytesWritten || 0;
  const fraction = progress?.fraction ?? (status === 'ready' ? 1 : 0);
  const percent = Math.round(fraction * 100);
  const fallbackBody = t('localModels.downloadRequiredBody', { name: entry.name });
  const hasInlineWarning = status === 'idle' && Boolean(message);

  let title = t('localModels.downloadRequiredTitle');
  let body = message || fallbackBody;
  let icon = <TriangleAlert size={18} color={colors.warning} />;
  let containerStyle = styles.cardWarning;
  let buttonLabel = t('localModels.downloadButton', { size: entry.sizeLabel });
  let buttonIcon = <Download size={16} color={colors.onPrimary} />;
  let buttonStyle = styles.button;
  let buttonTextStyle = styles.buttonText;
  let buttonDisabled = false;

  if (hasInlineWarning) {
    title = entry.name;
  }

  if (status === 'downloading') {
    title = t('localModels.downloadingTitle', { name: entry.name });
    body = t('localModels.downloadingBody');
    icon = <ActivityIndicator size="small" color={colors.primary} />;
    containerStyle = styles.cardWarning;
    buttonLabel = t('localModels.downloadingButton');
    buttonIcon = <ActivityIndicator size="small" color={colors.onPrimary} />;
    buttonDisabled = true;
  } else if (status === 'blocked') {
    title = entry.name;
    body = message || fallbackBody;
    icon = <TriangleAlert size={18} color={colors.danger} />;
    containerStyle = styles.cardError;
    buttonDisabled = true;
  } else if (status === 'ready' && wasJustDownloaded) {
    title = t('localModels.downloadedTitle', { name: entry.name });
    body = t('localModels.downloadedBody');
    icon = <CheckCircle2 size={18} color={colors.primary} />;
    containerStyle = styles.cardReady;
    buttonLabel = t('localModels.downloadedButton');
    buttonIcon = <CheckCircle2 size={16} color={colors.primary} />;
    buttonStyle = [styles.button, styles.buttonReady] as unknown as any;
    buttonTextStyle = [styles.buttonText, styles.buttonReadyText] as unknown as any;
    buttonDisabled = true;
  } else if (status === 'ready' && alreadyInstalled) {
    title = t('localModels.installedTitle', { name: entry.name });
    body = t('localModels.installedBody');
    icon = <CheckCircle2 size={18} color={colors.primary} />;
    containerStyle = styles.cardReady;
    buttonLabel = t('localModels.downloadedButton');
    buttonIcon = <CheckCircle2 size={16} color={colors.primary} />;
    buttonStyle = [styles.button, styles.buttonReady] as unknown as any;
    buttonTextStyle = [styles.buttonText, styles.buttonReadyText] as unknown as any;
    buttonDisabled = true;
  } else if (status === 'failed') {
    title = t('localModels.downloadFailedTitle');
    body = message || t('localModels.downloadFailedBody');
    icon = <TriangleAlert size={18} color={colors.danger} />;
    containerStyle = styles.cardError;
    buttonLabel = t('localModels.retryDownloadButton');
    buttonIcon = <Download size={16} color={colors.onPrimary} />;
  }

  return (
    <View style={[styles.card, containerStyle]}>
      <View style={styles.header}>
        {icon}
        <View style={styles.headerBody}>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.body}>{body}</Text>
        </View>
      </View>

      {status === 'downloading' ? (
        <>
          <View style={styles.metrics}>
            <Text style={styles.metricText}>
              {t('localModels.downloadProgressBytes', {
                written: formatBytes(bytesWritten, locale),
                total: formatBytes(totalBytes, locale),
              })}
            </Text>
            <Text style={styles.metricText}>
              {t('localModels.downloadProgressPercent', { percent })}
            </Text>
          </View>
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: `${percent}%` }]} />
          </View>
        </>
      ) : null}

      {status !== 'downloading' ? (
        <Text style={styles.metricText}>
          {t('localModels.storageFootnote', { size: entry.sizeLabel })}
        </Text>
      ) : null}

      <TouchableOpacity
        style={[buttonStyle, buttonDisabled && styles.buttonDisabled]}
        onPress={onDownload}
        disabled={buttonDisabled}
        accessibilityRole="button"
        accessibilityLabel={t('localModels.downloadAccessibilityLabel', { name: entry.name })}
        accessibilityState={{ disabled: buttonDisabled }}
      >
        {buttonIcon}
        <Text style={buttonTextStyle}>{buttonLabel}</Text>
      </TouchableOpacity>
    </View>
  );
};
