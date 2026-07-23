import React from 'react';
import { useNavigation } from '@react-navigation/native';
import { Brain, FolderOpen, Layers } from 'lucide-react-native';
import {
  NavigationHubScreen,
  type NavigationHubSection,
} from '../components/navigation/NavigationHubScreen';
import { useTranslation } from '../i18n/useTranslation';
import { useChatStore } from '../store/useChatStore';

export const LibraryScreen: React.FC = () => {
  const navigation = useNavigation<any>();
  const { t } = useTranslation();
  const activeConversationId = useChatStore((state) => state.activeConversationId);

  const sections: NavigationHubSection[] = [
    {
      id: 'memory-creations',
      title: t('navigationHub.memoryAndCreations'),
      items: [
        {
          id: 'memory',
          title: t('nav.memory'),
          icon: Brain,
          onPress: () => navigation.navigate('Memory'),
        },
        {
          id: 'files-creations',
          title: t('nav.filesAndCreations'),
          icon: FolderOpen,
          onPress: () =>
            navigation.navigate('ConversationFiles', {
              conversationId: activeConversationId,
            }),
        },
        {
          id: 'interactive-creations',
          title: t('nav.interactiveCreations'),
          icon: Layers,
          onPress: () => navigation.navigate('Canvas'),
        },
      ],
    },
  ];

  return (
    <NavigationHubScreen
      intro={t('navigationHub.libraryIntro')}
      sections={sections}
      testID="library-hub"
      title={t('nav.library')}
    />
  );
};
