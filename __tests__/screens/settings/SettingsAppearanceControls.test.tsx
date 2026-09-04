// ---------------------------------------------------------------------------
// Tests — SettingsAppearanceControls (language picker "Follow system" row)
// ---------------------------------------------------------------------------

import { fireEvent, render } from '@testing-library/react-native';
import React from 'react';

import { SettingsAppearanceControls } from '../../../src/screens/settings/SettingsAppearanceControls';

let mockLocalePreference: string = 'system';
const mockSetLocalePreference = jest.fn();
const mockSubscribers = new Set<() => void>();

jest.mock('../../../src/i18n/manager', () => ({
  i18n: {
    get localePreference() {
      return mockLocalePreference;
    },
    subscribe: (fn: () => void) => {
      mockSubscribers.add(fn);
      return () => mockSubscribers.delete(fn);
    },
    setLocalePreference: (...args: unknown[]) => {
      mockSetLocalePreference(...args);
      return Promise.resolve();
    },
  },
  SYSTEM_LOCALE_PREFERENCE: 'system',
}));

jest.mock('../../../src/i18n/deviceLocale', () => ({
  getDeviceLocaleTag: jest.fn(() => 'fr-FR'),
}));

const LOCALE_DISPLAY_NAMES: Record<string, string> = {
  en: 'English',
  'zh-CN': '简体中文',
  'zh-TW': '繁體中文',
  'pt-BR': 'Português',
  de: 'Deutsch',
  es: 'Español',
  ar: 'العربية',
  fr: 'Français',
  ja: '日本語',
};

const SUPPORTED_LOCALES = ['en', 'zh-CN', 'zh-TW', 'pt-BR', 'de', 'es', 'ar', 'fr', 'ja'] as const;

const t = (key: string, params?: Record<string, unknown>) => {
  if (key === 'settings.languageFollowSystem') return 'Follow system language';
  if (key === 'settings.language') return 'Language';
  if (key === 'settings.languageHint') return 'Choose the app language';
  if (key === 'common.cancel') return 'Cancel';
  if (params?.name) return `${key}:${params.name}`;
  return key;
};

const noopStyles = new Proxy(
  {},
  {
    get: () => ({}),
  },
) as Record<string, any>;

function renderControls(overrides: Partial<React.ComponentProps<typeof SettingsAppearanceControls>> = {}) {
  const handleLocaleChange = jest.fn();
  const setShowLanguagePicker = jest.fn();
  const setTheme = jest.fn();

  const utils = render(
    <SettingsAppearanceControls
      colors={{ primary: '#000', textSecondary: '#333', textTertiary: '#666', text: '#111' } as any}
      handleLocaleChange={handleLocaleChange}
      locale="en"
      localeDisplayNames={LOCALE_DISPLAY_NAMES}
      setShowLanguagePicker={setShowLanguagePicker}
      setTheme={setTheme}
      showLanguagePicker
      styles={noopStyles}
      supportedLocales={SUPPORTED_LOCALES}
      t={t}
      theme="system"
      {...overrides}
    />,
  );

  return { ...utils, handleLocaleChange, setShowLanguagePicker, setTheme };
}

beforeEach(() => {
  mockLocalePreference = 'system';
  mockSetLocalePreference.mockReset();
  mockSubscribers.clear();
});

describe('SettingsAppearanceControls', () => {
  it('shows the "Follow system language" row with the resolved device language as its subtitle', () => {
    const { getAllByText } = renderControls();

    expect(getAllByText('Follow system language').length).toBeGreaterThan(0);
    // fr-FR resolves to the 'fr' supported locale → "Français", shown both as the
    // follow-system subtitle and as the explicit 'fr' row further down the list.
    expect(getAllByText('Français').length).toBe(2);
  });

  it('calls i18n.setLocalePreference("system") and closes the picker when the row is pressed', () => {
    const { getAllByText, setShowLanguagePicker } = renderControls();

    // The first match is the header row; the second is the row inside the modal list.
    fireEvent.press(getAllByText('Follow system language')[1]);

    expect(mockSetLocalePreference).toHaveBeenCalledWith('system');
    expect(setShowLanguagePicker).toHaveBeenCalledWith(false);
  });

  it('selecting an explicit locale still calls handleLocaleChange, not setLocalePreference', () => {
    const { getAllByText, handleLocaleChange } = renderControls();

    fireEvent.press(getAllByText('Deutsch')[0]);

    expect(handleLocaleChange).toHaveBeenCalledWith('de');
    expect(mockSetLocalePreference).not.toHaveBeenCalled();
  });

  it('shows the follow-system label (not the raw locale) in the header row while following the system', () => {
    const { getAllByText } = renderControls();

    // The header row and the modal row both render the follow-system label.
    expect(getAllByText('Follow system language').length).toBeGreaterThan(0);
  });

  it('shows the explicit locale name in the header row when a specific locale is pinned', () => {
    mockLocalePreference = 'de';
    const { getAllByText, queryAllByText } = renderControls({ locale: 'de' });

    // Header shows the explicit locale name, and the modal's 'de' row shows it too.
    expect(getAllByText('Deutsch').length).toBe(2);
    // ...and the follow-system row itself is still present (just unchecked).
    expect(queryAllByText('Follow system language').length).toBeGreaterThan(0);
  });
});
