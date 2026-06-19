import { StyleSheet } from 'react-native';
import type { AppPalette } from '../../theme/useAppTheme';
import { createSettingsScreenBaseStyleFragments } from './settingsScreenBaseStyleFragments';
import { createSettingsScreenConfigStyleFragments } from './settingsScreenConfigStyleFragments';
import { createSettingsScreenReviewStyleFragments } from './settingsScreenReviewStyleFragments';

export const createSettingsScreenStyles = (colors: AppPalette) =>
  StyleSheet.create({
    ...createSettingsScreenBaseStyleFragments(colors),
    ...createSettingsScreenConfigStyleFragments(colors),
    ...createSettingsScreenReviewStyleFragments(colors),
  } as Record<string, any>);

export type SettingsScreenStyles = ReturnType<typeof createSettingsScreenStyles>;
