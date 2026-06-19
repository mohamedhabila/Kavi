import type React from 'react';
import { useCallback,useEffect,useMemo,useRef,useState } from 'react';
import type { ScrollView } from 'react-native';

import type { SettingsSection } from './useSettingsRemoteConfigFlow';

type TranslationFn = (key: string, params?: any) => string;

export type MainSettingsSectionId =
  | 'overview'
  | 'assistant'
  | 'tools'
  | 'personas'
  | 'surfaces'
  | 'data';

const MAIN_SETTINGS_SECTION_ORDER: MainSettingsSectionId[] = [
  'overview',
  'assistant',
  'tools',
  'personas',
  'surfaces',
  'data',
];

type UseSettingsSectionNavigationParams = {
  section: SettingsSection;
  t: TranslationFn;
};

export function useSettingsSectionNavigation({ section, t }: UseSettingsSectionNavigationParams) {
  const [activeMainSection, setActiveMainSection] = useState<MainSettingsSectionId>('overview');
  const activeMainSectionRef = useRef<MainSettingsSectionId>('overview');
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
  const mainSectionOffsetsRef = useRef<Record<MainSettingsSectionId, number>>({
    overview: 0,
    assistant: 0,
    tools: 0,
    personas: 0,
    surfaces: 0,
    data: 0,
  });

  const mainSections = useMemo(
    () => [
      {
        id: 'overview' as const,
        title: t('settings.mainSections.overview.title'),
        hint: t('settings.mainSections.overview.hint'),
      },
      {
        id: 'assistant' as const,
        title: t('settings.mainSections.assistant.title'),
        hint: t('settings.mainSections.assistant.hint'),
      },
      {
        id: 'tools' as const,
        title: t('settings.mainSections.tools.title'),
        hint: t('settings.mainSections.tools.hint'),
      },
      {
        id: 'personas' as const,
        title: t('settings.mainSections.personas.title'),
        hint: t('settings.mainSections.personas.hint'),
      },
      {
        id: 'surfaces' as const,
        title: t('settings.mainSections.surfaces.title'),
        hint: t('settings.mainSections.surfaces.hint'),
      },
      {
        id: 'data' as const,
        title: t('settings.mainSections.data.title'),
        hint: t('settings.mainSections.data.hint'),
      },
    ],
    [t],
  );

  const updateTrackedScroll = useCallback((sectionKey: SettingsSection, y: number) => {
    scrollOffsetsRef.current[sectionKey] = y;
    if (sectionKey !== 'main') return;

    let nextActive: MainSettingsSectionId = 'overview';
    for (const sectionId of MAIN_SETTINGS_SECTION_ORDER) {
      if ((mainSectionOffsetsRef.current[sectionId] || 0) - 64 <= y) {
        nextActive = sectionId;
      }
    }

    if (activeMainSectionRef.current !== nextActive) {
      activeMainSectionRef.current = nextActive;
      setActiveMainSection(nextActive);
    }
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

  const handleJumpToMainSection = useCallback((sectionId: MainSettingsSectionId) => {
    activeMainSectionRef.current = sectionId;
    setActiveMainSection(sectionId);
    const y = Math.max((mainSectionOffsetsRef.current[sectionId] || 0) - 12, 0);
    mainScrollRef.current?.scrollTo({ y, animated: true });
  }, []);

  useEffect(() => {
    pendingRestoreSectionRef.current = section;
    if (section !== 'main') return;

    let nextActive: MainSettingsSectionId = 'overview';
    const y = scrollOffsetsRef.current.main || 0;
    for (const sectionId of MAIN_SETTINGS_SECTION_ORDER) {
      if ((mainSectionOffsetsRef.current[sectionId] || 0) - 64 <= y) {
        nextActive = sectionId;
      }
    }
    activeMainSectionRef.current = nextActive;
    setActiveMainSection(nextActive);
  }, [section]);

  return {
    activeMainSection,
    mainScrollRef,
    editorScrollRef,
    mainSectionOffsetsRef,
    mainSections,
    updateTrackedScroll,
    restoreTrackedScroll,
    handleJumpToMainSection,
  };
}
