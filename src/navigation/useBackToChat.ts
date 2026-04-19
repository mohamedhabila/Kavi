import { useCallback } from 'react';
import { BackHandler } from 'react-native';
import { useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';

type BackToRouteTarget = {
  name: string;
  params?: Record<string, unknown>;
};

type UseBackToChatOptions = {
  beforeNavigate?: (continueNavigation: () => void) => void;
  targetRoute?: BackToRouteTarget | null;
};

export function useBackToChat(options: UseBackToChatOptions = {}): () => void {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();

  const completeNavigation = useCallback(() => {
    if (route.name !== 'Chat') {
      if (options.targetRoute?.name && route.name !== options.targetRoute.name) {
        navigation.navigate(options.targetRoute.name, options.targetRoute.params);
        return;
      }

      navigation.navigate('Chat');
      return;
    }

    if (navigation.canGoBack?.()) {
      navigation.goBack();
    }
  }, [navigation, options.targetRoute, route.name]);

  const backToChat = useCallback(() => {
    if (options.beforeNavigate) {
      options.beforeNavigate(completeNavigation);
      return;
    }

    completeNavigation();
  }, [completeNavigation, options]);

  useFocusEffect(
    useCallback(() => {
      const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
        if (route.name === 'Chat') {
          return false;
        }

        backToChat();
        return true;
      });

      return () => subscription.remove();
    }, [backToChat, route.name]),
  );

  return backToChat;
}
