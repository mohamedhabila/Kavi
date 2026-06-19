import React, { useMemo } from 'react';

import type { AppPalette } from '../../theme/useAppTheme';
import { SettingsBrowserModalAdapter } from './SettingsBrowserModalAdapter';
import { SettingsExpoModalAdapter } from './SettingsExpoModalAdapter';
import { SettingsMcpModalAdapter } from './SettingsMcpModalAdapter';
import { createSettingsRemoteConfigModalStyles } from './SettingsRemoteConfigModalStyles';
import { SettingsSshModalAdapter } from './SettingsSshModalAdapter';
import { SettingsWorkspaceModalAdapter } from './SettingsWorkspaceModalAdapter';
import type { useSettingsRemoteConfigFlow } from './useSettingsRemoteConfigFlow';

type TranslationFn = (key: string, params?: any) => string;
type SettingsRemoteConfigModalGroups = ReturnType<
  typeof useSettingsRemoteConfigFlow
>['modalGroups'];

type SettingsRemoteConfigModalsProps = {
  colors: AppPalette;
  t: TranslationFn;
  isWide: boolean;
  modalGroups: SettingsRemoteConfigModalGroups;
};

export const SettingsRemoteConfigModals: React.FC<SettingsRemoteConfigModalsProps> = ({
  colors,
  t,
  isWide,
  modalGroups,
}) => {
  const { editorStyles, shellStyles } = useMemo(
    () => createSettingsRemoteConfigModalStyles(colors),
    [colors],
  );
  const { visibility, workspace, ssh, browser, expo, mcp } = modalGroups;

  return (
    <>
      <SettingsWorkspaceModalAdapter
        colors={colors}
        styles={editorStyles}
        shellStyles={shellStyles}
        t={t}
        showWorkspaceEditor={visibility.showWorkspaceEditor}
        {...workspace}
      />
      <SettingsSshModalAdapter
        colors={colors}
        styles={editorStyles}
        shellStyles={shellStyles}
        t={t}
        isWide={isWide}
        showSshEditor={visibility.showSshEditor}
        {...ssh}
      />
      <SettingsBrowserModalAdapter
        colors={colors}
        styles={editorStyles}
        shellStyles={shellStyles}
        t={t}
        showBrowserEditor={visibility.showBrowserEditor}
        {...browser}
      />
      <SettingsExpoModalAdapter
        colors={colors}
        styles={editorStyles}
        shellStyles={shellStyles}
        t={t}
        isWide={isWide}
        showExpoEditor={visibility.showExpoEditor}
        {...expo}
      />
      <SettingsMcpModalAdapter
        colors={colors}
        styles={editorStyles}
        shellStyles={shellStyles}
        t={t}
        showMcpEditor={visibility.showMcpEditor}
        {...mcp}
      />
    </>
  );
};
