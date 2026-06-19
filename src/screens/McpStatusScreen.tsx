// ---------------------------------------------------------------------------
// Kavi — MCP Servers Status Screen
// ---------------------------------------------------------------------------

import React, { useCallback, useMemo, useRef, useState } from 'react';
import { Alert } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useSettingsStore } from '../store/useSettingsStore';
import { mcpManager, McpServerStatus } from '../services/mcp/manager';
import { useAppTheme } from '../theme/useAppTheme';
import { createMcpStatusStyles as createStyles } from './mcpStatus/mcpStatusStyles';
import { McpStatusScreenView } from './mcpStatus/McpStatusScreenView';
import { useTranslation } from '../i18n/useTranslation';
import {
  buildMcpInstallDraft,
  getRemoteInputs,
  listOfficialMcpRegistry,
  McpHubEntry,
  McpHubInputSpec,
} from '../services/mcp/registryClient';
import { normalizeMcpServerConfigMetadata } from '../services/mcp/metadata';
import type { McpServerConfig } from '../types/remote';
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

  const handleInstallRemoteChange = useCallback((remote: McpHubEntry['remotes'][number]) => {
    setSelectedRemoteId(remote.id);
    setInstallValues(buildInstallValueDefaults(remote));
  }, []);

  const handleOpenSettings = useCallback(() => {
    (navigation as any).navigate('Settings');
  }, [navigation]);

  return (
    <McpStatusScreenView
      activeTab={activeTab}
      closeInstallModal={closeInstallModal}
      colors={colors}
      completeInstall={completeInstall}
      getBrowseChips={getBrowseChips}
      getInstalledChips={getInstalledChips}
      getTransportLabel={getTransportLabel}
      handleAuthenticate={handleAuthenticate}
      handleBack={handleBack}
      handleEditServer={handleEditServer}
      handleInstallPress={handleInstallPress}
      handleOpenSettings={handleOpenSettings}
      handleReconnect={handleReconnect}
      handleRemoveServer={handleRemoveServer}
      hubEntries={hubEntries}
      hubLoading={hubLoading}
      hubLoadingMore={hubLoadingMore}
      hubQuery={hubQuery}
      installEntry={installEntry}
      installFields={installFields}
      installingId={installingId}
      installingLabel={installingLabel}
      installValues={installValues}
      loadHubEntries={loadHubEntries}
      mcpServers={mcpServers}
      onInstallRemoteChange={handleInstallRemoteChange}
      refresh={refresh}
      selectedRemoteId={selectedRemoteId}
      setActiveTab={setActiveTab}
      setHubQuery={setHubQuery}
      setInstallValues={setInstallValues}
      statuses={statuses}
      styles={styles}
      t={t}
    />
  );
};
