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

export const MoreScreen: React.FC = () => {
  const navigation = useNavigation<any>();
  const { t } = useTranslation();

  const sections: NavigationHubSection[] = [
    {
      id: 'capabilities',
      title: t('navigationHub.capabilities'),
      items: [
        {
          id: 'talk-mode',
          title: t('nav.voice'),
          icon: Mic,
          onPress: () => navigation.navigate('Voice'),
        },
        {
          id: 'skills',
          title: t('nav.skills'),
          icon: Puzzle,
          onPress: () => navigation.navigate('Skills'),
        },
      ],
    },
    {
      id: 'connections',
      title: t('navigationHub.connections'),
      items: [
        {
          id: 'mcp-servers',
          title: t('nav.mcpStatus'),
          icon: Server,
          onPress: () => navigation.navigate('McpStatus'),
        },
        {
          id: 'browser',
          title: t('nav.browserSessions'),
          icon: Globe,
          onPress: () => navigation.navigate('BrowserSession'),
        },
        {
          id: 'gateway',
          title: t('nav.gateway'),
          icon: Radio,
          onPress: () => navigation.navigate('Gateway'),
        },
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
          onPress: () => navigation.navigate('AgentRoster', { initialTab: 'roster' }),
        },
        {
          id: 'advanced-ai',
          title: t('nav.advancedAI'),
          icon: BrainCircuit,
          onPress: () => navigation.navigate('Settings'),
        },
        {
          id: 'privacy-permissions',
          title: t('nav.privacyPermissions'),
          icon: ShieldCheck,
          onPress: () => navigation.navigate('ApprovalHistory'),
        },
      ],
    },
    {
      id: 'advanced',
      title: t('navigationHub.advanced'),
      items: [
        {
          id: 'developer-remote-work',
          title: t('nav.developerAndRemoteWork'),
          icon: MonitorCog,
          onPress: () => navigation.navigate('DeveloperWork'),
        },
      ],
    },
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
