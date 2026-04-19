// ---------------------------------------------------------------------------
// Kavi — Theme System
// ---------------------------------------------------------------------------

import { useMemo } from 'react';
import { useColorScheme } from 'react-native';
import { DarkTheme, DefaultTheme } from '@react-navigation/native';
import { useSettingsStore } from '../store/useSettingsStore';

export type ResolvedTheme = 'light' | 'dark';
export type ThemePreference = 'light' | 'dark' | 'system';

export interface AppPalette {
  mode: ResolvedTheme;
  background: string;
  surface: string;
  surfaceAlt: string;
  panel: string;
  header: string;
  border: string;
  subtleBorder: string;
  text: string;
  textSecondary: string;
  textTertiary: string;
  placeholder: string;
  primary: string;
  onPrimary: string;
  primarySoft: string;
  danger: string;
  onDanger: string;
  dangerSoft: string;
  success: string;
  overlay: string;
  userBubble: string;
  assistantBubble: string;
  inputBackground: string;
  inputBorder: string;
  toolCard: string;
  toolCardHeader: string;
  codeBackground: string;
  link: string;
  onPrimaryLink: string;
  warning: string;
  warningBackground: string;
  accent: string;
  info: string;
}

const darkPalette: AppPalette = {
  mode: 'dark',
  background: '#0f0f11',
  surface: '#1a1a1f',
  surfaceAlt: '#242429',
  panel: '#1e1e24',
  header: '#141417',
  border: '#2e2e36',
  subtleBorder: '#3d3d47',
  text: '#f0f0f2',
  textSecondary: '#a0a0a8',
  textTertiary: '#70707a',
  placeholder: '#50505a',
  primary: '#10b981',
  onPrimary: '#ffffff',
  primarySoft: '#0d3d2e',
  danger: '#f87171',
  onDanger: '#0f0f0f',
  dangerSoft: '#3d1f1f',
  success: '#34d399',
  overlay: 'rgba(0,0,0,0.65)',
  userBubble: '#1a5c4a',
  assistantBubble: '#1e1e24',
  inputBackground: '#242429',
  inputBorder: '#3d3d47',
  toolCard: '#1a1a1f',
  toolCardHeader: '#141417',
  codeBackground: '#0a0a0c',
  link: '#34d399',
  onPrimaryLink: '#bbf7d0',
  warning: '#fbbf24',
  warningBackground: '#453509',
  accent: '#10b981',
  info: '#60a5fa',
};

const lightPalette: AppPalette = {
  mode: 'light',
  background: '#e8eaef',
  surface: '#f5f6f8',
  surfaceAlt: '#e4e7ed',
  panel: '#eceef2',
  header: '#eceef2',
  border: '#c7ccd6',
  subtleBorder: '#d5d8e0',
  text: '#1a1d24',
  textSecondary: '#4a5060',
  textTertiary: '#7a8294',
  placeholder: '#a0a8b8',
  primary: '#0d9f6f',
  onPrimary: '#ffffff',
  primarySoft: '#dcf9ee',
  danger: '#e5484d',
  onDanger: '#ffffff',
  dangerSoft: '#fbe9ea',
  success: '#0d9f6f',
  overlay: 'rgba(26,29,36,0.45)',
  userBubble: '#0d9f6f',
  assistantBubble: '#f5f6f8',
  inputBackground: '#e4e7ed',
  inputBorder: '#d5d8e0',
  toolCard: '#eef0f4',
  toolCardHeader: '#e4e7ed',
  codeBackground: '#e8eaef',
  link: '#0a7a54',
  onPrimaryLink: '#d0ffe8',
  warning: '#856404',
  warningBackground: '#FFF3CD',
  accent: '#0d9f6f',
  info: '#3b82f6',
};

export const getPalette = (mode: ResolvedTheme): AppPalette =>
  mode === 'dark' ? darkPalette : lightPalette;

export const useAppTheme = () => {
  const preference = (useSettingsStore((state) => state.theme) as ThemePreference) || 'system';
  const systemScheme = useColorScheme();

  const resolvedTheme: ResolvedTheme = useMemo(() => {
    if (preference === 'system') {
      return systemScheme === 'dark' ? 'dark' : 'light';
    }
    return preference;
  }, [preference, systemScheme]);

  const colors = useMemo(() => getPalette(resolvedTheme), [resolvedTheme]);

  return { themePreference: preference, resolvedTheme, isDark: resolvedTheme === 'dark', colors };
};

export const getNavigationTheme = (colors: AppPalette) => {
  const baseTheme = colors.mode === 'dark' ? DarkTheme : DefaultTheme;
  return {
    ...baseTheme,
    colors: {
      ...baseTheme.colors,
      primary: colors.primary,
      background: colors.background,
      card: colors.header,
      text: colors.text,
      border: colors.border,
      notification: colors.danger,
    },
  };
};
