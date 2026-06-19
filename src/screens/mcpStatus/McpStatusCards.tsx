import React from 'react';
import { ActivityIndicator, Text, TouchableOpacity, View } from 'react-native';
import {
  CheckCircle2,
  Download,
  RefreshCw,
  Server,
  Settings,
  Trash2,
  Wrench,
  XCircle,
} from 'lucide-react-native';

import type { McpHubEntry } from '../../services/mcp/registryClient';
import { normalizeMcpServerConfigMetadata } from '../../services/mcp/metadata';
import type { McpServerStatus } from '../../services/mcp/manager';
import type { McpServerConfig } from '../../types/remote';
import type { McpStatusPalette, McpStatusStyles, McpStatusTranslation } from './mcpStatusTypes';

type InstalledServerCardProps = {
  colors: McpStatusPalette;
  getInstalledChips: (server: McpServerConfig, status?: McpServerStatus) => string[];
  getTransportLabel: (transport?: McpServerConfig['transport']) => string;
  item: McpServerStatus;
  mcpServers: McpServerConfig[];
  onAuthenticate: (serverId: string) => void;
  onEditServer: (serverId: string) => void;
  onReconnect: (serverId: string) => void;
  onRemoveServer: (serverId: string) => void;
  styles: McpStatusStyles;
  t: McpStatusTranslation;
};

function stateColor(colors: McpStatusPalette, state: McpServerStatus['state']) {
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
}

function stateIcon(colors: McpStatusPalette, state: McpServerStatus['state']) {
  switch (state) {
    case 'connected':
      return <CheckCircle2 size={16} color={colors.success} />;
    case 'error':
      return <XCircle size={16} color={colors.danger} />;
    default:
      return <Server size={16} color={colors.textTertiary} />;
  }
}

export function InstalledServerCard({
  colors,
  getInstalledChips,
  getTransportLabel,
  item,
  mcpServers,
  onAuthenticate,
  onEditServer,
  onReconnect,
  onRemoveServer,
  styles,
  t,
}: InstalledServerCardProps) {
  const server = mcpServers.find((candidate) => candidate.id === item.id);
  const normalizedServer = server ? normalizeMcpServerConfigMetadata(server) : undefined;
  const metadataChips = server
    ? getInstalledChips(server, item)
    : [t('mcpStatus.manualServer'), getTransportLabel('auto')];
  const statusColor = stateColor(colors, item.state);

  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        {stateIcon(colors, item.state)}
        <Text style={styles.serverName}>{item.name}</Text>
        <View style={[styles.stateBadge, { backgroundColor: `${statusColor}22` }]}>
          <Text style={[styles.stateText, { color: statusColor }]}>{item.state}</Text>
        </View>
      </View>

      {item.error ? (
        <Text style={styles.errorText} numberOfLines={2}>
          {item.error}
        </Text>
      ) : null}

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

      {item.tools.length > 0 ? (
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
            {item.tools.length > 8 ? (
              <Text style={styles.toolsMore}>
                {t('mcpStatus.more', { count: String(item.tools.length - 8) })}
              </Text>
            ) : null}
          </View>
        </View>
      ) : null}

      <View style={styles.actionRow}>
        {item.authRequired ? (
          <TouchableOpacity
            style={styles.reconnectBtn}
            onPress={() => onAuthenticate(item.id)}
            accessibilityRole="button"
            accessibilityLabel={t('mcpStatus.authenticateServer', { name: item.name || item.id })}
          >
            <Text style={styles.reconnectText}>{t('mcpStatus.authenticate')}</Text>
          </TouchableOpacity>
        ) : item.state !== 'connected' ? (
          <TouchableOpacity
            style={styles.reconnectBtn}
            onPress={() => onReconnect(item.id)}
            accessibilityRole="button"
            accessibilityLabel={t('mcpStatus.reconnectServer', { name: item.name || item.id })}
          >
            <RefreshCw size={14} color={colors.primary} />
            <Text style={styles.reconnectText}>{t('mcpStatus.reconnect')}</Text>
          </TouchableOpacity>
        ) : null}

        <TouchableOpacity
          style={styles.secondaryActionBtn}
          onPress={() => onEditServer(item.id)}
          accessibilityRole="button"
          accessibilityLabel={t('settings.editNamedMcpServer', { name: item.name || item.id })}
        >
          <Settings size={14} color={colors.textSecondary} />
          <Text style={styles.secondaryActionText}>{t('common.edit')}</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.secondaryActionBtn}
          onPress={() => onRemoveServer(item.id)}
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
}

type BrowseEntryCardProps = {
  colors: McpStatusPalette;
  getBrowseChips: (entry: McpHubEntry) => string[];
  installingId: string | null;
  item: McpHubEntry;
  mcpServers: McpServerConfig[];
  onInstallPress: (entry: McpHubEntry) => void;
  styles: McpStatusStyles;
  t: McpStatusTranslation;
};

export function BrowseEntryCard({
  colors,
  getBrowseChips,
  installingId,
  item,
  mcpServers,
  onInstallPress,
  styles,
  t,
}: BrowseEntryCardProps) {
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
            onPress={() => onInstallPress(item)}
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
        <Text style={styles.metadataText}>{t('mcpStatus.website', { url: item.websiteUrl })}</Text>
      ) : null}

      <View style={styles.remoteMetaRow}>
        <Text style={styles.remoteMetaText}>
          {t('mcpStatus.remoteCount', { count: String(item.remotes.length) })}
        </Text>
        <Text style={styles.remoteMetaText}>{t('mcpStatus.version', { version: item.version })}</Text>
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
}
