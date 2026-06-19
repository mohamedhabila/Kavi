// ---------------------------------------------------------------------------
// Kavi — CodeMirror 6 WebView Editor Component
// ---------------------------------------------------------------------------
// Embeds CodeMirror 6 inside a WebView with PostMessage bridge for syntax
// highlighting, multi-language support, and file editing integration.

import { forwardRef, useCallback, useImperativeHandle, useRef } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import WebView, { WebViewMessageEvent } from 'react-native-webview';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type EditorLanguage =
  | 'javascript'
  | 'typescript'
  | 'jsx'
  | 'tsx'
  | 'python'
  | 'json'
  | 'markdown'
  | 'html'
  | 'css'
  | 'yaml'
  | 'xml'
  | 'sql'
  | 'rust'
  | null;

export interface CodeEditorWebViewRef {
  setContent: (content: string) => void;
  getContent: () => void;
  setLanguage: (language: EditorLanguage) => void;
  setReadOnly: (readOnly: boolean) => void;
  focus: () => void;
  scrollToLine: (line: number) => void;
  markClean: () => void;
}

export interface CodeEditorWebViewProps {
  initialContent?: string;
  language?: EditorLanguage;
  readOnly?: boolean;
  onReady?: (lines: number) => void;
  onContent?: (content: string) => void;
  onDirtyChange?: (isDirty: boolean) => void;
  onModeChange?: (mode: 'codemirror' | 'fallback', reason?: string | null) => void;
  style?: any;
}

// ---------------------------------------------------------------------------
// Language detection from filename
// ---------------------------------------------------------------------------

const EXT_TO_LANGUAGE: Record<string, EditorLanguage> = {
  js: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  ts: 'typescript',
  mts: 'typescript',
  cts: 'typescript',
  jsx: 'jsx',
  tsx: 'tsx',
  py: 'python',
  json: 'json',
  jsonc: 'json',
  md: 'markdown',
  mdx: 'markdown',
  html: 'html',
  htm: 'html',
  css: 'css',
  scss: 'css',
  less: 'css',
  yaml: 'yaml',
  yml: 'yaml',
  xml: 'xml',
  svg: 'xml',
  plist: 'xml',
  sql: 'sql',
  rs: 'rust',
};

export function detectEditorLanguage(filename: string): EditorLanguage {
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  return EXT_TO_LANGUAGE[ext] ?? null;
}

// ---------------------------------------------------------------------------
// Injected JS for message handling bridge
// ---------------------------------------------------------------------------

const INJECTED_JS = `
(function() {
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

export const CodeEditorWebView = forwardRef<CodeEditorWebViewRef, CodeEditorWebViewProps>(
  function CodeEditorWebView(props, ref) {
    const {
      initialContent = '',
      language = null,
      readOnly = false,
      onReady,
      onContent,
      onDirtyChange,
      onModeChange,
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
        setContent: (content: string) => sendMessage('setContent', { content }),
        getContent: () => sendMessage('getContent', {}),
        setLanguage: (lang: EditorLanguage) => sendMessage('setLanguage', { language: lang }),
        setReadOnly: (ro: boolean) => sendMessage('setReadOnly', { readOnly: ro }),
        focus: () => sendMessage('focus', {}),
        scrollToLine: (line: number) => sendMessage('scrollToLine', { line }),
        markClean: () => sendMessage('markClean', {}),
      }),
      [sendMessage],
    );

    const handleMessage = useCallback(
      (event: WebViewMessageEvent) => {
        try {
          const msg = JSON.parse(event.nativeEvent.data);
          switch (msg.type) {
            case 'ready':
              onReady?.(msg.payload?.lines ?? 0);
              break;
            case 'content':
              onContent?.(msg.payload?.content ?? '');
              break;
            case 'dirty':
              onDirtyChange?.(msg.payload?.isDirty ?? false);
              break;
            case 'mode':
              if (msg.payload?.mode === 'codemirror' || msg.payload?.mode === 'fallback') {
                onModeChange?.(msg.payload.mode, msg.payload?.reason ?? null);
              }
              break;
            case 'error':
              console.warn('[CodeEditorWebView]', msg.payload?.message);
              break;
          }
        } catch {
          // Ignore malformed messages
        }
      },
      [onContent, onDirtyChange, onModeChange, onReady],
    );

    const initConfig = JSON.stringify({ content: initialContent, language, readOnly });
    const configInjection = `window._pendingConfig = ${initConfig}; true;`;

    const source = Platform.select({
      android: { uri: 'file:///android_asset/editor/editor.html' },
      ios: require('../../../assets/editor/editor.html'),
      default: require('../../../assets/editor/editor.html'),
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
        />
      </View>
    );
  },
);

const styles = StyleSheet.create({
  container: { flex: 1 },
  webview: { flex: 1, backgroundColor: 'transparent' },
});
