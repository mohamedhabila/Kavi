import React, { useMemo } from 'react';
import { ActivityIndicator, Text, TouchableOpacity, View } from 'react-native';
import {
  ArrowDownToLine,
  CheckCircle2,
  Cpu,
  Download,
  Trash2,
  TriangleAlert,
} from 'lucide-react-native';
import type { LocalLlmModelCatalogEntry } from '../../types/provider';
import { useTranslation } from '../../i18n/useTranslation';
import { useAppTheme } from '../../theme/useAppTheme';
import type {
  LocalLlmModelInstallProgress,
  LocalLlmRuntimeStatus,
} from '../../services/localLlm/types';
import type { InstalledLocalLlmModelValidationIssue } from '../../services/localLlm/modelArtifacts';
import { createLocalModelDownloadPanelStyles } from './LocalModelDownloadPanel.styles';
import {
  formatLocalModelRuntimeStatusLabel,
  getValidationIssueMessageKey,
} from './localModelRuntimeLabels';

type PanelStatus = 'idle' | 'validating' | 'blocked' | 'downloading' | 'ready' | 'failed';

interface LocalModelDownloadPanelProps {
  entry: LocalLlmModelCatalogEntry;
  status: PanelStatus;
  progress: LocalLlmModelInstallProgress | null;
  message?: string | null;
  alreadyInstalled: boolean;
  wasJustDownloaded: boolean;
  runtimeStatus?: LocalLlmRuntimeStatus | null;
  invalidInstallIssue?: InstalledLocalLlmModelValidationIssue | null;
  fallbackModelName?: string | null;
  onDownload: () => void;
  onClearInvalidInstall?: () => void;
  onSwitchToCpu?: () => void;
  onChooseFallbackModel?: () => void;
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

export const LocalModelDownloadPanel: React.FC<LocalModelDownloadPanelProps> = ({
  entry,
  status,
  progress,
  message,
  alreadyInstalled,
  wasJustDownloaded,
  runtimeStatus,
  invalidInstallIssue,
  fallbackModelName,
  onDownload,
  onClearInvalidInstall,
  onSwitchToCpu,
  onChooseFallbackModel,
}) => {
  const { colors } = useAppTheme();
  const { locale, t } = useTranslation();
  const styles = useMemo(() => createLocalModelDownloadPanelStyles(colors), [colors]);

  const totalBytes = progress?.totalBytes || entry.sizeBytes;
  const bytesWritten = progress?.bytesWritten || 0;
  const fraction = progress?.fraction ?? (status === 'ready' ? 1 : 0);
  const percent = Math.round(fraction * 100);
  const fallbackBody = t('localModels.downloadRequiredBody', { name: entry.name });
  const hasInvalidInstall = Boolean(invalidInstallIssue);
  const hasInlineWarning = status === 'idle' && Boolean(message) && !hasInvalidInstall;

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

  if (hasInvalidInstall && invalidInstallIssue) {
    title = t('localModels.recoveryTitle');
    body = t(getValidationIssueMessageKey(invalidInstallIssue), { name: entry.name });
    icon = <TriangleAlert size={18} color={colors.danger} />;
    containerStyle = styles.cardError;
    buttonLabel = t('localModels.retryDownloadButton');
  } else if (status === 'validating') {
    title = t('localModels.validatingTitle', { name: entry.name });
    body = t('localModels.validatingBody');
    icon = <ActivityIndicator size="small" color={colors.primary} />;
    containerStyle = styles.cardWarning;
    buttonLabel = t('localModels.validatingButton');
    buttonIcon = <ActivityIndicator size="small" color={colors.onPrimary} />;
    buttonDisabled = true;
  } else if (status === 'downloading') {
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

      {runtimeStatus ? (
        <Text style={styles.metricText}>
          {t('localModels.runtimeStatusLabel')}:{' '}
          {formatLocalModelRuntimeStatusLabel(runtimeStatus, t)}
        </Text>
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

      {onClearInvalidInstall || onSwitchToCpu || (fallbackModelName && onChooseFallbackModel) ? (
        <View
          style={styles.recoveryActions}
          accessibilityLabel={t('localModels.recoveryActionsLabel')}
        >
          {onClearInvalidInstall ? (
            <TouchableOpacity
              style={styles.recoveryButton}
              onPress={onClearInvalidInstall}
              testID="local-model-clear-invalid-install"
              accessibilityRole="button"
              accessibilityLabel={t('localModels.clearInvalidInstallButton')}
            >
              <Trash2 size={15} color={colors.text} />
              <Text style={styles.recoveryButtonText}>
                {t('localModels.clearInvalidInstallButton')}
              </Text>
            </TouchableOpacity>
          ) : null}
          {onSwitchToCpu ? (
            <TouchableOpacity
              style={styles.recoveryButton}
              onPress={onSwitchToCpu}
              testID="local-model-switch-cpu"
              accessibilityRole="button"
              accessibilityLabel={t('localModels.switchToCpuButton')}
            >
              <Cpu size={15} color={colors.text} />
              <Text style={styles.recoveryButtonText}>{t('localModels.switchToCpuButton')}</Text>
            </TouchableOpacity>
          ) : null}
          {fallbackModelName && onChooseFallbackModel ? (
            <TouchableOpacity
              style={styles.recoveryButton}
              onPress={onChooseFallbackModel}
              testID="local-model-choose-fallback"
              accessibilityRole="button"
              accessibilityLabel={t('localModels.chooseSmallerModelButton', {
                name: fallbackModelName,
              })}
            >
              <ArrowDownToLine size={15} color={colors.text} />
              <Text style={styles.recoveryButtonText}>
                {t('localModels.chooseSmallerModelButton', { name: fallbackModelName })}
              </Text>
            </TouchableOpacity>
          ) : null}
        </View>
      ) : null}
    </View>
  );
};
