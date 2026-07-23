import React from 'react';
import { useNavigation } from '@react-navigation/native';
import { FileCode, Monitor, Terminal } from 'lucide-react-native';
import {
  NavigationHubScreen,
  type NavigationHubSection,
} from '../components/navigation/NavigationHubScreen';
import { useTranslation } from '../i18n/useTranslation';

export const DeveloperWorkScreen: React.FC = () => {
  const navigation = useNavigation<any>();
  const { t } = useTranslation();

  const sections: NavigationHubSection[] = [
    {
      id: 'developer-tools',
      title: t('navigationHub.developerTools'),
      items: [
        {
          id: 'terminal',
          title: t('nav.terminal'),
          icon: Terminal,
          onPress: () => navigation.navigate('Terminal', { returnTo: { name: 'DeveloperWork' } }),
        },
        {
          id: 'code-editor',
          title: t('nav.codeEditor'),
          icon: FileCode,
          onPress: () => navigation.navigate('CodeEditor', { returnTo: { name: 'DeveloperWork' } }),
        },
        {
          id: 'remote-work',
          title: t('nav.remoteWork'),
          icon: Monitor,
          onPress: () => navigation.navigate('RemoteWork', { returnTo: { name: 'DeveloperWork' } }),
        },
      ],
    },
  ];

  return (
    <NavigationHubScreen
      intro={t('navigationHub.developerIntro')}
      sections={sections}
      testID="developer-work-hub"
      title={t('nav.developerAndRemoteWork')}
    />
  );
};
