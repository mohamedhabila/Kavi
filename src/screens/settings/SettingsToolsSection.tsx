import {
  ChevronDown,
  ExternalLink,
  Search,
  ShieldCheck,
  type LucideIcon,
} from 'lucide-react-native';
import React from 'react';
import { ScrollView, Switch, Text, TextInput, TouchableOpacity, View } from 'react-native';

import type { ServiceSetupField } from '../../services/setup/catalog';
import type { AppPalette } from '../../theme/useAppTheme';
import { type WebSearchProvider } from '../../types/tool';

type TranslationFn = (key: string, params?: any) => string;
type StyleMap = Record<string, any>;
type CollapsibleSectionComponentType = React.ComponentType<{
  title: string;
  children: React.ReactNode;
  open: boolean;
  onToggle: () => void;
  colors: AppPalette;
}>;

type ServiceFieldCopy = {
  label: string;
  category: string;
  hint: string;
  unlocks: string;
  setup: string;
  freeAccess: string;
};

type BuiltInToolSection = {
  id: string;
  icon: LucideIcon;
  title: string;
  description: string;
};

type ToolGroup = {
  id: string;
  definitions: Array<{ name: string; description: string }>;
};

type SettingsToolsSectionProps = {
  CollapsibleSectionComponent: CollapsibleSectionComponentType;
  colors: AppPalette;
  styles: StyleMap;
  t: TranslationFn;
  onLayout: (event: any) => void;
  webSearchProvider: WebSearchProvider;
  setWebSearchProvider: (value: WebSearchProvider) => void;
  webSearchProviderOptions: Array<{ value: WebSearchProvider; label: string; detail: string }>;
  serviceSetupFields: ServiceSetupField[];
  serviceKeys: Record<string, string>;
  setServiceKeys: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  getServiceFieldCopy: (field: ServiceSetupField) => ServiceFieldCopy;
  persistServiceKey: (storageKey: string, value: string) => void | Promise<void>;
  handleOpenUrl: (url?: string) => void | Promise<void>;
  builtInToolSections: BuiltInToolSection[];
  toolGroups: ToolGroup[];
  permissionStateByTool: Map<string, { allowed: boolean }>;
  expandedToolPermissions: boolean;
  toggleToolPermissions: () => void;
  expandedGroups: Set<string>;
  toggleGroup: (groupId: string) => void;
  setToolPermission: (toolName: string, allowed: boolean) => void;
};

export const SettingsToolsSection: React.FC<SettingsToolsSectionProps> = ({
  CollapsibleSectionComponent,
  colors,
  styles,
  t,
  onLayout,
  webSearchProvider,
  setWebSearchProvider,
  webSearchProviderOptions,
  serviceSetupFields,
  serviceKeys,
  setServiceKeys,
  getServiceFieldCopy,
  persistServiceKey,
  handleOpenUrl,
  builtInToolSections,
  toolGroups,
  permissionStateByTool,
  expandedToolPermissions,
  toggleToolPermissions,
  expandedGroups,
  toggleGroup,
  setToolPermission,
}) => {
  return (
    <View style={styles.sectionCard} onLayout={onLayout}>
      <View style={styles.sectionCardHeader}>
        <Text style={styles.sectionCardTitle}>{t('settings.mainSections.tools.title')}</Text>
        <Text style={styles.sectionCardHint}>{t('settings.mainSections.tools.hint')}</Text>
      </View>

      <Text style={styles.sectionTitle}>{t('settings.webAndTools')}</Text>
      <Text style={styles.label}>{t('settings.webSearchProvider')}</Text>
      <Text style={styles.listItemSubtitle}>{t('settings.webSearchProviderHint')}</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.presetRow}>
        {webSearchProviderOptions.map((option) => (
          <TouchableOpacity
            key={option.value}
            style={[
              styles.presetChip,
              webSearchProvider === option.value && styles.presetChipActive,
            ]}
            onPress={() => setWebSearchProvider(option.value)}
            accessibilityRole="button"
            accessibilityLabel={t('settings.useWebSearchProvider', { name: option.label })}
            accessibilityState={{ selected: webSearchProvider === option.value }}
          >
            <Search
              size={14}
              color={webSearchProvider === option.value ? colors.onPrimary : colors.primary}
            />
            <Text
              style={[
                styles.presetChipText,
                webSearchProvider === option.value && styles.presetChipTextActive,
              ]}
            >
              {option.label}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
      <Text style={styles.listItemSubtitle}>
        {webSearchProviderOptions.find((option) => option.value === webSearchProvider)?.detail}
      </Text>

      <Text style={styles.label}>{t('settings.secureKeys')}</Text>
      <Text style={styles.listItemSubtitle}>{t('settings.secureKeysHint')}</Text>
      {serviceSetupFields.map((field) => {
        const configured = Boolean(serviceKeys[field.storageKey]?.trim());
        const copy = getServiceFieldCopy(field);

        return (
          <View key={field.storageKey} style={styles.secureKeyBlock}>
            <View style={styles.secureKeyHeader}>
              <View style={styles.secureKeyTitleWrap}>
                <Text style={styles.secureKeyTitle}>{copy.label}</Text>
                <Text style={styles.secureKeyMeta}>{copy.category}</Text>
              </View>
              <View
                style={[
                  styles.statusPill,
                  configured ? styles.statusPillReady : styles.statusPillMissing,
                ]}
              >
                <Text
                  style={[
                    styles.statusPillText,
                    configured ? styles.statusPillTextReady : styles.statusPillTextMissing,
                  ]}
                >
                  {configured ? t('settings.configured') : t('settings.needsSetup')}
                </Text>
              </View>
            </View>
            <Text style={styles.secureKeyHint}>{copy.hint}</Text>
            <Text style={styles.setupDetail}>
              <Text style={styles.setupLabel}>{t('settings.unlocksLabel')}</Text> {copy.unlocks}
            </Text>
            <Text style={styles.setupDetail}>
              <Text style={styles.setupLabel}>{t('settings.setupLabel')}</Text> {copy.setup}
            </Text>
            <Text style={styles.setupDetail}>
              <Text style={styles.setupLabel}>{t('settings.freeUseLabel')}</Text> {copy.freeAccess}
            </Text>
            <TextInput
              style={styles.input}
              value={serviceKeys[field.storageKey] || ''}
              onChangeText={(value) =>
                setServiceKeys((current) => ({ ...current, [field.storageKey]: value }))
              }
              onEndEditing={(event) =>
                void persistServiceKey(field.storageKey, event.nativeEvent.text || '')
              }
              placeholder={field.placeholder}
              placeholderTextColor={colors.placeholder}
              autoCapitalize="none"
              autoCorrect={false}
              secureTextEntry
            />
            {field.docsUrl ? (
              <TouchableOpacity
                style={styles.inlineLink}
                onPress={() => void handleOpenUrl(field.docsUrl)}
                accessibilityRole="button"
                accessibilityLabel={t('settings.openDocsFor', { name: copy.label })}
              >
                <ExternalLink size={14} color={colors.primary} />
                <Text style={styles.inlineLinkText}>{t('settings.openOfficialSetupDocs')}</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        );
      })}

      <Text style={styles.label}>{t('settings.builtInTools')}</Text>
      {builtInToolSections.map((section) => {
        const IconComponent = section.icon;

        return (
          <View key={section.id} style={styles.listItem}>
            <IconComponent size={18} color={colors.primary} />
            <View style={styles.listItemContent}>
              <Text style={styles.listItemTitle}>{section.title}</Text>
              <Text style={styles.listItemSubtitle}>{section.description}</Text>
            </View>
          </View>
        );
      })}

      <CollapsibleSectionComponent
        title={t('settings.toolPermissionsTitle')}
        open={expandedToolPermissions}
        onToggle={toggleToolPermissions}
        colors={colors}
      >
        <View style={styles.listItem}>
          <ShieldCheck size={18} color={colors.primary} />
          <View style={styles.listItemContent}>
            <Text style={styles.listItemTitle}>{t('settings.toolPermissionsCardTitle')}</Text>
            <Text style={styles.listItemSubtitle}>{t('settings.toolPermissionsCardHint')}</Text>
          </View>
        </View>
        {toolGroups.map((group) => {
          const isExpanded = expandedGroups.has(group.id);
          const totalTools = group.definitions.length;
          const enabledCount = group.definitions.filter((definition) => {
            const permission = permissionStateByTool.get(definition.name);
            return permission ? permission.allowed : true;
          }).length;
          const enableAll = enabledCount === totalTools;

          return (
            <View key={group.id} style={styles.permissionGroup}>
              <TouchableOpacity
                style={styles.permissionGroupHeader}
                onPress={() => toggleGroup(group.id)}
                accessibilityRole="button"
                accessibilityLabel={t('settings.toolGroupAccessibility', {
                  name: t(`settings.toolGroups.${group.id}.title`),
                  enabled: String(enabledCount),
                  total: String(totalTools),
                })}
              >
                <View style={styles.permissionGroupHeaderText}>
                  <Text style={styles.permissionGroupTitle}>
                    {t(`settings.toolGroups.${group.id}.title`)}
                  </Text>
                  <Text style={styles.permissionGroupCount}>
                    {t('settings.toolGroupCount', {
                      enabled: String(enabledCount),
                      total: String(totalTools),
                    })}
                  </Text>
                </View>
                <View style={styles.permissionGroupActions}>
                  <Switch
                    value={enableAll}
                    onValueChange={(value) => {
                      for (const definition of group.definitions) {
                        setToolPermission(definition.name, value);
                      }
                    }}
                    trackColor={{ true: colors.primary }}
                  />
                  <ChevronDown
                    size={18}
                    color={colors.textSecondary}
                    style={isExpanded ? { transform: [{ rotate: '180deg' }] } : undefined}
                  />
                </View>
              </TouchableOpacity>
              {isExpanded
                ? group.definitions.map((definition) => {
                    const permission = permissionStateByTool.get(definition.name);
                    const allowed = permission ? permission.allowed : true;

                    return (
                      <View key={definition.name} style={styles.permissionRow}>
                        <View style={styles.permissionTextWrap}>
                          <Text style={styles.permissionToolName}>{definition.name}</Text>
                          <Text style={styles.permissionToolDescription} numberOfLines={2}>
                            {definition.description}
                          </Text>
                        </View>
                        <Switch
                          value={allowed}
                          onValueChange={(value) => setToolPermission(definition.name, value)}
                          trackColor={{ true: colors.primary }}
                        />
                      </View>
                    );
                  })
                : null}
            </View>
          );
        })}
      </CollapsibleSectionComponent>
    </View>
  );
};
