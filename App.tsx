// ---------------------------------------------------------------------------
// Kavi — App Entry Point
// ---------------------------------------------------------------------------

import { StatusBar } from 'expo-status-bar';
import React,{ useEffect,useState } from 'react';
import { AppState } from 'react-native';
import 'react-native-gesture-handler';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import 'react-native-get-random-values';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { PyodideWebView } from './src/components/python/PyodideWebView';
import { i18n } from './src/i18n/manager';
import { AppNavigator } from './src/navigation/AppNavigator';
import { emitAppEvent } from './src/services/events/bus';
import { subscribeToPyodideMountRequests } from './src/services/python/pyodideBridge';
import { handleAppBackground,handleAppForeground,initializeServices } from './src/services/startup';
import { flushPendingStorageWrites } from './src/store/throttledStorage';
import { useAppTheme } from './src/theme/useAppTheme';

const AppContent: React.FC = () => {
  const { isDark } = useAppTheme();
  const [shouldMountPyodide, setShouldMountPyodide] = useState(false);

  useEffect(() => {
    i18n.init();
    initializeServices();

    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') {
        void emitAppEvent('foreground');
        handleAppForeground();
      } else {
        void flushPendingStorageWrites().catch(() => undefined);
      }

      if (nextState === 'background') {
        void emitAppEvent('background');
        handleAppBackground();
      }
    });

    return () => subscription.remove();
  }, []);

  useEffect(() => {
    return subscribeToPyodideMountRequests(() => {
      setShouldMountPyodide(true);
    });
  }, []);

  return (
    <>
      <StatusBar style={isDark ? 'light' : 'dark'} />
      <AppNavigator />
      {shouldMountPyodide ? <PyodideWebView /> : null}
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
