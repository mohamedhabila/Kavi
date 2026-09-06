// ---------------------------------------------------------------------------
// Tests — check-i18n-consistency.js (plural-category parity + identical-to-
// English lint)
// ---------------------------------------------------------------------------

const {
  compareLocale,
  isAllowlisted,
  findIdenticalToEnglish,
  flattenTranslations,
} = require('../../scripts/check-i18n-consistency');

// Only the CLDR tags this project ships actually need to resolve here.
const LOCALE_BCP47_TAGS: Record<string, string> = {
  en: 'en-US',
  de: 'de-DE',
  fr: 'fr-FR',
  ar: 'ar',
  ja: 'ja-JP',
};

describe('check-i18n-consistency: plural category parity', () => {
  it('passes when the locale supplies every category its language requires', () => {
    const base = flattenTranslations({
      greeting: { one: '{count} fact', other: '{count} facts' },
    });
    const localeOk = flattenTranslations({
      greeting: { one: '{count} Fakt', other: '{count} Fakten' },
    });

    const report = compareLocale('de', base, localeOk, LOCALE_BCP47_TAGS);
    expect(report.pluralCategories).toEqual([]);
    expect(report.placeholders).toEqual([]);
  });

  it('fails when a required category is missing (Arabic needs six, only two supplied)', () => {
    const base = flattenTranslations({
      greeting: { one: '{count} fact', other: '{count} facts' },
    });
    const localeMissingCategories = flattenTranslations({
      // Arabic requires zero/one/two/few/many/other — this table only has two.
      greeting: { one: 'حقيقة واحدة', other: '{count} حقيقة' },
    });

    const report = compareLocale('ar', base, localeMissingCategories, LOCALE_BCP47_TAGS);
    expect(report.pluralCategories).toHaveLength(1);
    expect(report.pluralCategories[0]).toContain('greeting');
    expect(report.pluralCategories[0]).toContain('missing');
    expect(report.pluralCategories[0]).toMatch(/zero/);
    expect(report.pluralCategories[0]).toMatch(/two/);
    expect(report.pluralCategories[0]).toMatch(/few/);
    expect(report.pluralCategories[0]).toMatch(/many/);
  });

  it('fails when the locale supplies an extra category its language does not use', () => {
    const base = flattenTranslations({
      greeting: { one: '{count} fact', other: '{count} facts' },
    });
    // German only ever needs one/other; a stray "few" category is a typo, not a real form.
    const localeExtraCategory = flattenTranslations({
      greeting: { one: '{count} Fakt', few: '{count} Fakten (?)', other: '{count} Fakten' },
    });

    const report = compareLocale('de', base, localeExtraCategory, LOCALE_BCP47_TAGS);
    expect(report.pluralCategories).toHaveLength(1);
    expect(report.pluralCategories[0]).toContain('greeting');
    expect(report.pluralCategories[0]).toContain('unexpected');
    expect(report.pluralCategories[0]).toMatch(/few/);
  });

  it('leaves an ordinary flat-string key unaffected by the plural-category check', () => {
    const base = flattenTranslations({ title: 'Chat', nested: { hint: 'Say hello, {name}' } });
    const localeOk = flattenTranslations({ title: 'Chat-Unterhaltung', nested: { hint: 'Sag hallo, {name}' } });

    const report = compareLocale('de', base, localeOk, LOCALE_BCP47_TAGS);
    expect(report.pluralCategories).toEqual([]);
    expect(report.placeholders).toEqual([]);
    expect(report.missing).toEqual([]);
    expect(report.extra).toEqual([]);
    expect(report.shape).toEqual([]);
  });

  it('still flags a placeholder mismatch on a flat-string key (regression: plural support did not regress string checks)', () => {
    const base = flattenTranslations({ hint: 'Say hello, {name}' });
    const localeBroken = flattenTranslations({ hint: 'Dis bonjour, {nom}' });

    const report = compareLocale('fr', base, localeBroken, LOCALE_BCP47_TAGS);
    expect(report.placeholders).toHaveLength(1);
    expect(report.placeholders[0]).toContain('hint');
  });

  it('allows a category to hardcode the numeral instead of interpolating {count}', () => {
    const base = flattenTranslations({ tools: { one: '1 tool', other: '{count} tools' } });
    // English itself does this ("1 tool", not "{count} tool") — must not be flagged.
    // French also needs a "many" category (Intl.PluralRules('fr-FR')); authored
    // identically to "other" here, same as real CLDR data for this category.
    const localeOk = flattenTranslations({
      tools: { one: '1 outil', many: '{count} outils', other: '{count} outils' },
    });

    const report = compareLocale('fr', base, localeOk, LOCALE_BCP47_TAGS);
    expect(report.placeholders).toEqual([]);
    expect(report.pluralCategories).toEqual([]);
  });
});

describe('check-i18n-consistency: identical-to-English lint', () => {
  it('flags a leaf string that was left identical to English', () => {
    const identical = findIdenticalToEnglish(
      'de',
      new Map([['errorBoundary.title', 'Something went wrong']]),
      { errorBoundary: { title: 'Something went wrong' } },
    );
    expect(identical).toEqual(['errorBoundary.title']);
  });

  it('does not flag a genuinely translated string', () => {
    const identical = findIdenticalToEnglish(
      'de',
      new Map([['errorBoundary.title', 'Something went wrong']]),
      { errorBoundary: { title: 'Etwas ist schiefgelaufen' } },
    );
    expect(identical).toEqual([]);
  });

  it('splits a plural table into per-category leaves and flags only the identical category', () => {
    const identical = findIdenticalToEnglish(
      'de',
      new Map([
        ['nav.memoryStatsFacts#one', '{count} fact'],
        ['nav.memoryStatsFacts#other', '{count} facts'],
      ]),
      { nav: { memoryStatsFacts: { one: '{count} Fakt', other: '{count} facts' } } },
    );
    expect(identical).toEqual(['nav.memoryStatsFacts#other']);
  });

  it('respects the key allowlist (brand names, format-only strings)', () => {
    expect(isAllowlisted('common.appName', 'de', 'Kavi')).toBe(true);
    expect(isAllowlisted('common.secondsShort', 'de', '{count}s')).toBe(true);
  });

  it('respects the technical-namespace prefix allowlist', () => {
    expect(isAllowlisted('remoteWork.providerCursor', 'de', 'Cursor')).toBe(true);
    expect(isAllowlisted('settings.sshHost', 'de', 'Host')).toBe(true);
  });

  it('respects the per-locale cognate-value allowlist without leaking to other locales', () => {
    expect(isAllowlisted('chat.title', 'de', 'Chat')).toBe(true);
    expect(isAllowlisted('chat.title', 'ja', 'Chat')).toBe(false);
  });

  it('does not allowlist a key outside every allowlist', () => {
    expect(isAllowlisted('errorBoundary.title', 'de', 'Something went wrong')).toBe(false);
  });
});
