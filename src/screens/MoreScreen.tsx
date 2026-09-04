import React from 'react';
import { useNavigation } from '@react-navigation/native';
import {
  Bot,
  BrainCircuit,
  Globe,
  Mic,
  MonitorCog,
  Puzzle,
  Radio,
  Server,
  ShieldCheck,
} from 'lucide-react-native';
import {
  NavigationHubScreen,
  type NavigationHubSection,
} from '../components/navigation/NavigationHubScreen';
import { useTranslation } from '../i18n/useTranslation';
import { useSettingsStore } from '../store/useSettingsStore';

export const MoreScreen: React.FC = () => {
  const navigation = useNavigation<any>();
  const { t } = useTranslation();
  const developerModeEnabled = useSettingsStore((s) => s.developerModeEnabled);

  const sections: NavigationHubSection[] = [
    {
      id: 'capabilities',
      title: t('navigationHub.capabilities'),
      items: [
        {
          id: 'talk-mode',
          title: t('nav.voice'),
          icon: Mic,
          onPress: () => navigation.navigate('Voice', { returnTo: { name: 'More' } }),
        },
        {
          id: 'skills',
          title: t('nav.skills'),
          icon: Puzzle,
          onPress: () => navigation.navigate('Skills', { returnTo: { name: 'More' } }),
        },
      ],
    },
    {
      id: 'connections',
      title: t('navigationHub.connections'),
      items: [
        {
          id: 'mcp-servers',
          // MCP servers are a consumer integration, not a developer tool, so
          // the row always stays reachable — only its framing changes: the
          // more technical label surfaces once Developer Mode is on.
          title: developerModeEnabled ? t('nav.mcpStatus') : t('nav.connectedServices'),
          icon: Server,
          onPress: () => navigation.navigate('McpStatus', { returnTo: { name: 'More' } }),
        },
        {
          id: 'browser',
          title: t('nav.browserSessions'),
          icon: Globe,
          onPress: () => navigation.navigate('BrowserSession', { returnTo: { name: 'More' } }),
        },
        ...(developerModeEnabled
          ? [
              {
                id: 'gateway',
                title: t('nav.gateway'),
                icon: Radio,
                onPress: () => navigation.navigate('Gateway', { returnTo: { name: 'More' } }),
              },
            ]
          : []),
      ],
    },
    {
      id: 'assistant-ai',
      title: t('navigationHub.personalizationAndAI'),
      items: [
        {
          id: 'assistant-styles',
          title: t('nav.assistantStyles'),
          icon: Bot,
          onPress: () =>
            navigation.navigate('AgentRoster', {
              initialTab: 'roster',
              returnTo: { name: 'More' },
            }),
        },
        {
          id: 'advanced-ai',
          title: t('nav.advancedAI'),
          icon: BrainCircuit,
          onPress: () =>
            navigation.navigate('Settings', {
              destination: 'advanced-ai',
              returnTo: { name: 'More' },
            }),
        },
        {
          id: 'privacy-permissions',
          title: t('nav.privacyPermissions'),
          icon: ShieldCheck,
          onPress: () => navigation.navigate('ApprovalHistory', { returnTo: { name: 'More' } }),
        },
      ],
    },
    ...(developerModeEnabled
      ? [
          {
            id: 'advanced',
            title: t('navigationHub.advanced'),
            items: [
              {
                id: 'developer-remote-work',
                title: t('nav.developerAndRemoteWork'),
                icon: MonitorCog,
                onPress: () =>
                  navigation.navigate('DeveloperWork', { returnTo: { name: 'More' } }),
              },
            ],
          },
        ]
      : []),
  ];

  return (
    <NavigationHubScreen
      intro={t('navigationHub.moreIntro')}
      sections={sections}
      testID="more-hub"
      title={t('nav.more')}
    />
  );
};
