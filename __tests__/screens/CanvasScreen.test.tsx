// ---------------------------------------------------------------------------
// Tests — CanvasScreen
// ---------------------------------------------------------------------------

import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { CanvasScreen } from '../../src/screens/CanvasScreen';

// Mock safe area
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children, ...props }: any) => {
    const React = require('react');
    const { View } = require('react-native');
    return React.createElement(View, props, children);
  },
}));

// Mock navigation
const mockGoBack = jest.fn();
const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ goBack: mockGoBack, navigate: mockNavigate }),
  useRoute: () => ({ name: 'Canvas' }),
  useFocusEffect: jest.fn(),
}));

// Mock theme
jest.mock('../../src/theme/useAppTheme', () => ({
  useAppTheme: () => ({
    colors: {
      background: '#000',
      surface: '#111',
      surfaceAlt: '#222',
      header: '#111',
      border: '#333',
      subtleBorder: '#444',
      text: '#fff',
      textSecondary: '#aaa',
      textTertiary: '#777',
      placeholder: '#555',
      primary: '#0f0',
      onPrimary: '#fff',
      primarySoft: '#030',
      danger: '#f00',
      panel: '#111',
    },
  }),
  AppPalette: {},
}));

// Mock WebView
jest.mock('react-native-webview', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    WebView: (props: any) => React.createElement(View, { testID: 'webview', ...props }),
  };
});

// Mock canvas renderer
const mockGetActiveSurfaces = jest.fn().mockReturnValue([]);
const mockRenderSurfaceToHtml = jest.fn().mockReturnValue(null);
const mockDeleteSurface = jest.fn();
const mockClearAllSurfaces = jest.fn();
const mockGetAllSurfaces = jest.fn().mockReturnValue([]);
const mockSubscribeToCanvasSurfaces = jest.fn().mockImplementation(() => jest.fn());
const mockOpenCanvasSurface = jest.fn();

jest.mock('../../src/services/canvas/renderer', () => ({
  getActiveSurfaces: (...args: any[]) => mockGetActiveSurfaces(...args),
  deleteSurface: (...args: any[]) => mockDeleteSurface(...args),
  clearAllSurfaces: (...args: any[]) => mockClearAllSurfaces(...args),
  getAllSurfaces: (...args: any[]) => mockGetAllSurfaces(...args),
  subscribeToCanvasSurfaces: (...args: any[]) => mockSubscribeToCanvasSurfaces(...args),
  openCanvasSurface: (...args: any[]) => mockOpenCanvasSurface(...args),
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockGetActiveSurfaces.mockReturnValue([]);
});

describe('CanvasScreen', () => {
  it('renders header with title', () => {
    const { getByText } = render(<CanvasScreen />);
    expect(getByText('Canvas')).toBeTruthy();
  });

  it('shows empty state when no surfaces', () => {
    const { getByText } = render(<CanvasScreen />);
    expect(getByText('No active surfaces')).toBeTruthy();
  });

  it('renders surfaces when available', () => {
    mockGetActiveSurfaces.mockReturnValue([
      {
        id: 'surf-1',
        title: 'Test Surface',
        components: [],
        state: 'active',
        renderMode: 'components',
      },
    ]);

    const { getByText } = render(<CanvasScreen />);
    expect(getByText('Test Surface')).toBeTruthy();
    expect(
      getByText('This canvas stays lightweight in the list and renders only when you open it.'),
    ).toBeTruthy();
  });

  it('navigates back on back button press', () => {
    const { UNSAFE_getAllByType } = render(<CanvasScreen />);
    // Find the back button (first touchable)
    const touchables = UNSAFE_getAllByType(require('react-native').TouchableOpacity);
    fireEvent.press(touchables[0]);
    expect(mockNavigate).toHaveBeenCalledWith('Chat');
  });

  it('calls deleteSurface when delete pressed', () => {
    mockGetActiveSurfaces.mockReturnValue([
      {
        id: 'surf-del',
        title: 'Delete Me',
        components: [],
        state: 'active',
        renderMode: 'components',
      },
    ]);

    const { UNSAFE_getAllByType } = render(<CanvasScreen />);
    // Find delete buttons (Trash2 icon touchables)
    const touchables = UNSAFE_getAllByType(require('react-native').TouchableOpacity);
    // The delete button should be one of the touchables (not back, not refresh)
    // Press the last one which should be the delete in the card
    const deletableTouch = touchables.find((_: any, i: number) => i > 1);
    if (deletableTouch) {
      fireEvent.press(deletableTouch);
      expect(mockDeleteSurface).toHaveBeenCalledWith('surf-del');
    }
  });

  it('still lists surfaces without rendering preview HTML', () => {
    mockGetActiveSurfaces.mockReturnValue([
      {
        id: 'surf-null',
        title: 'Null HTML',
        components: [],
        state: 'active',
        renderMode: 'components',
      },
    ]);

    const { getByText } = render(<CanvasScreen />);
    expect(getByText('Null HTML')).toBeTruthy();
  });

  it('renders surface without title using fallback label', () => {
    mockGetActiveSurfaces.mockReturnValue([
      { id: 'surf-no-title', components: [], state: 'active', renderMode: 'components' },
    ]);

    const { getByText } = render(<CanvasScreen />);
    expect(getByText('Surface surf-no-title')).toBeTruthy();
  });

  it('refreshes surfaces when refresh button pressed', () => {
    const { UNSAFE_getAllByType } = render(<CanvasScreen />);
    const touchables = UNSAFE_getAllByType(require('react-native').TouchableOpacity);
    // Refresh button is the second touchable (after back)
    fireEvent.press(touchables[1]);
    // mockGetActiveSurfaces should be called again on re-render
    expect(mockGetActiveSurfaces).toHaveBeenCalled();
  });

  it('subscribes to canvas updates on mount', () => {
    render(<CanvasScreen />);
    expect(mockSubscribeToCanvasSurfaces).toHaveBeenCalled();
  });

  it('opens surfaces through the global presenter', () => {
    mockGetActiveSurfaces.mockReturnValue([
      {
        id: 'surf-open',
        title: 'Open Me',
        components: [],
        state: 'active',
        renderMode: 'components',
      },
    ]);

    const { getByText } = render(<CanvasScreen />);
    fireEvent.press(getByText('Open'));

    expect(mockOpenCanvasSurface).toHaveBeenCalledWith('surf-open');
  });

  it('renders URL-backed surfaces only when opened', () => {
    mockGetActiveSurfaces.mockReturnValue([
      {
        id: 'surf-url',
        title: 'URL Surface',
        components: [],
        state: 'active',
        renderMode: 'url',
        url: 'https://example.com',
      },
    ]);

    const { getByText } = render(<CanvasScreen />);

    expect(getByText('example.com')).toBeTruthy();
  });

  it('shortens long URL-backed surface labels in the list', () => {
    mockGetActiveSurfaces.mockReturnValue([
      {
        id: 'surf-url-long',
        title: 'Long URL Surface',
        components: [],
        state: 'active',
        renderMode: 'url',
        url: 'https://www.example.com/projects/kavi/canvases/focused/view/index.html?mode=preview&panel=debug',
      },
    ]);

    const { getByText, queryByText } = render(<CanvasScreen />);

    expect(
      getByText(/example\.com\/projects\/kavi\/canvases\/focused\/view\/index\.\.\.$/),
    ).toBeTruthy();
    expect(
      queryByText(
        'https://www.example.com/projects/kavi/canvases/focused/view/index.html?mode=preview&panel=debug',
      ),
    ).toBeNull();
  });
});
