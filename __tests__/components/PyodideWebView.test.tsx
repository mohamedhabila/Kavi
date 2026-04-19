import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { PyodideWebView } from '../../src/components/python/PyodideWebView';

const mockGetPyodideHtml = jest.fn(() => '<html><body>pyodide</body></html>');
const mockHandlePyodideMessage = jest.fn();
const mockRegisterPyodideWebView = jest.fn();
const mockReportPyodideRuntimeFailure = jest.fn();
const mockUnregisterPyodideWebView = jest.fn();

jest.mock('../../src/services/python/pyodideBridge', () => ({
  PYODIDE_WEBVIEW_BASE_URL: 'https://cdn.jsdelivr.net/pyodide/v0.27.5/full/',
  getPyodideHtml: () => mockGetPyodideHtml(),
  handlePyodideMessage: (payload: string) => mockHandlePyodideMessage(payload),
  registerPyodideWebView: (instance: unknown) => mockRegisterPyodideWebView(instance),
  reportPyodideRuntimeFailure: (message: string) => mockReportPyodideRuntimeFailure(message),
  unregisterPyodideWebView: () => mockUnregisterPyodideWebView(),
}));

describe('PyodideWebView', () => {
  beforeEach(() => {
    mockGetPyodideHtml.mockClear();
    mockHandlePyodideMessage.mockClear();
    mockRegisterPyodideWebView.mockClear();
    mockReportPyodideRuntimeFailure.mockClear();
    mockUnregisterPyodideWebView.mockClear();
  });

  it('registers the WebView bridge and unregisters it on unmount', () => {
    const { unmount } = render(<PyodideWebView />);

    expect(mockRegisterPyodideWebView).toHaveBeenCalledWith(
      expect.objectContaining({
        injectJavaScript: expect.any(Function),
        postMessage: expect.any(Function),
      }),
    );

    unmount();

    expect(mockUnregisterPyodideWebView).toHaveBeenCalledTimes(1);
  });

  it('renders the hidden WebView with the generated Pyodide HTML and forwards messages', () => {
    const { getByTestId } = render(<PyodideWebView />);
    const webView = getByTestId('mock-webview', { includeHiddenElements: true });

    expect(mockGetPyodideHtml).toHaveBeenCalledTimes(1);
    expect(webView.props.source).toEqual({
      html: '<html><body>pyodide</body></html>',
      baseUrl: 'https://cdn.jsdelivr.net/pyodide/v0.27.5/full/',
    });
    expect(webView.props.originWhitelist).toEqual(['*']);
    expect(webView.props.domStorageEnabled).toBe(true);
    expect(webView.props.cacheEnabled).toBe(true);
    expect(webView.props.scrollEnabled).toBe(false);
    expect(webView.props.bounces).toBe(false);

    fireEvent(webView, 'message', { nativeEvent: { data: '{"type":"pyodide-ready"}' } });

    expect(mockHandlePyodideMessage).toHaveBeenCalledWith('{"type":"pyodide-ready"}');
  });

  it('reports WebView load failures to the Pyodide bridge', () => {
    const { getByTestId } = render(<PyodideWebView />);
    const webView = getByTestId('mock-webview', { includeHiddenElements: true });

    fireEvent(webView, 'error', {
      nativeEvent: { description: 'network failed', url: 'https://cdn.jsdelivr.net' },
    });

    expect(mockReportPyodideRuntimeFailure).toHaveBeenCalledWith(
      expect.stringContaining('network failed'),
    );
    expect(mockReportPyodideRuntimeFailure).toHaveBeenCalledWith(
      expect.stringContaining('https://cdn.jsdelivr.net'),
    );
  });

  it('reports WebView load failures without metadata using the base message', () => {
    const { getByTestId } = render(<PyodideWebView />);
    const webView = getByTestId('mock-webview', { includeHiddenElements: true });

    fireEvent(webView, 'error', {});

    expect(mockReportPyodideRuntimeFailure).toHaveBeenCalledWith('Pyodide WebView failed to load');
  });

  it('reports HTTP failures to the Pyodide bridge', () => {
    const { getByTestId } = render(<PyodideWebView />);
    const webView = getByTestId('mock-webview', { includeHiddenElements: true });

    fireEvent(webView, 'httpError', {
      nativeEvent: { statusCode: 503, description: 'service unavailable' },
    });

    expect(mockReportPyodideRuntimeFailure).toHaveBeenCalledWith(
      expect.stringContaining('status 503'),
    );
    expect(mockReportPyodideRuntimeFailure).toHaveBeenCalledWith(
      expect.stringContaining('service unavailable'),
    );
  });

  it('reports iOS content-process termination to the Pyodide bridge', () => {
    const { getByTestId } = render(<PyodideWebView />);
    const webView = getByTestId('mock-webview', { includeHiddenElements: true });

    fireEvent(webView, 'contentProcessDidTerminate');

    expect(mockReportPyodideRuntimeFailure).toHaveBeenCalledWith(
      expect.stringContaining('content process terminated'),
    );
  });

  it('reports Android render-process termination to the Pyodide bridge', () => {
    const { getByTestId } = render(<PyodideWebView />);
    const webView = getByTestId('mock-webview', { includeHiddenElements: true });

    fireEvent(webView, 'renderProcessGone', { nativeEvent: { didCrash: true } });

    expect(mockReportPyodideRuntimeFailure).toHaveBeenCalledWith(
      expect.stringContaining('render process terminated'),
    );
    expect(mockReportPyodideRuntimeFailure).toHaveBeenCalledWith(
      expect.stringContaining('crashed'),
    );
  });

  it('reports non-crash render-process termination to the Pyodide bridge', () => {
    const { getByTestId } = render(<PyodideWebView />);
    const webView = getByTestId('mock-webview', { includeHiddenElements: true });

    fireEvent(webView, 'renderProcessGone', { nativeEvent: { didCrash: false } });

    expect(mockReportPyodideRuntimeFailure).toHaveBeenCalledWith(
      expect.stringContaining('exited unexpectedly'),
    );
  });
});
