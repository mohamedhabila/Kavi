// ---------------------------------------------------------------------------
// Tests — Theme System
// ---------------------------------------------------------------------------

// Mock the store before importing the module
jest.mock('../../src/store/useSettingsStore', () => ({
  useSettingsStore: jest.fn(),
}));

// Mock useColorScheme without touching the entire react-native module
const mockUseColorScheme = jest.fn().mockReturnValue('dark');
jest.mock('react-native/Libraries/Utilities/useColorScheme', () => ({
  __esModule: true,
  default: () => mockUseColorScheme(),
}));

import { useSettingsStore } from '../../src/store/useSettingsStore';
import { getPalette, useAppTheme, getNavigationTheme } from '../../src/theme/useAppTheme';

// For renderHook - import after mocks
import { renderHook } from '@testing-library/react-native';

describe('Theme System', () => {
  describe('getPalette', () => {
    it('should return dark palette', () => {
      const palette = getPalette('dark');
      expect(palette.mode).toBe('dark');
      expect(palette.background).toBe('#0f0f11');
    });

    it('should return light palette', () => {
      const palette = getPalette('light');
      expect(palette.mode).toBe('light');
      expect(palette.background).toBe('#e8eaef');
    });

    it('should have all required properties', () => {
      const palette = getPalette('dark');
      expect(palette.primary).toBeDefined();
      expect(palette.text).toBeDefined();
      expect(palette.surface).toBeDefined();
      expect(palette.userBubble).toBeDefined();
      expect(palette.assistantBubble).toBeDefined();
      expect(palette.danger).toBeDefined();
    });
  });

  describe('useAppTheme', () => {
    beforeEach(() => {
      jest.clearAllMocks();
    });

    it('should resolve system theme to dark when system is dark', () => {
      (useSettingsStore as unknown as jest.Mock).mockImplementation((selector: any) =>
        selector({ theme: 'system' }),
      );
      mockUseColorScheme.mockReturnValue('dark');

      const { result } = renderHook(() => useAppTheme());
      expect(result.current.resolvedTheme).toBe('dark');
      expect(result.current.isDark).toBe(true);
      expect(result.current.colors.mode).toBe('dark');
    });

    it('should resolve system theme to light when system is light', () => {
      (useSettingsStore as unknown as jest.Mock).mockImplementation((selector: any) =>
        selector({ theme: 'system' }),
      );
      mockUseColorScheme.mockReturnValue('light');

      const { result } = renderHook(() => useAppTheme());
      expect(result.current.resolvedTheme).toBe('light');
      expect(result.current.isDark).toBe(false);
    });

    it('should respect explicit dark preference', () => {
      (useSettingsStore as unknown as jest.Mock).mockImplementation((selector: any) =>
        selector({ theme: 'dark' }),
      );
      mockUseColorScheme.mockReturnValue('light');

      const { result } = renderHook(() => useAppTheme());
      expect(result.current.resolvedTheme).toBe('dark');
    });

    it('should respect explicit light preference', () => {
      (useSettingsStore as unknown as jest.Mock).mockImplementation((selector: any) =>
        selector({ theme: 'light' }),
      );
      mockUseColorScheme.mockReturnValue('dark');

      const { result } = renderHook(() => useAppTheme());
      expect(result.current.resolvedTheme).toBe('light');
    });

    it('should default to system when theme is not set', () => {
      (useSettingsStore as unknown as jest.Mock).mockImplementation((selector: any) =>
        selector({ theme: undefined }),
      );
      mockUseColorScheme.mockReturnValue('dark');

      const { result } = renderHook(() => useAppTheme());
      expect(result.current.resolvedTheme).toBe('dark');
    });
  });

  describe('getNavigationTheme', () => {
    it('should return navigation theme based on dark palette', () => {
      const palette = getPalette('dark');
      const navTheme = getNavigationTheme(palette);
      expect(navTheme.dark).toBe(true);
      expect(navTheme.colors.primary).toBe(palette.primary);
      expect(navTheme.colors.background).toBe(palette.background);
    });

    it('should return navigation theme based on light palette', () => {
      const palette = getPalette('light');
      const navTheme = getNavigationTheme(palette);
      expect(navTheme.dark).toBe(false);
      expect(navTheme.colors.primary).toBe(palette.primary);
    });
  });
});
