import { useCallback, useMemo, useState } from 'react';

import type { Locale } from '../../i18n/types';
import { i18n } from '../../i18n/manager';
import type { AgentPersona } from '../../services/agents/personas';
import type { ThinkingLevelPreference } from '../../types/provider';

type TranslationFn = (key: string, params?: any) => string;
type PersonaThinkingLevel = NonNullable<AgentPersona['thinkingLevel']>;

/** A thinking level the person can pick; unset is the model's own default. */
export type ThinkingLevelOption = {
  key: string;
  value: ThinkingLevelPreference | undefined;
  label: string;
  hint: string;
};

const THINKING_LEVEL_VALUES: Array<ThinkingLevelPreference | undefined> = [
  undefined,
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
    (): ThinkingLevelOption[] =>
      THINKING_LEVEL_VALUES.map((value) => {
        const key = value ?? 'default';
        return {
          key,
          value,
          label: t(`settings.thinkingOptions.${key}.label`),
          hint: t(`settings.thinkingOptions.${key}.hint`),
        };
      }),
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
