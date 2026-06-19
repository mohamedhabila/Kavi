import { StyleSheet } from 'react-native';
import type { AppPalette } from '../../theme/useAppTheme';
import { createRemoteWorkScreenOverviewStyleFragments } from './remoteWorkScreenOverviewStyleFragments';
import { createRemoteWorkScreenSessionStyleFragments } from './remoteWorkScreenSessionStyleFragments';
import { createRemoteWorkScreenWorkspaceStyleFragments } from './remoteWorkScreenWorkspaceStyleFragments';

export const createRemoteWorkScreenStyles = (colors: AppPalette) =>
  StyleSheet.create({
    ...createRemoteWorkScreenOverviewStyleFragments(colors),
    ...createRemoteWorkScreenWorkspaceStyleFragments(colors),
    ...createRemoteWorkScreenSessionStyleFragments(colors),
  } as Record<string, any>);

export type RemoteWorkScreenStyles = ReturnType<typeof createRemoteWorkScreenStyles>;
