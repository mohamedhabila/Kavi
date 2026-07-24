import React from 'react';

import type { AppPalette } from '../../theme/useAppTheme';
import type { BrowserProviderConfig, McpServerConfig } from '../../types/remote';
import { SettingsBrowserSurfaces } from './SettingsBrowserSurfaces';
import { SettingsMcpSurfaces } from './SettingsMcpSurfaces';

type TranslationFn = (key: string, params?: any) => string;
type StyleMap = Record<string, any>;

type SettingsConnectionsSurfacesProps = {
  browserProviders: BrowserProviderConfig[];
  colors: AppPalette;
  getBrowserProviderAuthLabel: (authMode?: BrowserProviderConfig['authMode']) => string;
  getMcpMetadataChips: (server: McpServerConfig) => string[];
  handleEditBrowserProvider: (provider: BrowserProviderConfig) => void;
  handleEditMcp: (server: McpServerConfig) => void | Promise<void>;
  handleNewBrowserProvider: () => void;
  handleNewMcp: () => void;
  mcpServers: McpServerConfig[];
  styles: StyleMap;
  t: TranslationFn;
};

export const SettingsConnectionsSurfaces: React.FC<SettingsConnectionsSurfacesProps> = ({
  browserProviders,
  colors,
  getBrowserProviderAuthLabel,
  getMcpMetadataChips,
  handleEditBrowserProvider,
  handleEditMcp,
  handleNewBrowserProvider,
  handleNewMcp,
  mcpServers,
  styles,
  t,
}) => (
  <>
    <SettingsBrowserSurfaces
      browserProviders={browserProviders}
      colors={colors}
      getBrowserProviderAuthLabel={getBrowserProviderAuthLabel}
      handleEditBrowserProvider={handleEditBrowserProvider}
      handleNewBrowserProvider={handleNewBrowserProvider}
      styles={styles}
      t={t}
    />
    <SettingsMcpSurfaces
      colors={colors}
      getMcpMetadataChips={getMcpMetadataChips}
      handleEditMcp={handleEditMcp}
      handleNewMcp={handleNewMcp}
      mcpServers={mcpServers}
      styles={styles}
      t={t}
    />
  </>
);
