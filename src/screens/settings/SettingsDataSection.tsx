import { Brain, Trash2 } from 'lucide-react-native';
import React from 'react';
import { ScrollView, Switch, Text, TextInput, TouchableOpacity, View } from 'react-native';

import type { AppPalette } from '../../theme/useAppTheme';
import type { LlmProviderConfig } from '../../types/provider';
import type { ConsolidationStatusSnapshot } from '../../services/memory/consolidationStatus';
import type { MemoryConsolidationMode } from '../../services/memory/memoryConsolidationMode';
import { consolidationTierLabel } from '../memory/consolidationStatusLabel';

type TranslationFn = (key: string, params?: any) => string;
type StyleMap = Record<string, any>;

type SettingsDataSectionProps = {
  colors: AppPalette;
  styles: StyleMap;
  t: TranslationFn;
  providers: LlmProviderConfig[];
  disableLongTermMemory: boolean;
  memoryConsolidationMode: MemoryConsolidationMode;
  consolidationProviderId: string | null;
  compactionProviderId: string | null;
  compactionModel: string | null;
  setDisableLongTermMemory: (value: boolean) => void;
  setMemoryConsolidationMode: (mode: MemoryConsolidationMode, providerId?: string | null) => void;
  setCompactionProvider: (providerId: string | null) => void;
  setCompactionModel: (model: string | null) => void;
  consolidationStatus: ConsolidationStatusSnapshot;
  onLayout: (event: any) => void;
  onClearAllData: () => void;
};

const MODE_CHIP_ORDER: ReadonlyArray<{
  mode: MemoryConsolidationMode;
  labelKey: string;
  testId: string;
}> = [
  {
    mode: 'auto',
    labelKey: 'memory.consolidationModeAuto',
    testId: 'consolidation-mode-chip-auto',
  },
  {
    mode: 'local',
    labelKey: 'memory.consolidationModeLocal',
    testId: 'consolidation-mode-chip-local',
  },
  {
    mode: 'active_provider',
    labelKey: 'memory.consolidationModeActiveProvider',
    testId: 'consolidation-mode-chip-active-provider',
  },
  { mode: 'off', labelKey: 'memory.consolidationModeOff', testId: 'consolidation-mode-chip-off' },
];

export const SettingsDataSection: React.FC<SettingsDataSectionProps> = ({
  colors,
  styles,
  t,
  providers,
  disableLongTermMemory,
  memoryConsolidationMode,
  consolidationProviderId,
  compactionProviderId,
  compactionModel,
  setDisableLongTermMemory,
  setMemoryConsolidationMode,
  setCompactionProvider,
  setCompactionModel,
  consolidationStatus,
  onLayout,
  onClearAllData,
}) => {
  return (
    <View style={styles.sectionCard} onLayout={onLayout}>
      <View style={styles.sectionCardHeader}>
        <Text style={styles.sectionCardTitle}>{t('settings.mainSections.data.title')}</Text>
        <Text style={styles.sectionCardHint}>{t('settings.mainSections.data.hint')}</Text>
      </View>

      <View style={styles.featureRow}>
        <Brain size={18} color={colors.primary} />
        <View style={styles.featureContent}>
          <Text style={styles.switchLabel}>{t('memory.disableLongTermMemory')}</Text>
          <Text style={styles.featureHint}>{t('memory.disableLongTermMemoryHint')}</Text>
        </View>
        <Switch
          value={disableLongTermMemory}
          onValueChange={setDisableLongTermMemory}
          trackColor={{ true: colors.primary }}
          accessibilityLabel={t('memory.disableLongTermMemory')}
        />
      </View>

      {!disableLongTermMemory ? (
        <View style={{ marginTop: 8 }}>
          <Text style={styles.label}>{t('memory.consolidationProvider')}</Text>
          <Text style={styles.listItemSubtitle}>{t('memory.consolidationProviderHint')}</Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={[styles.presetRow, { flexGrow: 0, flexShrink: 0 }]}
          >
            {MODE_CHIP_ORDER.map((chip) => {
              const selected = memoryConsolidationMode === chip.mode;
              return (
                <TouchableOpacity
                  key={chip.mode}
                  style={[styles.presetChip, selected && styles.presetChipActive]}
                  onPress={() => setMemoryConsolidationMode(chip.mode)}
                  accessibilityRole="button"
                  accessibilityLabel={t(chip.labelKey)}
                  accessibilityState={{ selected }}
                  testID={chip.testId}
                >
                  <Text style={[styles.presetChipText, selected && styles.presetChipTextActive]}>
                    {t(chip.labelKey)}
                  </Text>
                </TouchableOpacity>
              );
            })}
            {providers
              .filter((provider) => provider.enabled)
              .map((provider) => {
                const selected =
                  memoryConsolidationMode === 'specific' && consolidationProviderId === provider.id;

                return (
                  <TouchableOpacity
                    key={provider.id}
                    style={[styles.presetChip, selected && styles.presetChipActive]}
                    onPress={() => setMemoryConsolidationMode('specific', provider.id)}
                    accessibilityRole="button"
                    accessibilityLabel={provider.name}
                    accessibilityState={{ selected }}
                    testID={`consolidation-provider-chip-${provider.id}`}
                  >
                    <Text style={[styles.presetChipText, selected && styles.presetChipTextActive]}>
                      {provider.name}
                    </Text>
                  </TouchableOpacity>
                );
              })}
          </ScrollView>
          <Text
            style={[styles.listItemSubtitle, { marginTop: 8 }]}
            testID="settings-consolidation-status"
          >
            {consolidationTierLabel(consolidationStatus, t)}
            {consolidationStatus.isFallback && !consolidationStatus.memoryDisabled
              ? ` · ${t('memory.consolidationFallbackActive')}`
              : ''}
          </Text>
        </View>
      ) : null}

      <View style={{ marginTop: 16 }}>
        <Text style={styles.label}>{t('memory.compactionProvider')}</Text>
        <Text style={styles.listItemSubtitle}>{t('memory.compactionProviderHint')}</Text>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={[styles.presetRow, { flexGrow: 0, flexShrink: 0 }]}
        >
          <TouchableOpacity
            key="__compaction-off__"
            style={[styles.presetChip, compactionProviderId === null && styles.presetChipActive]}
            onPress={() => setCompactionProvider(null)}
            accessibilityRole="button"
            accessibilityLabel={t('memory.compactionProviderOff')}
            accessibilityState={{ selected: compactionProviderId === null }}
            testID="compaction-provider-chip-off"
          >
            <Text
              style={[
                styles.presetChipText,
                compactionProviderId === null && styles.presetChipTextActive,
              ]}
            >
              {t('memory.compactionProviderOff')}
            </Text>
          </TouchableOpacity>
          {providers
            .filter((provider) => provider.enabled)
            .map((provider) => {
              const selected = compactionProviderId === provider.id;
              return (
                <TouchableOpacity
                  key={`compaction-${provider.id}`}
                  style={[styles.presetChip, selected && styles.presetChipActive]}
                  onPress={() => setCompactionProvider(provider.id)}
                  accessibilityRole="button"
                  accessibilityLabel={provider.name}
                  accessibilityState={{ selected }}
                  testID={`compaction-provider-chip-${provider.id}`}
                >
                  <Text style={[styles.presetChipText, selected && styles.presetChipTextActive]}>
                    {provider.name}
                  </Text>
                </TouchableOpacity>
              );
            })}
        </ScrollView>
        {compactionProviderId ? (
          <TextInput
            style={[styles.input, { marginTop: 8 }]}
            value={compactionModel ?? ''}
            onChangeText={(value) => setCompactionModel(value.trim() ? value : null)}
            placeholder={t('memory.compactionModelPlaceholder')}
            placeholderTextColor={colors.textSecondary}
            autoCapitalize="none"
            autoCorrect={false}
            testID="compaction-model-input"
          />
        ) : null}
      </View>

      <Text style={[styles.sectionTitle, { marginTop: 24 }]}>{t('settings.data')}</Text>

      <TouchableOpacity
        style={styles.dangerBtn}
        onPress={onClearAllData}
        accessibilityRole="button"
        accessibilityLabel={t('settings.clearAllData')}
      >
        <Trash2 size={18} color={colors.danger} />
        <Text style={styles.dangerBtnText}>{t('settings.clearAllData')}</Text>
      </TouchableOpacity>

      <View style={{ height: 40 }} />
    </View>
  );
};
