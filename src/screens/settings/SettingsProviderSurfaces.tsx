import { ChevronRight, Cpu, Globe, Plus } from 'lucide-react-native';
import React from 'react';
import { ScrollView, Text, TouchableOpacity, View } from 'react-native';

import { KNOWN_PROVIDERS } from '../../constants/api';
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
  localRuntimeStatusesByProviderId: Record<string, any>;
  isOnDeviceLlmProvider: (provider: LlmProviderConfig) => boolean;
  getLocalLlmModelDisplayName: (modelId: string) => string;
  formatLocalLlmRuntimeStatusLabel: (status: any) => string;
  handleNewProvider: (preset?: ProviderPreset) => void;
  handleEditProvider: (provider: LlmProviderConfig) => void;
};

export const SettingsProviderSurfaces: React.FC<SettingsProviderSurfacesProps> = ({
  colors,
  styles,
  t,
  providers,
  localRuntimeStatusesByProviderId,
  isOnDeviceLlmProvider,
  getLocalLlmModelDisplayName,
  formatLocalLlmRuntimeStatusLabel,
  handleNewProvider,
  handleEditProvider,
}) => (
  <>
    <View style={styles.sectionHeader}>
      <Text style={styles.sectionTitle}>{t('settings.providers')}</Text>
      <TouchableOpacity
        onPress={() => handleNewProvider()}
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

    {providers.map((provider) => (
      <TouchableOpacity
        key={provider.id}
        style={styles.listItem}
        onPress={() => handleEditProvider(provider)}
        accessibilityRole="button"
        accessibilityLabel={t('settings.editNamedProvider', { name: provider.name })}
      >
        <View
          style={[
            styles.statusDot,
            { backgroundColor: provider.enabled ? colors.success : colors.textTertiary },
          ]}
        />
        <View style={styles.listItemContent}>
          <Text style={styles.listItemTitle}>{provider.name}</Text>
          <Text style={styles.listItemSubtitle}>
            {isOnDeviceLlmProvider(provider)
              ? getLocalLlmModelDisplayName(provider.model)
              : provider.model || provider.baseUrl}
          </Text>
          {isOnDeviceLlmProvider(provider) && localRuntimeStatusesByProviderId[provider.id] ? (
            <Text style={styles.listItemSubtitle}>
              {formatLocalLlmRuntimeStatusLabel(localRuntimeStatusesByProviderId[provider.id])}
            </Text>
          ) : null}
        </View>
        <ChevronRight size={18} color={colors.textTertiary} />
      </TouchableOpacity>
    ))}

    {providers.length === 0 ? (
      <Text style={styles.emptyText}>{t('settings.noProviders')}</Text>
    ) : null}
  </>
);
