import type React from 'react';
import { useCallback, useEffect, useRef } from 'react';
import type { ScrollView } from 'react-native';

import type { SettingsSection } from './useSettingsRemoteConfigFlow';

type UseSettingsSectionNavigationParams = {
  mainContentKey: string;
  section: SettingsSection;
};

export function useSettingsSectionNavigation({
  mainContentKey,
  section,
}: UseSettingsSectionNavigationParams) {
  const mainScrollRef = useRef<ScrollView>(null);
  const editorScrollRef = useRef<ScrollView>(null);
  const pendingRestoreSectionRef = useRef<SettingsSection>('main');
  const scrollOffsetsRef = useRef<Record<SettingsSection, number>>({
    main: 0,
    'provider-edit': 0,
    'mcp-edit': 0,
    'ssh-edit': 0,
    'workspace-edit': 0,
    'browser-edit': 0,
    'expo-account-edit': 0,
    'expo-project-edit': 0,
  });

  const updateTrackedScroll = useCallback((sectionKey: SettingsSection, y: number) => {
    scrollOffsetsRef.current[sectionKey] = y;
  }, []);

  const restoreTrackedScroll = useCallback(
    (sectionKey: SettingsSection, ref: React.RefObject<ScrollView | null>) => {
      if (pendingRestoreSectionRef.current !== sectionKey) return;
      pendingRestoreSectionRef.current = 'main';
      const y = scrollOffsetsRef.current[sectionKey] || 0;
      requestAnimationFrame(() => {
        ref.current?.scrollTo({ y, animated: false });
      });
    },
    [],
  );

  useEffect(() => {
    pendingRestoreSectionRef.current = section;
  }, [section]);

  useEffect(() => {
    scrollOffsetsRef.current.main = 0;
    pendingRestoreSectionRef.current = 'main';
    requestAnimationFrame(() => {
      mainScrollRef.current?.scrollTo({ y: 0, animated: false });
    });
  }, [mainContentKey]);

  return {
    mainScrollRef,
    editorScrollRef,
    updateTrackedScroll,
    restoreTrackedScroll,
  };
}
