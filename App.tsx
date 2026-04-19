// ---------------------------------------------------------------------------
// Kavi — App Entry Point
// ---------------------------------------------------------------------------

import 'react-native-gesture-handler';
import 'react-native-get-random-values';
import React, { useEffect } from 'react';
import { AppState } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AppNavigator } from './src/navigation/AppNavigator';
import { useAppTheme } from './src/theme/useAppTheme';
import { initializeServices } from './src/services/startup';
import { flushPendingStorageWrites } from './src/store/throttledStorage';
import { i18n } from './src/i18n';
import { PyodideWebView } from './src/components/python/PyodideWebView';
import { emitAppEvent } from './src/services/events/bus';

const AppContent: React.FC = () => {
  const { isDark } = useAppTheme();

  useEffect(() => {
    i18n.init();
    initializeServices();

    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') {
        void emitAppEvent('foreground');
      } else {
        void flushPendingStorageWrites().catch(() => undefined);
      }

      if (nextState === 'background') {
        void emitAppEvent('background');
      }
    });

    return () => subscription.remove();
  }, []);

  return (
    <>
      <StatusBar style={isDark ? 'light' : 'dark'} />
      <AppNavigator />
      <PyodideWebView />
    </>
  );
};

export default function App() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <AppContent />
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
