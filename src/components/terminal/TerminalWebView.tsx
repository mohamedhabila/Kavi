// ---------------------------------------------------------------------------
// Kavi — xterm.js WebView Terminal Component
// ---------------------------------------------------------------------------
// Embeds xterm.js inside a WebView with a PostMessage bridge for input/output.
// Supports SSH shell sessions, local JS REPL, and Termux shell.

import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useRef } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import WebView, { WebViewMessageEvent } from 'react-native-webview';
import type { AppPalette } from '../../theme/useAppTheme';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TerminalWebViewRef {
  write: (data: string) => void;
  writeln: (data: string) => void;
  clear: () => void;
  reset: () => void;
  focus: () => void;
  paste: (text: string) => void;
  search: (query: string) => void;
  updateTheme: (theme: XtermTheme) => void;
  updateConfig: (config: Partial<XtermConfig>) => void;
  fit: () => void;
}

export interface XtermTheme {
  background: string;
  foreground: string;
  cursor: string;
  cursorAccent: string;
  selectionBackground: string;
  selectionForeground?: string;
  black?: string;
  red?: string;
  green?: string;
  yellow?: string;
  blue?: string;
  magenta?: string;
  cyan?: string;
  white?: string;
  brightBlack?: string;
  brightRed?: string;
  brightGreen?: string;
  brightYellow?: string;
  brightBlue?: string;
  brightMagenta?: string;
  brightCyan?: string;
  brightWhite?: string;
}

export interface XtermConfig {
  fontSize: number;
  fontFamily: string;
  scrollback: number;
}

export interface TerminalWebViewProps {
  onInput?: (data: string) => void;
  onReady?: (cols: number, rows: number) => void;
  onResize?: (cols: number, rows: number) => void;
  onLink?: (uri: string) => void;
  onTitleChange?: (title: string) => void;
  colors: AppPalette;
  fontSize?: number;
  style?: any;
}

// ---------------------------------------------------------------------------
// Theme builder
// ---------------------------------------------------------------------------

export function buildXtermTheme(colors: AppPalette): XtermTheme {
  return {
    background: colors.codeBackground,
    foreground: colors.text,
    cursor: colors.primary,
    cursorAccent: colors.codeBackground,
    selectionBackground: colors.primary + '44',
    selectionForeground: colors.text,
    black: colors.codeBackground,
    red: colors.danger,
    green: colors.success,
    yellow: colors.warning,
    blue: colors.info,
    magenta: '#c084fc',
    cyan: '#22d3ee',
    white: colors.text,
    brightBlack: colors.textTertiary,
    brightRed: '#fca5a5',
    brightGreen: '#6ee7b7',
    brightYellow: '#fde68a',
    brightBlue: '#93c5fd',
    brightMagenta: '#d8b4fe',
    brightCyan: '#67e8f9',
    brightWhite: '#ffffff',
  };
}

// ---------------------------------------------------------------------------
// Injected JS: handles onMessage bridge from RN → WebView
// ---------------------------------------------------------------------------

const INJECTED_JS = `
(function() {
  var origPostMessage = window.postMessage;
  document.addEventListener('message', function(e) {
    if (window.handleMessage) window.handleMessage(e.data);
  });
  window.addEventListener('message', function(e) {
    if (window.handleMessage) window.handleMessage(e.data);
  });
  true;
})();
`;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const TerminalWebView = forwardRef<TerminalWebViewRef, TerminalWebViewProps>(
  function TerminalWebView(props, ref) {
    const {
      onInput,
      onReady,
      onResize,
      onLink,
      onTitleChange,
      colors,
      fontSize = 14,
      style,
    } = props;
    const webViewRef = useRef<WebView>(null);

    const sendMessage = useCallback((type: string, payload: Record<string, unknown>) => {
      const js = `window.handleMessage(${JSON.stringify({ type, payload })});true;`;
      webViewRef.current?.injectJavaScript(js);
    }, []);

    useImperativeHandle(
      ref,
      () => ({
        write: (data: string) => sendMessage('output', { data }),
        writeln: (data: string) => sendMessage('writeln', { data }),
        clear: () => sendMessage('clear', {}),
        reset: () => sendMessage('reset', {}),
        focus: () => sendMessage('focus', {}),
        paste: (text: string) => sendMessage('paste', { text }),
        search: (query: string) => sendMessage('search', { query }),
        updateTheme: (theme: XtermTheme) => sendMessage('theme', theme as any),
        updateConfig: (config: Partial<XtermConfig>) => sendMessage('config', config as any),
        fit: () => sendMessage('resize', {}),
      }),
      [sendMessage],
    );

    // Sync theme on color changes
    useEffect(() => {
      sendMessage('theme', buildXtermTheme(colors) as any);
    }, [colors, sendMessage]);

    const handleMessage = useCallback(
      (event: WebViewMessageEvent) => {
        try {
          const msg = JSON.parse(event.nativeEvent.data);
          switch (msg.type) {
            case 'input':
              onInput?.(msg.payload?.data ?? '');
              break;
            case 'ready':
              onReady?.(msg.payload?.cols ?? 80, msg.payload?.rows ?? 24);
              break;
            case 'resize':
              onResize?.(msg.payload?.cols ?? 80, msg.payload?.rows ?? 24);
              break;
            case 'link':
              onLink?.(msg.payload?.uri ?? '');
              break;
            case 'title':
              onTitleChange?.(msg.payload?.title ?? '');
              break;
            case 'error':
              console.warn('[TerminalWebView] xterm error:', msg.payload?.message);
              break;
          }
        } catch {
          // Ignore malformed messages
        }
      },
      [onInput, onReady, onResize, onLink, onTitleChange],
    );

    // Build the config to pass into the WebView at initialization time
    const theme = buildXtermTheme(colors);
    const initConfig = JSON.stringify({
      theme,
      fontSize,
      fontFamily: "'Menlo', 'Courier New', monospace",
    });
    const configInjection = `window._pendingConfig = ${initConfig}; true;`;

    const source = Platform.select({
      android: { uri: 'file:///android_asset/terminal/xterm.html' },
      ios: require('../../../assets/terminal/xterm.html'),
      default: require('../../../assets/terminal/xterm.html'),
    });

    return (
      <View style={[styles.container, style]}>
        <WebView
          ref={webViewRef}
          source={source}
          style={styles.webview}
          injectedJavaScriptBeforeContentLoaded={configInjection}
          injectedJavaScript={INJECTED_JS}
          onMessage={handleMessage}
          javaScriptEnabled
          domStorageEnabled
          originWhitelist={['*']}
          allowFileAccess
          mixedContentMode="always"
          scrollEnabled={false}
          bounces={false}
          overScrollMode="never"
          keyboardDisplayRequiresUserAction={false}
          hideKeyboardAccessoryView={false}
          textInteractionEnabled
          allowsBackForwardNavigationGestures={false}
          setSupportMultipleWindows={false}
          startInLoadingState={false}
        />
      </View>
    );
  },
);

const styles = StyleSheet.create({
  container: { flex: 1 },
  webview: { flex: 1, backgroundColor: 'transparent' },
});
