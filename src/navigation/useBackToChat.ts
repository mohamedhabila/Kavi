import { useCallback, useMemo } from 'react';
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

export function getRouteReturnTarget(value: unknown): BackToRouteTarget | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  const candidate = value as Record<string, unknown>;
  if (typeof candidate.name !== 'string' || !candidate.name.trim()) {
    return null;
  }

  const params = candidate.params;
  return {
    name: candidate.name.trim(),
    ...(params && typeof params === 'object' && !Array.isArray(params)
      ? { params: params as Record<string, unknown> }
      : {}),
  };
}

export function useBackToChat(options: UseBackToChatOptions = {}): () => void {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const routeReturnTarget = useMemo(
    () => getRouteReturnTarget(route.params?.returnTo),
    [route.params?.returnTo],
  );
  const targetRoute = options.targetRoute ?? routeReturnTarget;
  const beforeNavigate = options.beforeNavigate;

  const completeNavigation = useCallback(() => {
    if (route.name !== 'Chat') {
      if (targetRoute?.name && route.name !== targetRoute.name) {
        if (targetRoute.params) {
          navigation.navigate(targetRoute.name, targetRoute.params);
        } else {
          navigation.navigate(targetRoute.name);
        }
        return;
      }

      navigation.navigate('Chat');
      return;
    }

    if (navigation.canGoBack?.()) {
      navigation.goBack();
    }
  }, [navigation, route.name, targetRoute]);

  const backToChat = useCallback(() => {
    if (beforeNavigate) {
      beforeNavigate(completeNavigation);
      return;
    }

    completeNavigation();
  }, [beforeNavigate, completeNavigation]);

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
