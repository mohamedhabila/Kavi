// ---------------------------------------------------------------------------
// Tests — SettingsAppearanceControls under a right-to-left layout direction
// ---------------------------------------------------------------------------
// The language picker row shows a trailing disclosure chevron
// (`ForwardChevronIcon` in src/components/navigation/DirectionalIcons.tsx)
// that must point toward the reading-end edge: right in LTR, left in RTL.
// Unlike `alignItems`/`borderBottomEndRadius` (mirrored natively by Yoga —
// see the comment in MessageBubble.rtl.test.tsx), an icon glyph is a JS-level
// choice, so this is directly observable in a render test: mock
// `I18nManager.isRTL` and assert the row renders the mirrored glyph.

import { render } from '@testing-library/react-native';
import { I18nManager } from 'react-native';
import React from 'react';

import { SettingsAppearanceControls } from '../../../src/screens/settings/SettingsAppearanceControls';

const mockSubscribers = new Set<() => void>();

jest.mock('../../../src/i18n/manager', () => ({
  i18n: {
    localePreference: 'en',
    subscribe: (fn: () => void) => {
      mockSubscribers.add(fn);
      return () => mockSubscribers.delete(fn);
    },
    setLocalePreference: jest.fn(() => Promise.resolve()),
  },
  SYSTEM_LOCALE_PREFERENCE: 'system',
}));

jest.mock('../../../src/i18n/deviceLocale', () => ({
  getDeviceLocaleTag: jest.fn(() => 'en-US'),
}));

const LOCALE_DISPLAY_NAMES: Record<string, string> = {
  en: 'English',
  ar: 'العربية',
};

const t = (key: string) => key;

const noopStyles = new Proxy({}, { get: () => ({}) }) as Record<string, any>;

function renderControls() {
  return render(
    <SettingsAppearanceControls
      colors={{ primary: '#000', textSecondary: '#333', textTertiary: '#666', text: '#111' } as any}
      handleLocaleChange={jest.fn()}
      locale="en"
      localeDisplayNames={LOCALE_DISPLAY_NAMES}
      setShowLanguagePicker={jest.fn()}
      setTheme={jest.fn()}
      showLanguagePicker={false}
      styles={noopStyles}
      supportedLocales={['en', 'ar']}
      t={t}
      theme="system"
    />,
  );
}

describe('SettingsAppearanceControls RTL mirroring', () => {
  const originalIsRTL = I18nManager.isRTL;

  afterEach(() => {
    (I18nManager as unknown as { isRTL: boolean }).isRTL = originalIsRTL;
  });

  it('points the language row chevron toward the reading end in LTR (right)', () => {
    (I18nManager as unknown as { isRTL: boolean }).isRTL = false;

    const { getByTestId, queryByTestId } = renderControls();

    expect(getByTestId('icon-ChevronRight')).toBeTruthy();
    expect(queryByTestId('icon-ChevronLeft')).toBeNull();
  });

  it('mirrors the language row chevron toward the reading end in RTL (left)', () => {
    (I18nManager as unknown as { isRTL: boolean }).isRTL = true;

    const { getByTestId, queryByTestId } = renderControls();

    expect(getByTestId('icon-ChevronLeft')).toBeTruthy();
    expect(queryByTestId('icon-ChevronRight')).toBeNull();
  });
});
