import React from 'react';
import { act, render } from '@testing-library/react-native';
import {
  TerminalWebView,
  type TerminalWebViewRef,
  buildXtermTheme,
} from '../../src/components/terminal/TerminalWebView';
import { getPalette } from '../../src/theme/useAppTheme';

const mockInjectJavaScript = jest.fn();

jest.mock('react-native-webview', () => {
  const React = require('react');
  const { View } = require('react-native');

  const MockWebView = React.forwardRef((props: any, ref: any) => {
    React.useImperativeHandle(ref, () => ({
      injectJavaScript: mockInjectJavaScript,
    }));
    return React.createElement(View, { ...props, testID: 'mock-terminal-webview' });
  });

  MockWebView.displayName = 'MockTerminalWebView';

  return {
    __esModule: true,
    default: MockWebView,
    WebView: MockWebView,
  };
});

describe('TerminalWebView', () => {
  const colors = getPalette('dark');

  beforeEach(() => {
    mockInjectJavaScript.mockClear();
  });

  it('builds an xterm theme from the app palette', () => {
    expect(buildXtermTheme(colors)).toEqual(
      expect.objectContaining({
        background: colors.codeBackground,
        foreground: colors.text,
        cursor: colors.primary,
        selectionBackground: `${colors.primary}44`,
        yellow: colors.warning,
        blue: colors.info,
      }),
    );
  });

  it('syncs theme updates, bridges imperative commands, and handles terminal events', () => {
    const onInput = jest.fn();
    const onReady = jest.fn();
    const onResize = jest.fn();
    const onLink = jest.fn();
    const onTitleChange = jest.fn();
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const ref = React.createRef<TerminalWebViewRef>();

    const { getByTestId } = render(
      <TerminalWebView
        ref={ref}
        colors={colors}
        fontSize={16}
        onInput={onInput}
        onReady={onReady}
        onResize={onResize}
        onLink={onLink}
        onTitleChange={onTitleChange}
      />,
    );

    const webView = getByTestId('mock-terminal-webview');
    expect(webView.props.injectedJavaScriptBeforeContentLoaded).toContain('"fontSize":16');
    expect(webView.props.injectedJavaScriptBeforeContentLoaded).toContain(
      "'Menlo', 'Courier New', monospace",
    );
    expect(mockInjectJavaScript).toHaveBeenCalledWith(expect.stringContaining('"type":"theme"'));

    mockInjectJavaScript.mockClear();

    act(() => {
      ref.current?.write('hello');
      ref.current?.writeln('world');
      ref.current?.clear();
      ref.current?.reset();
      ref.current?.focus();
      ref.current?.paste('ls -la');
      ref.current?.search('needle');
      ref.current?.updateTheme(buildXtermTheme(colors));
      ref.current?.updateConfig({ fontSize: 18 });
      ref.current?.fit();
    });

    const injected = mockInjectJavaScript.mock.calls.map(([script]) => String(script));
    expect(injected).toEqual(
      expect.arrayContaining([
        expect.stringContaining('"type":"output"'),
        expect.stringContaining('"type":"writeln"'),
        expect.stringContaining('"type":"clear"'),
        expect.stringContaining('"type":"reset"'),
        expect.stringContaining('"type":"focus"'),
        expect.stringContaining('"type":"paste"'),
        expect.stringContaining('"type":"search"'),
        expect.stringContaining('"type":"theme"'),
        expect.stringContaining('"type":"config"'),
        expect.stringContaining('"type":"resize"'),
      ]),
    );
    expect(injected.join('\n')).toContain('"data":"hello"');
    expect(injected.join('\n')).toContain('"text":"ls -la"');
    expect(injected.join('\n')).toContain('"query":"needle"');
    expect(injected.join('\n')).toContain('"fontSize":18');

    act(() => {
      webView.props.onMessage({
        nativeEvent: { data: JSON.stringify({ type: 'input', payload: { data: 'pwd' } }) },
      });
      webView.props.onMessage({
        nativeEvent: { data: JSON.stringify({ type: 'ready', payload: { cols: 120, rows: 40 } }) },
      });
      webView.props.onMessage({
        nativeEvent: { data: JSON.stringify({ type: 'resize', payload: { cols: 100, rows: 30 } }) },
      });
      webView.props.onMessage({
        nativeEvent: {
          data: JSON.stringify({ type: 'link', payload: { uri: 'https://example.com' } }),
        },
      });
      webView.props.onMessage({
        nativeEvent: { data: JSON.stringify({ type: 'title', payload: { title: 'SSH Session' } }) },
      });
      webView.props.onMessage({
        nativeEvent: {
          data: JSON.stringify({ type: 'error', payload: { message: 'terminal failed' } }),
        },
      });
      webView.props.onMessage({ nativeEvent: { data: '{not-json' } });
    });

    expect(onInput).toHaveBeenCalledWith('pwd');
    expect(onReady).toHaveBeenCalledWith(120, 40);
    expect(onResize).toHaveBeenCalledWith(100, 30);
    expect(onLink).toHaveBeenCalledWith('https://example.com');
    expect(onTitleChange).toHaveBeenCalledWith('SSH Session');
    expect(warnSpy).toHaveBeenCalledWith('[TerminalWebView] xterm error:', 'terminal failed');

    warnSpy.mockRestore();
  });
});
