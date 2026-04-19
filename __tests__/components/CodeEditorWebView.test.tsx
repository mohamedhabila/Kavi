import React from 'react';
import { act, render } from '@testing-library/react-native';
import {
  CodeEditorWebView,
  type CodeEditorWebViewRef,
  detectEditorLanguage,
} from '../../src/components/editor/CodeEditorWebView';

const mockInjectJavaScript = jest.fn();

jest.mock('react-native-webview', () => {
  const React = require('react');
  const { View } = require('react-native');

  const MockWebView = React.forwardRef((props: any, ref: any) => {
    React.useImperativeHandle(ref, () => ({
      injectJavaScript: mockInjectJavaScript,
    }));
    return React.createElement(View, { ...props, testID: 'mock-code-editor-webview' });
  });

  MockWebView.displayName = 'MockCodeEditorWebView';

  return {
    __esModule: true,
    default: MockWebView,
    WebView: MockWebView,
  };
});

describe('CodeEditorWebView', () => {
  beforeEach(() => {
    mockInjectJavaScript.mockClear();
  });

  it('detects editor languages from filenames', () => {
    expect(detectEditorLanguage('App.tsx')).toBe('tsx');
    expect(detectEditorLanguage('worker.MJS')).toBe('javascript');
    expect(detectEditorLanguage('notes.md')).toBe('markdown');
    expect(detectEditorLanguage('Dockerfile')).toBeNull();
  });

  it('bridges imperative commands and incoming webview messages', () => {
    const onReady = jest.fn();
    const onContent = jest.fn();
    const onDirtyChange = jest.fn();
    const onModeChange = jest.fn();
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const ref = React.createRef<CodeEditorWebViewRef>();

    const { getByTestId } = render(
      <CodeEditorWebView
        ref={ref}
        initialContent="const value = 1;"
        language="typescript"
        readOnly
        onReady={onReady}
        onContent={onContent}
        onDirtyChange={onDirtyChange}
        onModeChange={onModeChange}
      />,
    );

    const webView = getByTestId('mock-code-editor-webview');
    expect(webView.props.injectedJavaScriptBeforeContentLoaded).toContain(
      '"content":"const value = 1;"',
    );
    expect(webView.props.injectedJavaScriptBeforeContentLoaded).toContain(
      '"language":"typescript"',
    );
    expect(webView.props.injectedJavaScriptBeforeContentLoaded).toContain('"readOnly":true');

    act(() => {
      ref.current?.setContent('next');
      ref.current?.getContent();
      ref.current?.setLanguage('python');
      ref.current?.setReadOnly(false);
      ref.current?.focus();
      ref.current?.scrollToLine(42);
      ref.current?.markClean();
    });

    const injected = mockInjectJavaScript.mock.calls.map(([script]) => String(script));
    expect(injected).toEqual(
      expect.arrayContaining([
        expect.stringContaining('"type":"setContent"'),
        expect.stringContaining('"type":"getContent"'),
        expect.stringContaining('"type":"setLanguage"'),
        expect.stringContaining('"type":"setReadOnly"'),
        expect.stringContaining('"type":"focus"'),
        expect.stringContaining('"type":"scrollToLine"'),
        expect.stringContaining('"type":"markClean"'),
      ]),
    );
    expect(injected.join('\n')).toContain('"line":42');
    expect(injected.join('\n')).toContain('"language":"python"');

    act(() => {
      webView.props.onMessage({
        nativeEvent: { data: JSON.stringify({ type: 'ready', payload: { lines: 7 } }) },
      });
      webView.props.onMessage({
        nativeEvent: {
          data: JSON.stringify({ type: 'content', payload: { content: 'print(1)' } }),
        },
      });
      webView.props.onMessage({
        nativeEvent: { data: JSON.stringify({ type: 'dirty', payload: { isDirty: true } }) },
      });
      webView.props.onMessage({
        nativeEvent: { data: JSON.stringify({ type: 'mode', payload: { mode: 'codemirror' } }) },
      });
      webView.props.onMessage({
        nativeEvent: {
          data: JSON.stringify({
            type: 'mode',
            payload: { mode: 'fallback', reason: 'load-failed' },
          }),
        },
      });
      webView.props.onMessage({
        nativeEvent: { data: JSON.stringify({ type: 'mode', payload: { mode: 'invalid' } }) },
      });
      webView.props.onMessage({
        nativeEvent: {
          data: JSON.stringify({ type: 'error', payload: { message: 'editor failed' } }),
        },
      });
      webView.props.onMessage({ nativeEvent: { data: '{not-json' } });
    });

    expect(onReady).toHaveBeenCalledWith(7);
    expect(onContent).toHaveBeenCalledWith('print(1)');
    expect(onDirtyChange).toHaveBeenCalledWith(true);
    expect(onModeChange).toHaveBeenNthCalledWith(1, 'codemirror', null);
    expect(onModeChange).toHaveBeenNthCalledWith(2, 'fallback', 'load-failed');
    expect(onModeChange).toHaveBeenCalledTimes(2);
    expect(warnSpy).toHaveBeenCalledWith('[CodeEditorWebView]', 'editor failed');

    warnSpy.mockRestore();
  });
});
