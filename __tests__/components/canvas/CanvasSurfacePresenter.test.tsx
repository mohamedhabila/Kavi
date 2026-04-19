import React from 'react';
import { render } from '@testing-library/react-native';
import { CanvasSurfacePresenter } from '../../../src/components/canvas/CanvasSurfacePresenter';

jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children, ...props }: any) => {
    const React = require('react');
    const { View } = require('react-native');
    return React.createElement(View, props, children);
  },
}));

jest.mock('../../../src/theme/useAppTheme', () => ({
  useAppTheme: () => ({
    colors: {
      background: '#000',
      surface: '#111',
      header: '#111',
      border: '#333',
      text: '#fff',
      textSecondary: '#aaa',
      primary: '#0f0',
    },
  }),
  AppPalette: {},
}));

jest.mock('../../../src/i18n', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

jest.mock('react-native-view-shot', () => ({
  captureRef: jest.fn().mockResolvedValue('base64-image'),
}));

jest.mock('react-native-webview', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    WebView: React.forwardRef((props: any, ref: any) =>
      React.createElement(View, { ...props, ref }),
    ),
  };
});

const mockSurface = {
  id: 'bundle-surface',
  catalogId: 'default',
  title: 'Bundle Surface',
  state: 'active' as const,
  renderMode: 'html' as const,
  rawHtml: '<html><body><main>Fallback source</main></body></html>',
  components: [],
  dataModel: {},
  createdAt: 1,
  sourceBundle: {
    sourceType: 'directory' as const,
    directoryPath: 'canvas/app',
    entryFilePath: 'canvas/app/index.html',
    importedFiles: ['canvas/app/index.html', 'canvas/app/app.js'],
    bundleRootUri: 'file:///mock/documents/canvas-bundles-v1/bundle-surface',
    bundleEntryUri: 'file:///mock/documents/canvas-bundles-v1/bundle-surface/index.html',
  },
};

const mockSubscribeToCanvasFocus = jest.fn((listener: (surfaceId: string | null) => void) => {
  listener('bundle-surface');
  return jest.fn();
});
const mockSubscribeToCanvasSurfaces = jest.fn(() => jest.fn());
const mockGetSurface = jest.fn(() => mockSurface);
const mockGetActiveSurfaces = jest.fn(() => [mockSurface]);
const mockRenderSurfaceToHtml = jest.fn(() => mockSurface.rawHtml);
const mockSetCanvasEventHandler = jest.fn();

jest.mock('../../../src/services/canvas/renderer', () => ({
  closeCanvasSurface: jest.fn(),
  getActiveSurfaces: (...args: any[]) => mockGetActiveSurfaces(...args),
  getSurface: (...args: any[]) => mockGetSurface(...args),
  openCanvasSurface: jest.fn(),
  renderSurfaceToHtml: (...args: any[]) => mockRenderSurfaceToHtml(...args),
  resolveCanvasEval: jest.fn(),
  resolveCanvasRead: jest.fn(),
  resolveCanvasSnapshot: jest.fn(),
  setCanvasEventHandler: (...args: any[]) => mockSetCanvasEventHandler(...args),
  subscribeToCanvasFocus: (...args: any[]) => mockSubscribeToCanvasFocus(...args),
  subscribeToCanvasSurfaces: (...args: any[]) => mockSubscribeToCanvasSurfaces(...args),
}));

jest.mock('../../../src/services/canvas/bundles', () => ({
  hasCanvasSourceBundle: jest.fn(() => true),
}));

jest.mock('../../../src/services/events/bus', () => ({
  emitCanvasEvent: jest.fn(),
}));

describe('CanvasSurfacePresenter', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetSurface.mockReturnValue(mockSurface);
    mockGetActiveSurfaces.mockReturnValue([mockSurface]);
    mockRenderSurfaceToHtml.mockReturnValue(mockSurface.rawHtml);
  });

  it('loads bundle-backed html canvases from the persisted local entry uri with hardened JS/file flags', () => {
    const { getByTestId } = render(<CanvasSurfacePresenter />);

    const webview = getByTestId('global-canvas-webview');
    expect(webview.props.source).toEqual({
      uri: 'file:///mock/documents/canvas-bundles-v1/bundle-surface/index.html',
    });
    expect(webview.props.javaScriptEnabled).toBe(true);
    expect(webview.props.allowFileAccess).toBe(true);
    expect(webview.props.allowFileAccessFromFileURLs).toBe(true);
    expect(webview.props.allowUniversalAccessFromFileURLs).toBe(true);
    expect(webview.props.allowingReadAccessToURL).toBe(
      'file:///mock/documents/canvas-bundles-v1/bundle-surface',
    );
  });

  it('registers the global canvas event handler', () => {
    render(<CanvasSurfacePresenter />);
    expect(mockSetCanvasEventHandler).toHaveBeenCalledWith(
      expect.objectContaining({
        onEval: expect.any(Function),
        onRead: expect.any(Function),
        onSnapshot: expect.any(Function),
        onNavigate: expect.any(Function),
      }),
    );
  });
});
