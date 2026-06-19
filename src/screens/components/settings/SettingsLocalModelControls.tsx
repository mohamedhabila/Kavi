import React from 'react';
import { Text, TouchableOpacity, View } from 'react-native';

import { LocalModelDownloadPanel } from '../../../components/localLlm/LocalModelDownloadPanel';
import type { InstalledLocalLlmModelValidationIssue } from '../../../services/localLlm/modelArtifacts';
import type {
  LocalLlmModelInstallProgress,
  LocalLlmRuntimeStatus,
} from '../../../services/localLlm/types';
import type { LocalLlmModelCatalogEntry, LlmProviderConfig } from '../../../types/provider';

type TranslationFn = (key: string, params?: any) => string;
type StyleMap = Record<string, any>;
type DownloadStatus = 'idle' | 'validating' | 'blocked' | 'downloading' | 'ready' | 'failed';

type DownloadState = {
  status: DownloadStatus;
  progress: LocalLlmModelInstallProgress | null;
  errorMessage: string | null;
};

type LocalCatalogOption = Pick<LocalLlmModelCatalogEntry, 'id' | 'name' | 'sizeLabel'>;

type SettingsLocalModelControlsProps = {
  editingProvider: LlmProviderConfig;
  localCatalog: LocalCatalogOption[];
  selectedLocalCatalogEntry: LocalLlmModelCatalogEntry | null;
  downloadState: DownloadState;
  wasJustDownloaded: boolean;
  runtimeStatus?: LocalLlmRuntimeStatus | null;
  invalidInstallIssue?: InstalledLocalLlmModelValidationIssue | null;
  fallbackModelName?: string | null;
  canSwitchToCpu: boolean;
  styles: StyleMap;
  t: TranslationFn;
  isLocalLlmModelInstalled: (provider: LlmProviderConfig, modelId: string) => boolean;
  onProviderChange: (provider: LlmProviderConfig) => void;
  onDownload: () => void | Promise<void>;
  onClearInvalidInstall: () => void;
  onSwitchToCpu: () => void;
  onChooseFallbackModel: () => void;
};

export const SettingsLocalModelControls: React.FC<SettingsLocalModelControlsProps> = ({
  editingProvider,
  localCatalog,
  selectedLocalCatalogEntry,
  downloadState,
  wasJustDownloaded,
  runtimeStatus,
  invalidInstallIssue,
  fallbackModelName,
  canSwitchToCpu,
  styles,
  t,
  isLocalLlmModelInstalled,
  onProviderChange,
  onDownload,
  onClearInvalidInstall,
  onSwitchToCpu,
  onChooseFallbackModel,
}) => (
  <>
    <View style={styles.localModelGrid}>
      {localCatalog.map((entry) => {
        const active = editingProvider.model === entry.id;
        const installed = isLocalLlmModelInstalled(editingProvider, entry.id);

        return (
          <TouchableOpacity
            key={entry.id}
            style={[styles.presetChip, active && styles.presetChipActive]}
            onPress={() => onProviderChange({ ...editingProvider, model: entry.id })}
            accessibilityRole="button"
            accessibilityLabel={t('settings.selectOnDeviceModel', { name: entry.name })}
            accessibilityState={{ selected: active }}
          >
            <Text style={[styles.presetChipText, active && styles.presetChipTextActive]}>
              {entry.name}
            </Text>
            <Text style={[styles.localModelMeta, active && styles.presetChipTextActive]}>
              {installed ? t('settings.onDeviceModelInstalled') : entry.sizeLabel}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>

    {selectedLocalCatalogEntry ? (
      <LocalModelDownloadPanel
        entry={selectedLocalCatalogEntry}
        status={downloadState.status}
        progress={downloadState.progress}
        message={downloadState.errorMessage}
        alreadyInstalled={isLocalLlmModelInstalled(editingProvider, selectedLocalCatalogEntry.id)}
        wasJustDownloaded={wasJustDownloaded}
        runtimeStatus={runtimeStatus}
        invalidInstallIssue={invalidInstallIssue}
        fallbackModelName={fallbackModelName}
        onDownload={() => void onDownload()}
        onClearInvalidInstall={invalidInstallIssue ? onClearInvalidInstall : undefined}
        onSwitchToCpu={canSwitchToCpu ? onSwitchToCpu : undefined}
        onChooseFallbackModel={fallbackModelName ? onChooseFallbackModel : undefined}
      />
    ) : null}
  </>
);
