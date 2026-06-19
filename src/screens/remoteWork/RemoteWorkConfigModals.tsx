import React, { useMemo } from 'react';

import { RemoteConfigModals } from '../../features/remoteConfig/components/RemoteConfigModals';
import type { AppPalette } from '../../theme/useAppTheme';
import type { useRemoteWorkConfigStudioFlow } from './useRemoteWorkConfigStudioFlow';

type TranslationFn = (key: string, params?: any) => string;
type StyleMap = Record<string, any>;
type RemoteWorkConfigModalGroups = ReturnType<typeof useRemoteWorkConfigStudioFlow>['modalGroups'];

type RemoteWorkConfigModalsProps = {
  colors: AppPalette;
  styles: StyleMap;
  t: TranslationFn;
  isWide: boolean;
  modalGroups: RemoteWorkConfigModalGroups;
};

export const RemoteWorkConfigModals: React.FC<RemoteWorkConfigModalsProps> = ({
  colors,
  styles,
  t,
  isWide,
  modalGroups,
}) => {
  const shellStyles = useMemo(
    () => ({
      container: styles.sessionContainer,
      header: styles.header,
      titleWrap: styles.sessionTitleWrap,
      title: styles.headerTitle,
      subtitle: styles.sessionSubtitle,
      body: styles.content,
    }),
    [styles],
  );
  const { visibility, workspace, ssh, browser, expo, mcp } = modalGroups;

  return (
    <RemoteConfigModals
      colors={colors}
      styles={styles}
      shellStyles={shellStyles}
      t={t}
      isWide={isWide}
      showWorkspaceEditor={visibility.showWorkspaceEditor}
      showSshEditor={visibility.showSshEditor}
      showBrowserEditor={visibility.showBrowserEditor}
      showExpoEditor={visibility.showExpoEditor}
      showMcpEditor={visibility.showMcpEditor}
      {...workspace}
      {...ssh}
      {...browser}
      {...expo}
      {...mcp}
    />
  );
};
