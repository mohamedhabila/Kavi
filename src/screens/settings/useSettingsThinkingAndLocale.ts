import { useCallback, useMemo, useState } from 'react';

import type { Locale } from '../../i18n/types';
import { i18n } from '../../i18n/manager';
import type { AgentPersona } from '../../services/agents/personas';

type TranslationFn = (key: string, params?: any) => string;
type ThinkingOption = 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';
type PersonaThinkingLevel = NonNullable<AgentPersona['thinkingLevel']>;

const THINKING_LEVEL_VALUES: ThinkingOption[] = [
  'off',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
];
const PERSONA_THINKING_LEVEL_VALUES: PersonaThinkingLevel[] = ['off', 'low', 'medium', 'high'];

export function useSettingsThinkingAndLocale({
  t,
  setLocale,
}: {
  t: TranslationFn;
  setLocale: (locale: Locale) => void;
}) {
  const [showLanguagePicker, setShowLanguagePicker] = useState(false);

  const thinkingLevelOptions = useMemo(
    () =>
      THINKING_LEVEL_VALUES.map((value) => ({
        value,
        label: t(`settings.thinkingOptions.${value}.label`),
        hint: t(`settings.thinkingOptions.${value}.hint`),
      })),
    [t],
  );

  const personaThinkingLevelOptions = useMemo(
    () =>
      PERSONA_THINKING_LEVEL_VALUES.map((value) => ({
        value,
        label: t(`settings.thinkingOptions.${value}.label`),
        hint: t(`settings.thinkingOptions.${value}.hint`),
      })),
    [t],
  );

  const handleLocaleChange = useCallback(
    async (newLocale: Locale) => {
      setLocale(newLocale);
      await i18n.setLocale(newLocale);
      setShowLanguagePicker(false);
    },
    [setLocale],
  );

  return {
    showLanguagePicker,
    setShowLanguagePicker,
    thinkingLevelOptions,
    personaThinkingLevelOptions,
    handleLocaleChange,
  };
}
