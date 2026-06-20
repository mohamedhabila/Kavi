// ---------------------------------------------------------------------------
// Kavi — App Navigator
// ---------------------------------------------------------------------------

import React, { useState, useEffect } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { createDrawerNavigator } from '@react-navigation/drawer';
import { NavigationContainer, createNavigationContainerRef } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ChatScreen } from '../screens/ChatScreen';
import { ConversationFilesScreen } from '../screens/ConversationFilesScreen';
import { SettingsScreen } from '../screens/SettingsScreen';
import { SchedulerScreen } from '../screens/SchedulerScreen';
import { McpStatusScreen } from '../screens/McpStatusScreen';
import { SkillsScreen } from '../screens/SkillsScreen';
import { CanvasScreen } from '../screens/CanvasScreen';
import { VoiceScreen } from '../screens/VoiceScreen';
import { GatewayScreen } from '../screens/GatewayScreen';
import { MemoryScreen } from '../screens/MemoryScreen';
import { RemoteWorkScreen } from '../screens/RemoteWorkScreen';
import { TerminalScreen } from '../screens/TerminalScreen';
import { CodeEditorScreen } from '../screens/CodeEditorScreen';
import { BrowserSessionScreen } from '../screens/BrowserSessionScreen';
import { AgentRosterScreen } from '../screens/AgentRosterScreen';
import { ApprovalHistoryScreen } from '../screens/ApprovalHistoryScreen';
import { Sidebar } from '../components/sidebar/Sidebar';
import { CanvasSurfacePresenter } from '../components/canvas/CanvasSurfacePresenter';
import { OnboardingWizard } from '../components/onboarding/OnboardingWizard';
import { getNavigationTheme, useAppTheme } from '../theme/useAppTheme';
import {
  isStoreHydrated,
  subscribeToStoreHydration,
  type PersistHydratableStore,
} from '../store/persistHydration';
import { useChatStore } from '../store/useChatStore';
import {
  getPendingNotificationRoute,
  type NotificationRouteData,
  subscribeToNotificationRoutes,
} from '../services/notifications/service';
import { runJobNow } from '../services/scheduler/engine';

const Drawer = createDrawerNavigator();
const ONBOARDING_KEY = 'kavi_onboarding_complete';
const navigationRef = createNavigationContainerRef<any>();

export const AppNavigator: React.FC = () => {
  const { colors } = useAppTheme();
  const [showOnboarding, setShowOnboarding] = useState<boolean | null>(null);
  const [chatHydrated, setChatHydrated] = useState(() =>
    isStoreHydrated(useChatStore as PersistHydratableStore),
  );
  const [navReady, setNavReady] = useState(false);
  const [pendingConversationId, setPendingConversationId] = useState<string | null>(null);
  const [pendingSchedulerOpen, setPendingSchedulerOpen] = useState(false);

  useEffect(() => {
    if (chatHydrated) {
      return;
    }

    const refreshHydrationState = () => {
      if (isStoreHydrated(useChatStore as PersistHydratableStore)) {
        setChatHydrated(true);
      }
    };

    const unsubscribe = subscribeToStoreHydration(
      useChatStore as PersistHydratableStore,
      refreshHydrationState,
    );
    refreshHydrationState();
    return unsubscribe;
  }, [chatHydrated]);

  useEffect(() => {
    const activateRoute = (route?: NotificationRouteData | null) => {
      if (!route) return;
      if (route.source === 'scheduled_task_wake' && route.jobId) {
        void runJobNow(route.jobId, { trigger: 'notification-tap' }).catch((e) =>
          console.warn('[AppNavigator] Failed to run wake notification task:', e),
        );
        setPendingSchedulerOpen(true);
      }
      if (route.screen === 'Scheduler') {
        setPendingSchedulerOpen(true);
      }
      if (route.conversationId) {
        setPendingConversationId(route.conversationId);
      }
    };

    const unsubscribe = subscribeToNotificationRoutes((route) => {
      activateRoute(route);
    });

    void getPendingNotificationRoute()
      .then((route) => {
        activateRoute(route);
      })
      .catch((e) => console.warn('[AppNavigator] Failed to get pending notification route:', e));

    return unsubscribe;
  }, []);

  useEffect(() => {
    if (!chatHydrated || !pendingConversationId) {
      return;
    }

    const chatState = useChatStore.getState();
    const hasConversation = chatState.conversations.some(
      (conversation) => conversation.id === pendingConversationId,
    );
    if (!hasConversation) {
      setPendingConversationId(null);
      return;
    }

    chatState.setActiveConversation(pendingConversationId);
  }, [chatHydrated, pendingConversationId]);

  useEffect(() => {
    if (
      !chatHydrated ||
      !navReady ||
      showOnboarding !== false ||
      !pendingConversationId ||
      !navigationRef.isReady()
    ) {
      return;
    }

    navigationRef.navigate('Chat');
    setPendingConversationId(null);
  }, [chatHydrated, navReady, pendingConversationId, showOnboarding]);

  useEffect(() => {
    if (
      !navReady ||
      showOnboarding !== false ||
      !pendingSchedulerOpen ||
      !navigationRef.isReady()
    ) {
      return;
    }

    navigationRef.navigate('Scheduler');
    setPendingSchedulerOpen(false);
  }, [navReady, pendingSchedulerOpen, showOnboarding]);

  useEffect(() => {
    AsyncStorage.getItem(ONBOARDING_KEY).then((val) => {
      setShowOnboarding(val !== 'true');
    });
  }, []);

  const handleOnboardingComplete = async () => {
    await AsyncStorage.setItem(ONBOARDING_KEY, 'true');
    setShowOnboarding(false);
  };

  if (showOnboarding === null || !chatHydrated) {
    return (
      <View
        style={{
          flex: 1,
          justifyContent: 'center',
          alignItems: 'center',
          backgroundColor: colors.background,
        }}
      >
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if (showOnboarding) {
    return <OnboardingWizard onComplete={handleOnboardingComplete} />;
  }

  return (
    <NavigationContainer
      ref={navigationRef}
      theme={getNavigationTheme(colors)}
      onReady={() => setNavReady(true)}
    >
      <View style={{ flex: 1 }}>
        <Drawer.Navigator
          initialRouteName="Chat"
          drawerContent={(props) => <Sidebar {...props} />}
          screenOptions={{
            headerShown: false,
            drawerHideStatusBarOnOpen: false,
            drawerStyle: {
              backgroundColor: colors.background,
              width: 280,
            },
            sceneStyle: {
              flex: 1,
              backgroundColor: colors.background,
            },
          }}
        >
          <Drawer.Screen name="Chat" component={ChatScreen} />
          <Drawer.Screen name="ConversationFiles" component={ConversationFilesScreen} />
          <Drawer.Screen name="Settings" component={SettingsScreen} />
          <Drawer.Screen name="Scheduler" component={SchedulerScreen} />
          <Drawer.Screen name="McpStatus" component={McpStatusScreen} />
          <Drawer.Screen name="Skills" component={SkillsScreen} />
          <Drawer.Screen name="Canvas" component={CanvasScreen} />
          <Drawer.Screen name="Voice" component={VoiceScreen} />
          <Drawer.Screen name="Gateway" component={GatewayScreen} />
          <Drawer.Screen name="RemoteWork" component={RemoteWorkScreen} />
          <Drawer.Screen name="Terminal" component={TerminalScreen} />
          <Drawer.Screen name="CodeEditor" component={CodeEditorScreen} />
          <Drawer.Screen name="BrowserSession" component={BrowserSessionScreen} />
          <Drawer.Screen name="AgentRoster" component={AgentRosterScreen} />
          <Drawer.Screen name="ApprovalHistory" component={ApprovalHistoryScreen} />
          <Drawer.Screen name="Memory" component={MemoryScreen} />
        </Drawer.Navigator>
        <CanvasSurfacePresenter />
      </View>
    </NavigationContainer>
  );
};
