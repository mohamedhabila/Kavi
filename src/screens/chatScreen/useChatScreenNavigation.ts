import { useCallback } from 'react';
import type { DrawerNavigationProp } from '@react-navigation/drawer';

/** Chat screen links to the screens that configure the conversation and the app. */
export function useChatScreenNavigation(params: {
  activeConversationId: string | null;
  navigation: DrawerNavigationProp<any>;
}): {
  handleOpenConversationSettings: () => void;
  handleOpenDeveloperTools: () => void;
  handleOpenProviderSetup: () => void;
  handleOpenUsage: () => void;
} {
  const { activeConversationId, navigation } = params;
  const handleOpenProviderSetup = useCallback(
    () =>
      navigation.navigate('Settings' as any, {
        destination: 'advanced-ai',
        returnTo: { name: 'Chat' },
      }),
    [navigation],
  );
  const handleOpenConversationSettings = useCallback(() => {
    if (!activeConversationId) return;
    navigation.navigate('ConversationSettings' as any, {
      conversationId: activeConversationId,
      returnTo: { name: 'Chat' },
    });
  }, [activeConversationId, navigation]);
  const handleOpenDeveloperTools = useCallback(
    () =>
      navigation.navigate('DeveloperWork' as any, {
        returnTo: { name: 'Chat' },
      }),
    [navigation],
  );
  const handleOpenUsage = useCallback(() => {
    if (!activeConversationId) {
      return;
    }
    navigation.navigate('ConversationSettings' as any, {
      conversationId: activeConversationId,
      returnTo: { name: 'Chat' },
      showUsage: true,
    });
  }, [activeConversationId, navigation]);

  return {
    handleOpenConversationSettings,
    handleOpenDeveloperTools,
    handleOpenProviderSetup,
    handleOpenUsage,
  };
}
