import { ChevronRight, Plus, Server } from 'lucide-react-native';
import React from 'react';
import { Text, TouchableOpacity, View } from 'react-native';

import { normalizeMcpServerConfigMetadata } from '../../services/mcp/metadata';
import type { AppPalette } from '../../theme/useAppTheme';
import type { McpServerConfig } from '../../types/remote';

type TranslationFn = (key: string, params?: any) => string;
type StyleMap = Record<string, any>;

type SettingsMcpSurfacesProps = {
  colors: AppPalette;
  styles: StyleMap;
  t: TranslationFn;
  mcpServers: McpServerConfig[];
  getMcpMetadataChips: (server: McpServerConfig) => string[];
  handleNewMcp: () => void;
  handleEditMcp: (server: McpServerConfig) => void | Promise<void>;
};

export const SettingsMcpSurfaces: React.FC<SettingsMcpSurfacesProps> = ({
  colors,
  styles,
  t,
  mcpServers,
  getMcpMetadataChips,
  handleNewMcp,
  handleEditMcp,
}) => (
  <>
    <View style={styles.sectionHeader}>
      <Text style={styles.sectionTitle}>{t('settings.mcpServers')}</Text>
      <TouchableOpacity
        onPress={handleNewMcp}
        accessibilityRole="button"
        accessibilityLabel={t('settings.addMcpServer')}
      >
        <Plus size={20} color={colors.primary} />
      </TouchableOpacity>
    </View>

    {mcpServers.map((server) => {
      const normalizedServer = normalizeMcpServerConfigMetadata(server);
      return (
        <TouchableOpacity
          key={server.id}
          style={styles.listItem}
          onPress={() => void handleEditMcp(server)}
          accessibilityRole="button"
          accessibilityLabel={t('settings.editNamedMcpServer', { name: server.name })}
        >
          <Server size={18} color={server.enabled ? colors.primary : colors.textTertiary} />
          <View style={styles.listItemContent}>
            <Text style={styles.listItemTitle}>{server.name}</Text>
            <Text style={styles.listItemSubtitle}>{server.url}</Text>
            <Text style={styles.listItemSubtitle}>
              {getMcpMetadataChips(normalizedServer).join(' · ')}
            </Text>
          </View>
          <ChevronRight size={18} color={colors.textTertiary} />
        </TouchableOpacity>
      );
    })}

    {mcpServers.length === 0 ? (
      <Text style={styles.emptyText}>{t('settings.noMcpServers')}</Text>
    ) : null}
  </>
);
