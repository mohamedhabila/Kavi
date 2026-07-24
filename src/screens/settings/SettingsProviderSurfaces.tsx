import { ChevronRight, Cpu, Globe, Plus } from 'lucide-react-native';
import React from 'react';
import { ScrollView, Text, TouchableOpacity, View } from 'react-native';

import { KNOWN_PROVIDERS } from '../../constants/api';
import {
  getProviderConfigurationReadiness,
  type ProviderConfigurationState,
  type ProviderCredentialStatus,
} from '../../services/llm/support/providerReadiness';
import type { AppPalette } from '../../theme/useAppTheme';
import type { LlmProviderConfig } from '../../types/provider';

type TranslationFn = (key: string, params?: any) => string;
type StyleMap = Record<string, any>;
type ProviderPreset = (typeof KNOWN_PROVIDERS)[number];

type SettingsProviderSurfacesProps = {
  colors: AppPalette;
  styles: StyleMap;
  t: TranslationFn;
  providers: LlmProviderConfig[];
  activeProviderId: string | null;
  providerCredentialStatuses: Record<string, ProviderCredentialStatus>;
  localRuntimeStatusesByProviderId: Record<string, any>;
  isOnDeviceLlmProvider: (provider: LlmProviderConfig) => boolean;
  getLocalLlmModelDisplayName: (modelId: string) => string;
  formatLocalLlmRuntimeStatusLabel: (status: any) => string;
  isLocalLlmModelInstalled: (provider: LlmProviderConfig, modelId: string) => boolean;
  handleNewProvider: (preset?: ProviderPreset) => void;
  handleEditProvider: (provider: LlmProviderConfig) => void;
};

function getProviderStatusLabel(state: ProviderConfigurationState, t: TranslationFn): string {
  switch (state) {
    case 'checking':
      return t('settings.providerReadiness.checking');
    case 'setup-needed':
      return t('settings.providerReadiness.setupNeeded');
    case 'configured':
      return t('settings.providerReadiness.configured');
    case 'active':
      return t('settings.providerReadiness.active');
    case 'error':
      return t('settings.providerReadiness.credentialError');
    case 'off':
    default:
      return t('settings.providerReadiness.off');
  }
}

function getProviderStatusColor(state: ProviderConfigurationState, colors: AppPalette): string {
  switch (state) {
    case 'active':
    case 'configured':
      return colors.success;
    case 'setup-needed':
      return colors.warning;
    case 'error':
      return colors.danger;
    case 'checking':
      return colors.primary;
    case 'off':
    default:
      return colors.textTertiary;
  }
}

export const SettingsProviderSurfaces: React.FC<SettingsProviderSurfacesProps> = ({
  colors,
  styles,
  t,
  providers,
  activeProviderId,
  providerCredentialStatuses,
  localRuntimeStatusesByProviderId,
  isOnDeviceLlmProvider,
  getLocalLlmModelDisplayName,
  formatLocalLlmRuntimeStatusLabel,
  isLocalLlmModelInstalled,
  handleNewProvider,
  handleEditProvider,
}) => (
  <>
    <View style={styles.sectionHeader}>
      <Text style={styles.sectionTitle}>{t('settings.providers')}</Text>
      <TouchableOpacity
        onPress={() => handleNewProvider()}
        style={styles.headerAction}
        accessibilityRole="button"
        accessibilityLabel={t('settings.addProvider')}
      >
        <Plus size={20} color={colors.primary} />
      </TouchableOpacity>
    </View>

    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.presetRow}>
      {KNOWN_PROVIDERS.map((preset) => (
        <TouchableOpacity
          key={preset.name}
          style={styles.presetChip}
          onPress={() => handleNewProvider(preset)}
          accessibilityRole="button"
          accessibilityLabel={t('settings.addNamedProvider', { name: preset.name })}
        >
          {preset.kind === 'on-device' ? (
            <Cpu size={14} color={colors.primary} />
          ) : (
            <Globe size={14} color={colors.primary} />
          )}
          <Text style={styles.presetChipText}>{preset.name}</Text>
        </TouchableOpacity>
      ))}
    </ScrollView>

    {providers.map((provider) => {
      const localProvider = isOnDeviceLlmProvider(provider);
      const readiness = getProviderConfigurationReadiness(provider, {
        active: provider.id === activeProviderId,
        credentialStatus: providerCredentialStatuses[provider.id],
        localModelInstalled: localProvider
          ? isLocalLlmModelInstalled(provider, provider.model)
          : undefined,
      });
      const statusLabel = getProviderStatusLabel(readiness.state, t);
      const statusColor = getProviderStatusColor(readiness.state, colors);

      return (
        <TouchableOpacity
          key={provider.id}
          style={styles.listItem}
          onPress={() => handleEditProvider(provider)}
          accessibilityRole="button"
          accessibilityLabel={t('settings.editNamedProvider', { name: provider.name })}
          accessibilityHint={statusLabel}
        >
          <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
          <View style={styles.listItemContent}>
            <View style={styles.providerTitleRow}>
              <Text numberOfLines={1} style={styles.listItemTitle}>
                {provider.name}
              </Text>
              <Text style={[styles.providerStatusText, { color: statusColor }]}>{statusLabel}</Text>
            </View>
            <Text numberOfLines={1} style={styles.listItemSubtitle}>
              {localProvider
                ? getLocalLlmModelDisplayName(provider.model)
                : provider.model || provider.baseUrl}
            </Text>
            {localProvider && localRuntimeStatusesByProviderId[provider.id] ? (
              <Text style={styles.listItemSubtitle}>
                {formatLocalLlmRuntimeStatusLabel(localRuntimeStatusesByProviderId[provider.id])}
              </Text>
            ) : null}
          </View>
          <ChevronRight size={18} color={colors.textTertiary} />
        </TouchableOpacity>
      );
    })}

    {providers.length === 0 ? (
      <Text style={styles.emptyText}>{t('settings.noProviders')}</Text>
    ) : null}
  </>
);
