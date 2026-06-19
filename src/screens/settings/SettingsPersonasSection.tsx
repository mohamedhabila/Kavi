import { Bot } from 'lucide-react-native';
import React from 'react';
import { ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native';

import type { AgentPersona } from '../../services/agents/personas';
import type { AppPalette } from '../../theme/useAppTheme';

type TranslationFn = (key: string, params?: any) => string;
type StyleMap = Record<string, any>;
type CollapsibleSectionComponentType = React.ComponentType<{
  title: string;
  children: React.ReactNode;
  open: boolean;
  onToggle: () => void;
  colors: AppPalette;
}>;

type PersonaThinkingOption = {
  value: NonNullable<AgentPersona['thinkingLevel']>;
  label: string;
  hint: string;
};

type SettingsPersonasSectionProps = {
  CollapsibleSectionComponent: CollapsibleSectionComponentType;
  colors: AppPalette;
  styles: StyleMap;
  t: TranslationFn;
  onLayout: (event: any) => void;
  expandedPersonas: boolean;
  togglePersonas: () => void;
  personas: AgentPersona[];
  editingPersonaId: string;
  setEditingPersonaId: (id: string) => void;
  currentPersona?: AgentPersona;
  personaDraft: Partial<AgentPersona>;
  setPersonaDraft: React.Dispatch<React.SetStateAction<Partial<AgentPersona>>>;
  personaThinkingLevelOptions: PersonaThinkingOption[];
  handleSavePersona: () => void;
};

export const SettingsPersonasSection: React.FC<SettingsPersonasSectionProps> = ({
  CollapsibleSectionComponent,
  colors,
  styles,
  t,
  onLayout,
  expandedPersonas,
  togglePersonas,
  personas,
  editingPersonaId,
  setEditingPersonaId,
  currentPersona,
  personaDraft,
  setPersonaDraft,
  personaThinkingLevelOptions,
  handleSavePersona,
}) => {
  return (
    <View style={styles.sectionCard} onLayout={onLayout}>
      <View style={styles.sectionCardHeader}>
        <Text style={styles.sectionCardTitle}>{t('settings.mainSections.personas.title')}</Text>
        <Text style={styles.sectionCardHint}>{t('settings.mainSections.personas.hint')}</Text>
      </View>

      <CollapsibleSectionComponent
        title={t('settings.personasTitle')}
        open={expandedPersonas}
        onToggle={togglePersonas}
        colors={colors}
      >
        <View style={styles.listItem}>
          <Bot size={18} color={colors.primary} />
          <View style={styles.listItemContent}>
            <Text style={styles.listItemTitle}>{t('settings.personasCardTitle')}</Text>
            <Text style={styles.listItemSubtitle}>{t('settings.personasCardHint')}</Text>
          </View>
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.presetRow}>
          {personas.map((persona) => (
            <TouchableOpacity
              key={persona.id}
              style={[
                styles.presetChip,
                editingPersonaId === persona.id && styles.presetChipActive,
              ]}
              onPress={() => setEditingPersonaId(persona.id)}
              accessibilityRole="button"
              accessibilityLabel={t('settings.configurePersona', { name: persona.name })}
              accessibilityState={{ selected: editingPersonaId === persona.id }}
            >
              <Bot
                size={14}
                color={editingPersonaId === persona.id ? colors.onPrimary : colors.primary}
              />
              <Text
                style={[
                  styles.presetChipText,
                  editingPersonaId === persona.id && styles.presetChipTextActive,
                ]}
              >
                {persona.name}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
        {currentPersona ? (
          <View style={styles.personaCard}>
            <Text style={styles.secureKeyTitle}>{currentPersona.name}</Text>
            <Text style={styles.secureKeyHint}>{currentPersona.description}</Text>

            <Text style={styles.label}>{t('settings.personaDisplayName')}</Text>
            <TextInput
              style={styles.input}
              value={personaDraft.name || ''}
              onChangeText={(value) => setPersonaDraft((current) => ({ ...current, name: value }))}
              placeholder={t('settings.personaDisplayNamePlaceholder')}
              placeholderTextColor={colors.placeholder}
            />

            <Text style={styles.label}>{t('settings.personaDescription')}</Text>
            <TextInput
              style={styles.input}
              value={personaDraft.description || ''}
              onChangeText={(value) =>
                setPersonaDraft((current) => ({ ...current, description: value }))
              }
              placeholder={t('settings.personaDescriptionPlaceholder')}
              placeholderTextColor={colors.placeholder}
            />

            <Text style={styles.label}>{t('settings.personaProviderOverride')}</Text>
            <TextInput
              style={styles.input}
              value={personaDraft.providerId || ''}
              onChangeText={(value) =>
                setPersonaDraft((current) => ({ ...current, providerId: value }))
              }
              placeholder={t('settings.personaProviderOverridePlaceholder')}
              placeholderTextColor={colors.placeholder}
              autoCapitalize="none"
            />

            <Text style={styles.label}>{t('settings.personaModelOverride')}</Text>
            <TextInput
              style={styles.input}
              value={personaDraft.model || ''}
              onChangeText={(value) => setPersonaDraft((current) => ({ ...current, model: value }))}
              placeholder={t('settings.personaModelOverridePlaceholder')}
              placeholderTextColor={colors.placeholder}
              autoCapitalize="none"
            />

            <Text style={styles.label}>{t('settings.personaThinkingLevel')}</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.presetRow}>
              {personaThinkingLevelOptions.map((option) => (
                <TouchableOpacity
                  key={option.value}
                  style={[
                    styles.presetChip,
                    personaDraft.thinkingLevel === option.value && styles.presetChipActive,
                  ]}
                  onPress={() =>
                    setPersonaDraft((current) => ({ ...current, thinkingLevel: option.value }))
                  }
                >
                  <Text
                    style={[
                      styles.presetChipText,
                      personaDraft.thinkingLevel === option.value && styles.presetChipTextActive,
                    ]}
                  >
                    {option.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>

            <Text style={styles.label}>{t('settings.personaTemperature')}</Text>
            <TextInput
              style={styles.input}
              value={personaDraft.temperature !== undefined ? String(personaDraft.temperature) : ''}
              onChangeText={(value) => {
                const parsed = value.trim() === '' ? undefined : Number.parseFloat(value);
                setPersonaDraft((current) => ({
                  ...current,
                  temperature: Number.isFinite(parsed as number) ? parsed : undefined,
                }));
              }}
              placeholder={t('settings.personaTemperaturePlaceholder')}
              placeholderTextColor={colors.placeholder}
              keyboardType="decimal-pad"
            />

            <Text style={styles.label}>{t('settings.systemPrompt')}</Text>
            <TextInput
              style={[styles.input, styles.textArea]}
              value={personaDraft.systemPrompt || ''}
              onChangeText={(value) =>
                setPersonaDraft((current) => ({ ...current, systemPrompt: value }))
              }
              placeholder={t('settings.personaSystemPromptPlaceholder')}
              placeholderTextColor={colors.placeholder}
              multiline
              numberOfLines={4}
              textAlignVertical="top"
            />

            <TouchableOpacity
              style={styles.primaryButton}
              onPress={handleSavePersona}
              accessibilityRole="button"
              accessibilityLabel={t('settings.savePersonaAccessibility', {
                name: currentPersona.name,
              })}
            >
              <Text style={styles.primaryButtonText}>{t('settings.savePersonaConfiguration')}</Text>
            </TouchableOpacity>
          </View>
        ) : null}
      </CollapsibleSectionComponent>
    </View>
  );
};
