// ---------------------------------------------------------------------------
// Kavi — Hidden Pyodide WebView Component
// ---------------------------------------------------------------------------
// A zero-size WebView that hosts the Pyodide WASM runtime. Mount this once
// near the app root so the Python tool can execute code via postMessage.

import React, { useCallback, useEffect, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import WebView, { WebViewMessageEvent } from 'react-native-webview';
import {
  getPyodideHtml,
  handlePyodideMessage,
  PYODIDE_WEBVIEW_BASE_URL,
  registerPyodideWebView,
  reportPyodideRuntimeFailure,
  unregisterPyodideWebView,
} from '../../services/python/pyodideBridge';

const styles = StyleSheet.create({
  host: {
    width: 1,
    height: 1,
    position: 'absolute',
    top: -10_000,
    left: -10_000,
    opacity: 0.01,
    overflow: 'hidden',
  },
  webView: {
    width: 1,
    height: 1,
    backgroundColor: 'transparent',
  },
});

type PyodideErrorEvent = {
  nativeEvent?: {
    description?: string;
    statusCode?: number;
    url?: string;
  };
};

type PyodideRenderProcessGoneEvent = {
  nativeEvent?: {
    didCrash?: boolean;
  };
};

function formatLoadFailureMessage(prefix: string, event: PyodideErrorEvent): string {
  const description = event.nativeEvent?.description?.trim();
  const statusCode = event.nativeEvent?.statusCode;
  const url = event.nativeEvent?.url?.trim();
  const details = [
    typeof statusCode === 'number' ? `status ${statusCode}` : null,
    description || null,
    url ? `url: ${url}` : null,
  ].filter((value): value is string => Boolean(value));

  return details.length > 0 ? `${prefix}: ${details.join(' | ')}` : prefix;
}

/**
 * Hidden WebView that loads Pyodide. Mount once at top-level.
 * It registers itself with the pyodideBridge service so `executePython()`
 * calls can reach it via postMessage.
 */
export function PyodideWebView(): React.JSX.Element {
  const ref = useRef<WebView | null>(null);

  useEffect(() => {
    return () => unregisterPyodideWebView();
  }, []);

  const setWebViewRef = useCallback((instance: WebView | null) => {
    ref.current = instance;
    if (instance) {
      registerPyodideWebView(instance);
    }
  }, []);

  const onMessage = useCallback((event: WebViewMessageEvent) => {
    handlePyodideMessage(event.nativeEvent.data);
  }, []);

  const onError = useCallback((event: PyodideErrorEvent) => {
    reportPyodideRuntimeFailure(formatLoadFailureMessage('Pyodide WebView failed to load', event));
  }, []);

  const onHttpError = useCallback((event: PyodideErrorEvent) => {
    reportPyodideRuntimeFailure(formatLoadFailureMessage('Pyodide WebView HTTP error', event));
  }, []);

  const onContentProcessDidTerminate = useCallback(() => {
    reportPyodideRuntimeFailure('Pyodide WebView content process terminated unexpectedly.');
  }, []);

  const onRenderProcessGone = useCallback((event: PyodideRenderProcessGoneEvent) => {
    const suffix = event.nativeEvent?.didCrash
      ? 'The WebView render process crashed.'
      : 'The WebView render process exited unexpectedly.';
    reportPyodideRuntimeFailure(`Pyodide WebView render process terminated. ${suffix}`);
  }, []);

  return (
    <View
      style={styles.host}
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <WebView
        ref={setWebViewRef}
        style={styles.webView}
        originWhitelist={['*']}
        source={{ html: getPyodideHtml(), baseUrl: PYODIDE_WEBVIEW_BASE_URL }}
        javaScriptEnabled
        domStorageEnabled
        cacheEnabled
        onMessage={onMessage}
        onError={onError}
        onHttpError={onHttpError}
        onContentProcessDidTerminate={onContentProcessDidTerminate}
        onRenderProcessGone={onRenderProcessGone}
        // Prevent user interaction — this is a background runtime
        scrollEnabled={false}
        bounces={false}
      />
    </View>
  );
}
