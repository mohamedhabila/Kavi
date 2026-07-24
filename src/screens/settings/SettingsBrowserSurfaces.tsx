import { ChevronRight, Plus, ShieldCheck } from 'lucide-react-native';
import React from 'react';
import { Text, TouchableOpacity, View } from 'react-native';

import { getBrowserProviderLabel } from '../../services/browser/providers/labels';
import { getBrowserProviderReadiness } from '../../services/browser/providers/readiness';
import type { AppPalette } from '../../theme/useAppTheme';
import type { BrowserProviderConfig } from '../../types/remote';

type TranslationFn = (key: string, params?: any) => string;
type StyleMap = Record<string, any>;

type SettingsBrowserSurfacesProps = {
  browserProviders: BrowserProviderConfig[];
  colors: AppPalette;
  getBrowserProviderAuthLabel: (authMode?: BrowserProviderConfig['authMode']) => string;
  handleEditBrowserProvider: (provider: BrowserProviderConfig) => void;
  handleNewBrowserProvider: () => void;
  styles: StyleMap;
  t: TranslationFn;
};

export const SettingsBrowserSurfaces: React.FC<SettingsBrowserSurfacesProps> = ({
  browserProviders,
  colors,
  getBrowserProviderAuthLabel,
  handleEditBrowserProvider,
  handleNewBrowserProvider,
  styles,
  t,
}) => (
  <>
    <View style={styles.sectionHeader}>
      <Text style={styles.sectionTitle}>{t('settings.browserProviders')}</Text>
      <TouchableOpacity
        accessibilityLabel={t('settings.addBrowserProvider')}
        accessibilityRole="button"
        onPress={handleNewBrowserProvider}
      >
        <Plus size={20} color={colors.primary} />
      </TouchableOpacity>
    </View>

    {browserProviders.map((provider) => (
      <TouchableOpacity
        accessibilityLabel={t('settings.editBrowserProvider')}
        accessibilityRole="button"
        key={provider.id}
        onPress={() => handleEditBrowserProvider(provider)}
        style={styles.listItem}
      >
        <ShieldCheck size={18} color={provider.enabled ? colors.primary : colors.textTertiary} />
        <View style={styles.listItemContent}>
          <Text style={styles.listItemTitle}>{provider.name}</Text>
          <Text style={styles.listItemSubtitle}>{getBrowserProviderLabel(provider.provider)}</Text>
          <Text style={styles.listItemSubtitle}>
            {provider.baseUrl?.trim() || t('remoteWork.notConfigured')}
          </Text>
          <Text style={styles.listItemSubtitle}>
            {getBrowserProviderAuthLabel(provider.authMode)} ·{' '}
            {getBrowserProviderReadiness(provider).launchable
              ? t('remoteWork.statusReady')
              : t('remoteWork.statusSetupRequired')}
          </Text>
        </View>
        <ChevronRight size={18} color={colors.textTertiary} />
      </TouchableOpacity>
    ))}

    {browserProviders.length === 0 ? (
      <Text style={styles.emptyText}>{t('settings.noBrowserProviders')}</Text>
    ) : null}
  </>
);
