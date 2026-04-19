// ---------------------------------------------------------------------------
// Kavi — MCP Servers Status Screen
// ---------------------------------------------------------------------------

import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  Alert,
  FlatList,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  ActivityIndicator,
  Modal,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import {
  ArrowLeft,
  Download,
  RefreshCw,
  Search,
  Server,
  Settings,
  Trash2,
  Wrench,
  CheckCircle2,
  XCircle,
  X,
} from 'lucide-react-native';
import { useSettingsStore } from '../store/useSettingsStore';
import { mcpManager, McpServerStatus } from '../services/mcp/manager';
import { useAppTheme, AppPalette } from '../theme/useAppTheme';
import { useTranslation } from '../i18n';
import {
  buildMcpInstallDraft,
  getRemoteInputs,
  listOfficialMcpRegistry,
  McpHubEntry,
  McpHubInputSpec,
} from '../services/mcp/registryClient';
import { normalizeMcpServerConfigMetadata } from '../services/mcp/metadata';
import type { McpServerConfig } from '../types';
import { useBackToChat } from '../navigation/useBackToChat';

const BROWSE_PAGE_SIZE = 20;

function areStatusesEqual(left: McpServerStatus[], right: McpServerStatus[]): boolean {
  if (left.length !== right.length) {
    return false;
  }

  for (let index = 0; index < left.length; index++) {
    const current = left[index];
    const next = right[index];
    if (
      current.id !== next.id ||
      current.name !== next.name ||
      current.state !== next.state ||
      current.error !== next.error ||
      current.lastConnected !== next.lastConnected ||
      current.authRequired !== next.authRequired ||
      current.authState !== next.authState ||
      current.tools.length !== next.tools.length
    ) {
      return false;
    }

    for (let toolIndex = 0; toolIndex < current.tools.length; toolIndex++) {
      const currentTool = current.tools[toolIndex];
      const nextTool = next.tools[toolIndex];
      if (currentTool.name !== nextTool.name || currentTool.description !== nextTool.description) {
        return false;
      }
    }
  }

  return true;
}

function mergeRegistryEntries(current: McpHubEntry[], incoming: McpHubEntry[]): McpHubEntry[] {
  const merged = new Map<string, McpHubEntry>();
  for (const entry of current) {
    merged.set(entry.id, entry);
  }
  for (const entry of incoming) {
    if (!merged.has(entry.id)) {
      merged.set(entry.id, entry);
    }
  }
  return Array.from(merged.values());
}

function buildDisplayedStatuses(
  servers: McpServerConfig[],
  managerStatuses: McpServerStatus[],
): McpServerStatus[] {
  const statusesById = new Map(managerStatuses.map((status) => [status.id, status]));
  return servers
    .filter((server) => server.enabled)
    .map(
      (server) =>
        statusesById.get(server.id) || {
          id: server.id,
          name: server.name,
          state: 'disconnected' as const,
          tools: [],
        },
    );
}

function buildInstallValueDefaults(
  entry?: { headers: McpHubInputSpec[]; variables: McpHubInputSpec[] } | null,
): Record<string, string> {
  if (!entry) return {};

  const nextValues: Record<string, string> = {};
  for (const field of [...entry.variables, ...entry.headers]) {
    nextValues[field.key] = field.defaultValue || '';
  }
  return nextValues;
}

export const McpStatusScreen: React.FC = () => {
  const navigation = useNavigation();
  const handleBack = useBackToChat();
  const { colors } = useAppTheme();
  const { t } = useTranslation();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const mcpServers = useSettingsStore((s) => s.mcpServers);
  const addMcpServer = useSettingsStore((s) => s.addMcpServer);
  const removeMcpServer = useSettingsStore((s) => s.removeMcpServer);
  const [statuses, setStatuses] = useState<McpServerStatus[]>([]);
  const [activeTab, setActiveTab] = useState<'installed' | 'browse'>('installed');
  const [hubQuery, setHubQuery] = useState('');
  const [hubEntries, setHubEntries] = useState<McpHubEntry[]>([]);
  const [hubLoading, setHubLoading] = useState(false);
  const [hubLoadingMore, setHubLoadingMore] = useState(false);
  const [hubNextCursor, setHubNextCursor] = useState<string | null>(null);
  const [installingId, setInstallingId] = useState<string | null>(null);
  const [installingLabel, setInstallingLabel] = useState<string | null>(null);
  const [installEntry, setInstallEntry] = useState<McpHubEntry | null>(null);
  const [selectedRemoteId, setSelectedRemoteId] = useState<string | null>(null);
  const [installValues, setInstallValues] = useState<Record<string, string>>({});
  const hubRequestInFlightRef = useRef(false);
  const hubQueuedRefreshRef = useRef(false);
  const hubQueryRef = useRef(hubQuery);
  const hubNextCursorRef = useRef(hubNextCursor);

  hubQueryRef.current = hubQuery;
  hubNextCursorRef.current = hubNextCursor;

  const refresh = useCallback((serversOverride?: McpServerConfig[]) => {
    const latestServers = serversOverride || useSettingsStore.getState().mcpServers;
    const nextStatuses = buildDisplayedStatuses(latestServers, mcpManager.getAllStatuses());
    setStatuses((current) => (areStatusesEqual(current, nextStatuses) ? current : nextStatuses));
  }, []);

  React.useEffect(() => {
    refresh();
    const unsubscribe = mcpManager.subscribe(refresh);
    const interval = setInterval(refresh, 30000);
    return () => {
      unsubscribe();
      clearInterval(interval);
    };
  }, [refresh]);

  React.useEffect(() => {
    refresh(mcpServers);
  }, [mcpServers, refresh]);

  const loadHubEntries = useCallback(async (mode: 'refresh' | 'append' = 'refresh') => {
    const query = hubQueryRef.current.trim();

    if (hubRequestInFlightRef.current) {
      if (mode === 'refresh') {
        hubQueuedRefreshRef.current = true;
      }
      return;
    }

    if (mode === 'append' && !hubNextCursorRef.current) {
      return;
    }

    hubRequestInFlightRef.current = true;
    if (mode === 'append') {
      setHubLoadingMore(true);
    } else {
      setHubLoading(true);
    }

    try {
      const result = await listOfficialMcpRegistry({
        limit: BROWSE_PAGE_SIZE,
        cursor: mode === 'append' ? hubNextCursorRef.current : null,
        search: query || undefined,
      });

      setHubEntries((current) =>
        mode === 'append' ? mergeRegistryEntries(current, result.entries) : result.entries,
      );
      setHubNextCursor(result.nextCursor);
    } catch {
      if (mode !== 'append') {
        setHubEntries([]);
      }
      setHubNextCursor(null);
    } finally {
      hubRequestInFlightRef.current = false;
      if (mode === 'append') {
        setHubLoadingMore(false);
      } else {
        setHubLoading(false);
      }

      if (hubQueuedRefreshRef.current) {
        hubQueuedRefreshRef.current = false;
        void loadHubEntries('refresh');
      }
    }
  }, []);

  const handleReconnect = useCallback(
    async (serverId: string) => {
      const server = mcpServers.find((s) => s.id === serverId);
      if (server) {
        try {
          await mcpManager.connectServer(server);
        } catch {
          // Status is updated by the manager; refreshing surfaces the latest error.
        }
        refresh();
      }
    },
    [mcpServers, refresh],
  );

  const handleAuthenticate = useCallback(
    async (serverId: string) => {
      const server = mcpServers.find((candidate) => candidate.id === serverId);
      if (!server) {
        return;
      }

      try {
        await mcpManager.authenticateServer(server);
      } catch (error: unknown) {
        Alert.alert(
          t('common.error'),
          error instanceof Error ? error.message : 'Authentication failed.',
        );
      }

      await refresh();
    },
    [mcpServers, refresh, t],
  );

  const handleEditServer = useCallback(
    (serverId: string) => {
      const server = mcpServers.find((candidate) => candidate.id === serverId);
      if (!server) {
        return;
      }

      (navigation as any).navigate('Settings', {
        section: 'mcp-edit',
        serverId: server.id,
      });
    },
    [mcpServers, navigation],
  );

  const handleRemoveServer = useCallback(
    (serverId: string) => {
      const server = mcpServers.find((candidate) => candidate.id === serverId);
      if (!server) {
        return;
      }

      Alert.alert(t('settings.deleteMcpServer'), t('settings.deleteMcpConfirm'), [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('common.delete'),
          style: 'destructive',
          onPress: async () => {
            mcpManager.disconnectServer(serverId);
            await mcpManager.clearServerAuth(serverId);
            removeMcpServer(serverId);
            await refresh();
          },
        },
      ]);
    },
    [mcpServers, refresh, removeMcpServer, t],
  );

  const selectedRemote = useMemo(() => {
    if (!installEntry || !selectedRemoteId) return null;
    return installEntry.remotes.find((remote) => remote.id === selectedRemoteId) || null;
  }, [installEntry, selectedRemoteId]);

  const installFields = useMemo<McpHubInputSpec[]>(() => {
    return selectedRemote ? getRemoteInputs(selectedRemote) : [];
  }, [selectedRemote]);

  const closeInstallModal = useCallback(() => {
    setInstallEntry(null);
    setSelectedRemoteId(null);
    setInstallValues({});
  }, []);

  const getTransportLabel = useCallback(
    (transport?: McpServerConfig['transport']) => {
      switch (transport) {
        case 'streamable-http':
          return t('mcpStatus.transportHttp');
        case 'sse':
          return t('mcpStatus.transportSse');
        default:
          return t('mcpStatus.transportAuto');
      }
    },
    [t],
  );

  const getAuthLabel = useCallback(
    (server?: McpServerConfig, status?: McpServerStatus) => {
      if (status?.authRequired) {
        return t('mcpStatus.oauthRequired');
      }
      if (status?.authState === 'authenticated' || server?.oauth) {
        return t('mcpStatus.oauthConnected');
      }

      const authMode = server?.capabilities?.authMode || 'none';

      switch (authMode) {
        case 'header':
          return t('mcpStatus.headerAuth');
        case 'variable':
          return t('mcpStatus.variableAuth');
        case 'mixed':
          return t('mcpStatus.mixedAuth');
        case 'oauth':
          return t('mcpStatus.oauthConnected');
        default:
          return t('mcpStatus.noAuth');
      }
    },
    [t],
  );

  const getBrowseChips = useCallback(
    (entry: McpHubEntry) => {
      const chips = [t('mcpStatus.officialRegistry')];
      for (const transport of entry.capabilities?.transports || []) {
        chips.push(getTransportLabel(transport));
      }
      if (entry.capabilities?.authMode && entry.capabilities.authMode !== 'none') {
        const authLabelByMode = {
          header: t('mcpStatus.headerAuth'),
          variable: t('mcpStatus.variableAuth'),
          mixed: t('mcpStatus.mixedAuth'),
          oauth: t('mcpStatus.oauthConnected'),
        } as const;
        chips.push(
          authLabelByMode[entry.capabilities.authMode as keyof typeof authLabelByMode] ||
            t('mcpStatus.noAuth'),
        );
      } else {
        chips.push(t('mcpStatus.noAuth'));
      }
      if (entry.capabilities?.requiresConfiguration) {
        chips.push(t('mcpStatus.configurationRequired'));
      }
      if (entry.capabilities?.requiresSecrets) {
        chips.push(t('mcpStatus.secretsRequired'));
      }
      return chips;
    },
    [getTransportLabel, t],
  );

  const getInstalledChips = useCallback(
    (server: McpServerConfig, status?: McpServerStatus) => {
      const normalizedServer = normalizeMcpServerConfigMetadata(server);
      const chips = [
        normalizedServer.trust?.source === 'official-registry'
          ? t('mcpStatus.officialRegistry')
          : t('mcpStatus.manualServer'),
        getTransportLabel(
          normalizedServer.capabilities?.transport || normalizedServer.transport || 'auto',
        ),
        getAuthLabel(normalizedServer, status),
      ];
      if (normalizedServer.capabilities?.requiresConfiguration) {
        chips.push(t('mcpStatus.configurationRequired'));
      }
      return chips;
    },
    [getAuthLabel, getTransportLabel, t],
  );

  const completeInstall = useCallback(
    async (entry: McpHubEntry, remoteId?: string | null, values?: Record<string, string>) => {
      const remote = entry.remotes.find(
        (candidate) => candidate.id === (remoteId || entry.remotes[0]?.id),
      );
      if (!remote) {
        return;
      }

      setInstallingId(entry.id);
      setInstallingLabel(entry.name);
      try {
        const draft = buildMcpInstallDraft(entry, remote, values || {});
        addMcpServer(draft.config);
        setActiveTab('installed');
        refresh(useSettingsStore.getState().mcpServers);
        try {
          await mcpManager.connectServer(draft.config);
        } catch {
          const status = mcpManager.getStatus(draft.config.id);
          if (!status?.authRequired) {
            throw new Error(status?.error || t('mcpStatus.installFailed'));
          }

          await mcpManager.authenticateServer(draft.config);
        }
        closeInstallModal();
        refresh(useSettingsStore.getState().mcpServers);
        Alert.alert(t('mcpStatus.installSuccess'), draft.config.name);
      } catch (err: unknown) {
        const errObj =
          err != null && typeof err === 'object' ? (err as Record<string, unknown>) : {};
        setActiveTab('installed');
        refresh(useSettingsStore.getState().mcpServers);
        Alert.alert(
          t('common.error'),
          err instanceof Error ? err.message : t('mcpStatus.installFailed'),
          errObj.code === 'configuration_required'
            ? [
                { text: t('common.cancel'), style: 'cancel' },
                {
                  text: t('common.edit'),
                  onPress: () => {
                    const latestServer = useSettingsStore
                      .getState()
                      .mcpServers.find(
                        (server) => server.name === entry.name || server.url === remote.url,
                      );
                    if (latestServer) {
                      handleEditServer(latestServer.id);
                    }
                  },
                },
              ]
            : undefined,
        );
      } finally {
        setInstallingId(null);
        setInstallingLabel(null);
      }
    },
    [addMcpServer, closeInstallModal, handleEditServer, refresh, t],
  );

  const handleInstallPress = useCallback(
    (entry: McpHubEntry) => {
      const remote = entry.remotes[0];
      const hasMultipleRemotes = entry.remotes.length > 1;
      const requiresSetup = remote ? getRemoteInputs(remote).length > 0 : true;

      if (!hasMultipleRemotes && remote && !requiresSetup) {
        void completeInstall(entry, remote.id, {});
        return;
      }

      setInstallEntry(entry);
      setSelectedRemoteId(remote?.id || null);
      setInstallValues(buildInstallValueDefaults(remote || null));
    },
    [completeInstall],
  );

  const stateColor = (state: McpServerStatus['state']) => {
    switch (state) {
      case 'connected':
        return colors.success;
      case 'connecting':
        return colors.warning;
      case 'error':
        return colors.danger;
      default:
        return colors.textTertiary;
    }
  };

  const stateIcon = (state: McpServerStatus['state']) => {
    switch (state) {
      case 'connected':
        return <CheckCircle2 size={16} color={colors.success} />;
      case 'error':
        return <XCircle size={16} color={colors.danger} />;
      default:
        return <Server size={16} color={colors.textTertiary} />;
    }
  };

  const renderServer = ({ item }: { item: McpServerStatus }) => {
    const server = mcpServers.find((candidate) => candidate.id === item.id);
    const normalizedServer = server ? normalizeMcpServerConfigMetadata(server) : undefined;
    const metadataChips = server
      ? getInstalledChips(server, item)
      : [t('mcpStatus.manualServer'), getTransportLabel('auto')];

    return (
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          {stateIcon(item.state)}
          <Text style={styles.serverName}>{item.name}</Text>
          <View style={[styles.stateBadge, { backgroundColor: stateColor(item.state) + '22' }]}>
            <Text style={[styles.stateText, { color: stateColor(item.state) }]}>{item.state}</Text>
          </View>
        </View>

        {item.error && (
          <Text style={styles.errorText} numberOfLines={2}>
            {item.error}
          </Text>
        )}

        <View style={styles.metaChipRow}>
          {metadataChips.map((chip) => (
            <View key={`${item.id}-${chip}`} style={styles.metaChip}>
              <Text style={styles.metaChipText}>{chip}</Text>
            </View>
          ))}
        </View>

        {normalizedServer?.trust?.registryName ? (
          <Text style={styles.metadataText}>
            {t('mcpStatus.registryName', { name: normalizedServer.trust.registryName })}
          </Text>
        ) : null}

        {normalizedServer?.trust?.websiteUrl ? (
          <Text style={styles.metadataText}>
            {t('mcpStatus.website', { url: normalizedServer.trust.websiteUrl })}
          </Text>
        ) : null}

        {item.tools.length > 0 && (
          <View style={styles.toolsSection}>
            <Text style={styles.toolsLabel}>
              <Wrench size={12} color={colors.textTertiary} />{' '}
              {t('mcpStatus.tools', { count: String(item.tools.length) })}
            </Text>
            <View style={styles.toolsList}>
              {item.tools.slice(0, 8).map((tool) => (
                <View key={tool.name} style={styles.toolChip}>
                  <Text style={styles.toolChipText}>{tool.name}</Text>
                </View>
              ))}
              {item.tools.length > 8 && (
                <Text style={styles.toolsMore}>
                  {t('mcpStatus.more', { count: String(item.tools.length - 8) })}
                </Text>
              )}
            </View>
          </View>
        )}

        <View style={styles.actionRow}>
          {item.authRequired ? (
            <TouchableOpacity
              style={styles.reconnectBtn}
              onPress={() => handleAuthenticate(item.id)}
              accessibilityRole="button"
              accessibilityLabel={t('mcpStatus.authenticateServer', { name: item.name || item.id })}
            >
              <Text style={styles.reconnectText}>{t('mcpStatus.authenticate')}</Text>
            </TouchableOpacity>
          ) : item.state !== 'connected' ? (
            <TouchableOpacity
              style={styles.reconnectBtn}
              onPress={() => handleReconnect(item.id)}
              accessibilityRole="button"
              accessibilityLabel={t('mcpStatus.reconnectServer', { name: item.name || item.id })}
            >
              <RefreshCw size={14} color={colors.primary} />
              <Text style={styles.reconnectText}>{t('mcpStatus.reconnect')}</Text>
            </TouchableOpacity>
          ) : null}

          <TouchableOpacity
            style={styles.secondaryActionBtn}
            onPress={() => handleEditServer(item.id)}
            accessibilityRole="button"
            accessibilityLabel={t('settings.editNamedMcpServer', { name: item.name || item.id })}
          >
            <Settings size={14} color={colors.textSecondary} />
            <Text style={styles.secondaryActionText}>{t('common.edit')}</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.secondaryActionBtn}
            onPress={() => handleRemoveServer(item.id)}
            accessibilityRole="button"
            accessibilityLabel={`Remove ${item.name || item.id}`}
          >
            <Trash2 size={14} color={colors.danger} />
            <Text style={[styles.secondaryActionText, { color: colors.danger }]}>
              {t('common.remove')}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  const renderBrowseEntry = ({ item }: { item: McpHubEntry }) => {
    const installed = mcpServers.some(
      (server) =>
        server.name === item.name || item.remotes.some((remote) => remote.url === server.url),
    );
    return (
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <Server size={16} color={colors.primary} />
          <Text style={styles.serverName}>{item.name}</Text>
          {installed ? (
            <Text style={[styles.remoteMetaText, { color: colors.success }]}>
              {t('mcpStatus.installed')}
            </Text>
          ) : (
            <TouchableOpacity
              style={styles.installBtn}
              onPress={() => handleInstallPress(item)}
              disabled={installingId === item.id}
              accessibilityRole="button"
              accessibilityLabel={t('mcpStatus.install')}
            >
              {installingId === item.id ? (
                <ActivityIndicator size="small" color={colors.primary} />
              ) : (
                <>
                  <Download size={16} color={colors.primary} />
                  <Text style={styles.installBtnText}>{t('mcpStatus.install')}</Text>
                </>
              )}
            </TouchableOpacity>
          )}
        </View>

        {item.description ? (
          <Text style={styles.description} numberOfLines={3}>
            {item.description}
          </Text>
        ) : null}

        <View style={styles.metaChipRow}>
          {getBrowseChips(item).map((chip) => (
            <View key={`${item.id}-${chip}`} style={styles.metaChip}>
              <Text style={styles.metaChipText}>{chip}</Text>
            </View>
          ))}
        </View>

        <Text style={styles.metadataText}>
          {t('mcpStatus.registryName', { name: item.trust?.registryName || item.registryName })}
        </Text>
        {item.websiteUrl ? (
          <Text style={styles.metadataText}>
            {t('mcpStatus.website', { url: item.websiteUrl })}
          </Text>
        ) : null}

        <View style={styles.remoteMetaRow}>
          <Text style={styles.remoteMetaText}>
            {t('mcpStatus.remoteCount', { count: String(item.remotes.length) })}
          </Text>
          <Text style={styles.remoteMetaText}>
            {t('mcpStatus.version', { version: item.version })}
          </Text>
        </View>

        <View style={styles.toolsList}>
          {item.remotes.slice(0, 3).map((remote) => (
            <View key={remote.id} style={styles.toolChip}>
              <Text style={styles.toolChipText}>{remote.label}</Text>
            </View>
          ))}
        </View>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity
          onPress={handleBack}
          accessibilityRole="button"
          accessibilityLabel={t('common.back')}
        >
          <ArrowLeft size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{t('mcpStatus.title')}</Text>
        <TouchableOpacity
          onPress={() => refresh()}
          accessibilityRole="button"
          accessibilityLabel={t('common.refresh')}
        >
          <RefreshCw size={20} color={colors.primary} />
        </TouchableOpacity>
      </View>

      <View style={styles.tabRow}>
        <TouchableOpacity
          style={[styles.tabBtn, activeTab === 'installed' && styles.tabBtnActive]}
          onPress={() => setActiveTab('installed')}
        >
          <Text style={[styles.tabText, activeTab === 'installed' && styles.tabTextActive]}>
            {t('mcpStatus.installedTab')}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tabBtn, activeTab === 'browse' && styles.tabBtnActive]}
          onPress={() => {
            setActiveTab('browse');
            if (hubEntries.length === 0) {
              void loadHubEntries('refresh');
            }
          }}
        >
          <Text style={[styles.tabText, activeTab === 'browse' && styles.tabTextActive]}>
            {t('mcpStatus.browseTab')}
          </Text>
        </TouchableOpacity>
      </View>

      {installingId && installingLabel ? (
        <View style={styles.installingBanner}>
          <ActivityIndicator size="small" color={colors.primary} />
          <Text style={styles.installingBannerText}>
            {t('mcpStatus.install')} {installingLabel}...
          </Text>
        </View>
      ) : null}

      {activeTab === 'installed' ? (
        <FlatList
          data={statuses}
          keyExtractor={(s) => s.id}
          contentContainerStyle={styles.list}
          renderItem={renderServer}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Server size={40} color={colors.textTertiary} />
              <Text style={styles.emptyTitle}>{t('mcpStatus.noServers')}</Text>
              <Text style={styles.emptyText}>{t('mcpStatus.noServersHint')}</Text>
              <TouchableOpacity
                style={styles.settingsBtn}
                onPress={() => (navigation as any).navigate('Settings')}
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
            <TouchableOpacity
              style={styles.searchBtn}
              onPress={() => {
                void loadHubEntries('refresh');
              }}
              accessibilityRole="button"
              accessibilityLabel={t('common.search')}
            >
              <Search size={18} color={colors.primary} />
            </TouchableOpacity>
          </View>

          {hubLoading ? (
            <ActivityIndicator style={{ padding: 40 }} color={colors.primary} />
          ) : (
            <FlatList
              data={hubEntries}
              keyExtractor={(entry) => entry.id}
              contentContainerStyle={styles.list}
              renderItem={renderBrowseEntry}
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

      <Modal
        visible={!!installEntry}
        transparent
        animationType="slide"
        onRequestClose={() => setInstallEntry(null)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>{t('mcpStatus.installServer')}</Text>
              <TouchableOpacity
                onPress={closeInstallModal}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel={t('common.close')}
              >
                <X size={20} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>

            {installEntry ? (
              <>
                <Text style={styles.modalHelp}>{installEntry.name}</Text>
                <Text style={styles.modalCaption}>{t('mcpStatus.installHint')}</Text>
                <View style={styles.metaChipRow}>
                  {getBrowseChips(installEntry).map((chip) => (
                    <View key={`modal-${installEntry.id}-${chip}`} style={styles.metaChip}>
                      <Text style={styles.metaChipText}>{chip}</Text>
                    </View>
                  ))}
                </View>
                <Text style={styles.metadataText}>
                  {t('mcpStatus.registryName', {
                    name: installEntry.trust?.registryName || installEntry.registryName,
                  })}
                </Text>
                {installEntry.websiteUrl ? (
                  <Text style={styles.metadataText}>
                    {t('mcpStatus.website', { url: installEntry.websiteUrl })}
                  </Text>
                ) : null}

                {installEntry.remotes.length > 1 ? (
                  <>
                    <Text style={styles.fieldLabel}>{t('mcpStatus.endpoint')}</Text>
                    <View style={styles.remotePickerRow}>
                      {installEntry.remotes.map((remote) => (
                        <TouchableOpacity
                          key={remote.id}
                          style={[
                            styles.remotePickerChip,
                            selectedRemoteId === remote.id && styles.remotePickerChipActive,
                          ]}
                          onPress={() => {
                            setSelectedRemoteId(remote.id);
                            setInstallValues(buildInstallValueDefaults(remote));
                          }}
                        >
                          <Text
                            style={[
                              styles.remotePickerChipText,
                              selectedRemoteId === remote.id && styles.remotePickerChipTextActive,
                            ]}
                          >
                            {remote.label}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  </>
                ) : null}

                {installFields.map((field) => (
                  <View key={`${field.kind}:${field.key}`} style={styles.fieldBlock}>
                    <Text style={styles.fieldLabel}>
                      {field.label}
                      {field.required ? ' *' : ''}
                    </Text>
                    {field.description ? (
                      <Text style={styles.fieldHint}>{field.description}</Text>
                    ) : null}
                    <TextInput
                      style={styles.searchInput}
                      value={installValues[field.key] || ''}
                      onChangeText={(text) =>
                        setInstallValues((current) => ({ ...current, [field.key]: text }))
                      }
                      placeholder={field.defaultValue || field.label}
                      placeholderTextColor={colors.placeholder}
                      secureTextEntry={field.secret}
                      autoCapitalize="none"
                      autoCorrect={false}
                    />
                  </View>
                ))}

                <TouchableOpacity
                  style={styles.primaryActionBtn}
                  onPress={() => {
                    void completeInstall(installEntry, selectedRemoteId, installValues);
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={t('mcpStatus.install')}
                >
                  <Text style={styles.primaryActionText}>{t('mcpStatus.install')}</Text>
                </TouchableOpacity>
              </>
            ) : null}
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
};

const createStyles = (colors: AppPalette) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
    header: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingHorizontal: 16,
      paddingVertical: 12,
      backgroundColor: colors.header,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    headerTitle: {
      fontSize: 18,
      fontWeight: '700',
      color: colors.text,
    },
    tabRow: {
      flexDirection: 'row',
      paddingHorizontal: 16,
      paddingTop: 12,
      gap: 8,
    },
    tabBtn: {
      flex: 1,
      borderRadius: 10,
      paddingVertical: 10,
      alignItems: 'center',
      backgroundColor: colors.surfaceAlt,
      borderWidth: 1,
      borderColor: colors.border,
    },
    tabBtnActive: {
      backgroundColor: colors.primarySoft,
      borderColor: colors.primary,
    },
    tabText: {
      fontSize: 13,
      fontWeight: '600',
      color: colors.textSecondary,
    },
    tabTextActive: {
      color: colors.primary,
    },
    installingBanner: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      marginHorizontal: 16,
      marginTop: 12,
      paddingHorizontal: 14,
      paddingVertical: 12,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: colors.primary,
      backgroundColor: colors.primarySoft,
    },
    installingBannerText: {
      flex: 1,
      fontSize: 13,
      fontWeight: '600',
      color: colors.text,
    },
    list: {
      padding: 16,
      flexGrow: 1,
    },
    browseContainer: {
      flex: 1,
    },
    searchRow: {
      flexDirection: 'row',
      gap: 8,
      paddingHorizontal: 16,
      paddingTop: 16,
    },
    searchInput: {
      backgroundColor: colors.inputBackground,
      borderWidth: 1,
      borderColor: colors.inputBorder,
      borderRadius: 10,
      paddingHorizontal: 14,
      paddingVertical: 10,
      fontSize: 15,
      color: colors.text,
    },
    searchBtn: {
      width: 44,
      borderRadius: 10,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.primarySoft,
      borderWidth: 1,
      borderColor: colors.primary,
    },
    card: {
      backgroundColor: colors.surface,
      borderRadius: 12,
      padding: 16,
      marginBottom: 12,
      borderWidth: 1,
      borderColor: colors.border,
    },
    cardHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    serverName: {
      fontSize: 15,
      fontWeight: '600',
      color: colors.text,
      flex: 1,
    },
    stateBadge: {
      paddingHorizontal: 8,
      paddingVertical: 3,
      borderRadius: 8,
    },
    stateText: {
      fontSize: 11,
      fontWeight: '600',
      textTransform: 'capitalize',
    },
    errorText: {
      fontSize: 12,
      color: colors.danger,
      marginTop: 8,
    },
    description: {
      fontSize: 13,
      color: colors.textSecondary,
      marginTop: 10,
      lineHeight: 18,
    },
    metaChipRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 6,
      marginTop: 10,
    },
    metaChip: {
      backgroundColor: colors.surfaceAlt,
      borderWidth: 1,
      borderColor: colors.subtleBorder,
      paddingHorizontal: 8,
      paddingVertical: 4,
      borderRadius: 999,
    },
    metaChipText: {
      fontSize: 11,
      fontWeight: '600',
      color: colors.textSecondary,
    },
    metadataText: {
      fontSize: 12,
      color: colors.textTertiary,
      marginTop: 8,
      lineHeight: 17,
    },
    toolsSection: {
      marginTop: 12,
    },
    toolsLabel: {
      fontSize: 12,
      color: colors.textTertiary,
      marginBottom: 6,
    },
    toolsList: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 6,
    },
    toolChip: {
      backgroundColor: colors.surfaceAlt,
      paddingHorizontal: 8,
      paddingVertical: 4,
      borderRadius: 6,
    },
    toolChipText: {
      fontSize: 11,
      color: colors.textSecondary,
      fontFamily: 'monospace',
    },
    toolsMore: {
      fontSize: 11,
      color: colors.textTertiary,
      alignSelf: 'center',
    },
    installBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingHorizontal: 10,
      paddingVertical: 6,
      borderRadius: 8,
      backgroundColor: colors.primarySoft,
    },
    installBtnText: {
      fontSize: 12,
      fontWeight: '600',
      color: colors.primary,
    },
    remoteMetaRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginTop: 12,
    },
    remoteMetaText: {
      fontSize: 12,
      color: colors.textTertiary,
    },
    reconnectBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      paddingVertical: 8,
      paddingHorizontal: 12,
      borderRadius: 8,
      backgroundColor: colors.primarySoft,
    },
    reconnectText: {
      fontSize: 13,
      color: colors.primary,
      fontWeight: '500',
    },
    actionRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8,
      marginTop: 12,
    },
    secondaryActionBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderRadius: 8,
      backgroundColor: colors.surfaceAlt,
      borderWidth: 1,
      borderColor: colors.border,
    },
    secondaryActionText: {
      fontSize: 13,
      color: colors.textSecondary,
      fontWeight: '500',
    },
    empty: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      padding: 40,
      marginTop: 60,
    },
    emptyTitle: {
      fontSize: 18,
      fontWeight: '600',
      color: colors.textSecondary,
      marginTop: 16,
    },
    emptyText: {
      fontSize: 14,
      color: colors.textTertiary,
      textAlign: 'center',
      marginTop: 8,
      lineHeight: 20,
    },
    settingsBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      backgroundColor: colors.primary,
      paddingHorizontal: 20,
      paddingVertical: 12,
      borderRadius: 10,
      marginTop: 20,
    },
    settingsBtnText: {
      color: '#fff',
      fontSize: 15,
      fontWeight: '600',
    },
    browseIntroCard: {
      backgroundColor: colors.surfaceAlt,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: colors.border,
      padding: 14,
      marginBottom: 12,
    },
    browseIntroTitle: {
      fontSize: 15,
      fontWeight: '700',
      color: colors.text,
      marginBottom: 4,
    },
    browseIntroText: {
      fontSize: 13,
      color: colors.textSecondary,
      lineHeight: 18,
    },
    listFooter: {
      paddingVertical: 18,
    },
    modalOverlay: {
      flex: 1,
      justifyContent: 'flex-end',
      backgroundColor: 'rgba(0, 0, 0, 0.45)',
    },
    modalContent: {
      backgroundColor: colors.surface,
      borderTopLeftRadius: 18,
      borderTopRightRadius: 18,
      padding: 20,
      gap: 12,
      borderTopWidth: 1,
      borderColor: colors.border,
    },
    modalHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
    },
    modalTitle: {
      fontSize: 17,
      fontWeight: '700',
      color: colors.text,
    },
    modalHelp: {
      fontSize: 15,
      fontWeight: '600',
      color: colors.text,
    },
    modalCaption: {
      fontSize: 13,
      color: colors.textSecondary,
      lineHeight: 18,
    },
    fieldBlock: {
      gap: 6,
    },
    fieldLabel: {
      fontSize: 13,
      fontWeight: '600',
      color: colors.textSecondary,
    },
    fieldHint: {
      fontSize: 12,
      color: colors.textTertiary,
      lineHeight: 17,
    },
    remotePickerRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8,
    },
    remotePickerChip: {
      paddingHorizontal: 10,
      paddingVertical: 8,
      borderRadius: 999,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surfaceAlt,
    },
    remotePickerChipActive: {
      borderColor: colors.primary,
      backgroundColor: colors.primarySoft,
    },
    remotePickerChipText: {
      fontSize: 12,
      color: colors.textSecondary,
      fontWeight: '600',
    },
    remotePickerChipTextActive: {
      color: colors.primary,
    },
    primaryActionBtn: {
      marginTop: 4,
      borderRadius: 10,
      paddingVertical: 12,
      alignItems: 'center',
      backgroundColor: colors.primary,
    },
    primaryActionText: {
      color: colors.onPrimary,
      fontSize: 15,
      fontWeight: '700',
    },
  });
