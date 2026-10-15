// ---------------------------------------------------------------------------
// Kavi — App Navigator
// ---------------------------------------------------------------------------

import React, { useCallback, useState, useEffect } from 'react';
import { ActivityIndicator, AppState, View } from 'react-native';
import { createDrawerNavigator } from '@react-navigation/drawer';
import { NavigationContainer, createNavigationContainerRef } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ChatScreen } from '../screens/ChatScreen';
import { ActivityScreen } from '../screens/ActivityScreen';
import { LibraryScreen } from '../screens/LibraryScreen';
import { MoreScreen } from '../screens/MoreScreen';
import { DeveloperWorkScreen } from '../screens/DeveloperWorkScreen';
import { ConversationFilesScreen } from '../screens/ConversationFilesScreen';
import { ConversationSettingsScreen } from '../screens/ConversationSettingsScreen';
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
  getNotificationPermissionReadiness,
  getPendingNotificationRoute,
  type NotificationRouteData,
  sendLocalNotification,
  subscribeToNotificationRoutes,
} from '../services/notifications/service';
import { startRunCompletionNotifications } from '../services/notifications/runCompletionNotifications';
import { appForegroundRequestRegistry } from '../engine/graph/foregroundRun/requestRegistry';
import { i18n } from '../i18n/manager';
import { runJobNow } from '../services/scheduler/engine';
import { consumeSchedulerJobWake } from '../services/scheduler/wakeNotifications';
import {
  getSchedulerNotificationTarget,
  type SchedulerNotificationTarget,
} from './notificationNavigation';
import { useLaunchRequests } from './useLaunchRequests';
import type { LaunchRequest } from '../services/assistant/launchRequests';

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
  const [pendingChatOpen, setPendingChatOpen] = useState(false);
  const [pendingSchedulerRoute, setPendingSchedulerRoute] =
    useState<SchedulerNotificationTarget | null>(null);
  const [pendingLaunchRequest, setPendingLaunchRequest] = useState<
    (LaunchRequest & { requestId: number }) | null
  >(null);

  // Opened by the system for something specific: the phone's assistant gesture or "Talk to
  // Kavi" goes straight to voice, listening; "Ask Kavi" sends its request in the chat; a
  // share from another app shows the chat, whose composer takes the shared items.
  useLaunchRequests(
    useCallback((request: LaunchRequest) => {
      setPendingLaunchRequest({ ...request, requestId: Date.now() });
    }, []),
  );

  useEffect(() => {
    if (
      !navReady ||
      showOnboarding !== false ||
      pendingLaunchRequest === null ||
      !navigationRef.isReady()
    ) {
      return;
    }

    if (pendingLaunchRequest.kind === 'voice') {
      navigationRef.navigate('Voice', { autoStartRequestId: pendingLaunchRequest.requestId });
    } else if (pendingLaunchRequest.kind === 'share') {
      navigationRef.navigate('Chat');
    } else {
      navigationRef.navigate('Chat', {
        incomingRequest: {
          requestId: pendingLaunchRequest.requestId,
          text: pendingLaunchRequest.text,
        },
      });
    }
    setPendingLaunchRequest(null);
  }, [navReady, pendingLaunchRequest, showOnboarding]);

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

  useEffect(
    () =>
      startRunCompletionNotifications({
        requests: appForegroundRequestRegistry,
        isAppInForeground: () => AppState.currentState === 'active',
        getConversation: (conversationId) =>
          useChatStore
            .getState()
            .conversations.find((conversation) => conversation.id === conversationId),
        canNotify: async () => (await getNotificationPermissionReadiness()).status === 'granted',
        notify: (notice) => sendLocalNotification(notice),
        t: (key, params) => i18n.t(key, params),
      }),
    [],
  );

  useEffect(() => {
    const activateRoute = (route?: NotificationRouteData | null) => {
      if (!route) return;
      if (route.source === 'scheduled_task_wake' && route.jobId && route.notificationId) {
        const jobId = route.jobId;
        const notificationId = route.notificationId;
        void (async () => {
          await consumeSchedulerJobWake(jobId, notificationId).catch((e) =>
            console.warn('[AppNavigator] Failed to consume wake notification:', e),
          );
          await runJobNow(jobId, { trigger: 'notification-tap', force: false });
        })().catch((e) => console.warn('[AppNavigator] Failed to run wake notification task:', e));
      }
      const schedulerTarget = getSchedulerNotificationTarget(route);
      if (schedulerTarget) setPendingSchedulerRoute(schedulerTarget);
      if (route.conversationId) {
        setPendingChatOpen(true);
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
    if (
      !chatHydrated ||
      !navReady ||
      showOnboarding !== false ||
      !pendingChatOpen ||
      !navigationRef.isReady()
    ) {
      return;
    }

    navigationRef.navigate('Chat');
    setPendingChatOpen(false);
  }, [chatHydrated, navReady, pendingChatOpen, showOnboarding]);

  useEffect(() => {
    if (
      !navReady ||
      showOnboarding !== false ||
      !pendingSchedulerRoute ||
      !navigationRef.isReady()
    ) {
      return;
    }

    navigationRef.navigate(
      'Scheduler',
      pendingSchedulerRoute.jobId ? { initialJobId: pendingSchedulerRoute.jobId } : undefined,
    );
    setPendingSchedulerRoute(null);
  }, [navReady, pendingSchedulerRoute, showOnboarding]);

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
          <Drawer.Screen name="Activity" component={ActivityScreen} />
          <Drawer.Screen name="Library" component={LibraryScreen} />
          <Drawer.Screen name="More" component={MoreScreen} />
          <Drawer.Screen name="DeveloperWork" component={DeveloperWorkScreen} />
          <Drawer.Screen name="ConversationFiles" component={ConversationFilesScreen} />
          <Drawer.Screen name="ConversationSettings" component={ConversationSettingsScreen} />
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
