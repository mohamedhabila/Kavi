import React from 'react';
import { ActivityIndicator, FlatList, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { ArrowLeft, RefreshCw, Search, Server, Settings } from 'lucide-react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import type { McpHubEntry, McpHubInputSpec } from '../../services/mcp/registryClient';
import type { McpServerStatus } from '../../services/mcp/manager';
import type { McpServerConfig } from '../../types/remote';
import { BrowseEntryCard, InstalledServerCard } from './McpStatusCards';
import { McpInstallModal } from './McpInstallModal';
import type { McpStatusPalette, McpStatusStyles, McpStatusTranslation } from './mcpStatusTypes';
import { AppIconButton } from '../../components/navigation/AppIconButton';
import { AppTabButton } from '../../components/navigation/AppTabButton';

type McpStatusScreenViewProps = {
  activeTab: 'installed' | 'browse';
  closeInstallModal: () => void;
  colors: McpStatusPalette;
  completeInstall: (
    entry: McpHubEntry,
    remoteId?: string | null,
    values?: Record<string, string>,
  ) => Promise<void>;
  getBrowseChips: (entry: McpHubEntry) => string[];
  getInstalledChips: (server: McpServerConfig, status?: McpServerStatus) => string[];
  getTransportLabel: (transport?: McpServerConfig['transport']) => string;
  handleAuthenticate: (serverId: string) => Promise<void>;
  handleBack: () => void;
  handleEditServer: (serverId: string) => void;
  handleInstallPress: (entry: McpHubEntry) => void;
  handleOpenSettings: () => void;
  handleReconnect: (serverId: string) => Promise<void>;
  handleRemoveServer: (serverId: string) => void;
  hubEntries: McpHubEntry[];
  hubLoading: boolean;
  hubLoadingMore: boolean;
  hubQuery: string;
  installEntry: McpHubEntry | null;
  installFields: McpHubInputSpec[];
  installingId: string | null;
  installingLabel: string | null;
  installValues: Record<string, string>;
  loadHubEntries: (mode?: 'refresh' | 'append') => Promise<void>;
  mcpServers: McpServerConfig[];
  onInstallRemoteChange: (remote: McpHubEntry['remotes'][number]) => void;
  refresh: (serversOverride?: McpServerConfig[]) => void;
  selectedRemoteId: string | null;
  setActiveTab: React.Dispatch<React.SetStateAction<'installed' | 'browse'>>;
  setHubQuery: React.Dispatch<React.SetStateAction<string>>;
  setInstallValues: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  statuses: McpServerStatus[];
  styles: McpStatusStyles;
  t: McpStatusTranslation;
};

export function McpStatusScreenView({
  activeTab,
  closeInstallModal,
  colors,
  completeInstall,
  getBrowseChips,
  getInstalledChips,
  getTransportLabel,
  handleAuthenticate,
  handleBack,
  handleEditServer,
  handleInstallPress,
  handleOpenSettings,
  handleReconnect,
  handleRemoveServer,
  hubEntries,
  hubLoading,
  hubLoadingMore,
  hubQuery,
  installEntry,
  installFields,
  installingId,
  installingLabel,
  installValues,
  loadHubEntries,
  mcpServers,
  onInstallRemoteChange,
  refresh,
  selectedRemoteId,
  setActiveTab,
  setHubQuery,
  setInstallValues,
  statuses,
  styles,
  t,
}: McpStatusScreenViewProps) {
  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <AppIconButton onPress={handleBack} label={t('common.back')} testID="mcp-status-back">
          <ArrowLeft size={24} color={colors.text} />
        </AppIconButton>
        <Text style={styles.headerTitle}>{t('mcpStatus.title')}</Text>
        <AppIconButton
          onPress={() => refresh()}
          label={t('common.refresh')}
          testID="mcp-status-refresh"
        >
          <RefreshCw size={20} color={colors.primary} />
        </AppIconButton>
      </View>

      <View style={styles.tabRow}>
        <AppTabButton
          label={t('mcpStatus.installedTab')}
          selected={activeTab === 'installed'}
          style={[styles.tabBtn, activeTab === 'installed' && styles.tabBtnActive]}
          onPress={() => setActiveTab('installed')}
          testID="mcp-status-tab-installed"
        >
          <Text style={[styles.tabText, activeTab === 'installed' && styles.tabTextActive]}>
            {t('mcpStatus.installedTab')}
          </Text>
        </AppTabButton>
        <AppTabButton
          label={t('mcpStatus.browseTab')}
          selected={activeTab === 'browse'}
          style={[styles.tabBtn, activeTab === 'browse' && styles.tabBtnActive]}
          onPress={() => {
            setActiveTab('browse');
            if (hubEntries.length === 0) {
              void loadHubEntries('refresh');
            }
          }}
          testID="mcp-status-tab-browse"
        >
          <Text style={[styles.tabText, activeTab === 'browse' && styles.tabTextActive]}>
            {t('mcpStatus.browseTab')}
          </Text>
        </AppTabButton>
      </View>

      {installingId && installingLabel ? (
        <View accessibilityLiveRegion="polite" style={styles.installingBanner}>
          <ActivityIndicator size="small" color={colors.primary} />
          <Text style={styles.installingBannerText}>
            {t('mcpStatus.install')} {installingLabel}...
          </Text>
        </View>
      ) : null}

      {activeTab === 'installed' ? (
        <FlatList
          data={statuses}
          keyExtractor={(status) => status.id}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => (
            <InstalledServerCard
              colors={colors}
              getInstalledChips={getInstalledChips}
              getTransportLabel={getTransportLabel}
              item={item}
              mcpServers={mcpServers}
              onAuthenticate={(serverId) => void handleAuthenticate(serverId)}
              onEditServer={handleEditServer}
              onReconnect={(serverId) => void handleReconnect(serverId)}
              onRemoveServer={handleRemoveServer}
              styles={styles}
              t={t}
            />
          )}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Server size={40} color={colors.textTertiary} />
              <Text style={styles.emptyTitle}>{t('mcpStatus.noServers')}</Text>
              <Text style={styles.emptyText}>{t('mcpStatus.noServersHint')}</Text>
              <TouchableOpacity
                style={styles.settingsBtn}
                onPress={handleOpenSettings}
                accessibilityRole="button"
                accessibilityLabel={t('mcpStatus.goToSettings')}
              >
                <Settings size={16} color="#fff" />
                <Text style={styles.settingsBtnText}>{t('mcpStatus.goToSettings')}</Text>
              </TouchableOpacity>
            </View>
          }
        />
      ) : (
        <View style={styles.browseContainer}>
          <View style={styles.searchRow}>
            <TextInput
              accessibilityLabel={t('mcpStatus.searchPlaceholder')}
              style={[styles.searchInput, { flex: 1 }]}
              value={hubQuery}
              onChangeText={setHubQuery}
              placeholder={t('mcpStatus.searchPlaceholder')}
              placeholderTextColor={colors.placeholder}
              returnKeyType="search"
              onSubmitEditing={() => {
                void loadHubEntries('refresh');
              }}
            />
            <AppIconButton
              style={styles.searchBtn}
              onPress={() => {
                void loadHubEntries('refresh');
              }}
              label={t('common.search')}
              testID="mcp-status-search"
            >
              <Search size={18} color={colors.primary} />
            </AppIconButton>
          </View>

          {hubLoading ? (
            <ActivityIndicator style={{ padding: 40 }} color={colors.primary} />
          ) : (
            <FlatList
              data={hubEntries}
              keyExtractor={(entry) => entry.id}
              contentContainerStyle={styles.list}
              renderItem={({ item }) => (
                <BrowseEntryCard
                  colors={colors}
                  getBrowseChips={getBrowseChips}
                  installingId={installingId}
                  item={item}
                  mcpServers={mcpServers}
                  onInstallPress={handleInstallPress}
                  styles={styles}
                  t={t}
                />
              )}
              onEndReached={() => {
                void loadHubEntries('append');
              }}
              onEndReachedThreshold={0.6}
              ListHeaderComponent={
                <View style={styles.browseIntroCard}>
                  <Text style={styles.browseIntroTitle}>
                    {hubQuery.trim() ? t('mcpStatus.searchResults') : t('mcpStatus.browseTitle')}
                  </Text>
                  <Text style={styles.browseIntroText}>{t('mcpStatus.browseHint')}</Text>
                </View>
              }
              ListFooterComponent={
                hubLoadingMore ? (
                  <View style={styles.listFooter}>
                    <ActivityIndicator color={colors.primary} />
                  </View>
                ) : null
              }
              ListEmptyComponent={
                <View style={styles.empty}>
                  <Search size={40} color={colors.textTertiary} />
                  <Text style={styles.emptyTitle}>{t('mcpStatus.browseTab')}</Text>
                  <Text style={styles.emptyText}>
                    {hubQuery.trim() ? t('mcpStatus.noBrowseResults') : t('mcpStatus.browseHint')}
                  </Text>
                </View>
              }
            />
          )}
        </View>
      )}

      <McpInstallModal
        colors={colors}
        completeInstall={completeInstall}
        getBrowseChips={getBrowseChips}
        installEntry={installEntry}
        installFields={installFields}
        installValues={installValues}
        onClose={closeInstallModal}
        onRemoteChange={onInstallRemoteChange}
        selectedRemoteId={selectedRemoteId}
        setInstallValues={setInstallValues}
        styles={styles}
        t={t}
      />
    </SafeAreaView>
  );
}
