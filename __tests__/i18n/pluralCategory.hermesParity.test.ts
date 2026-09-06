// ---------------------------------------------------------------------------
// Tests — CLDR plural category resolution parity with Hermes
// ---------------------------------------------------------------------------
// Hermes (this app's on-device JS engine) does not implement
// `Intl.PluralRules` or `Intl.Locale`, so `src/i18n/pluralCategory.ts` fell
// back to the binary one/other rule for every locale on-device — verified
// on a cold-started Android emulator in Arabic, where counts 0, 2 and 5 all
// rendered the `other` form instead of Arabic's zero/two/many. Jest never
// caught this because Node ships full ICU with a native, conformant
// `Intl.PluralRules`.
//
// This suite deletes `Intl.PluralRules`, `Intl.Locale` and
// `Intl.getCanonicalLocales` from the global before importing this app's
// polyfill bootstrap (`src/i18n/intlPolyfills.ts`), so the bootstrap has to
// install its FormatJS polyfills from scratch exactly as it would on a real
// Hermes engine, then asserts `selectPluralCategory` resolves each locale's
// real CLDR rule rather than the binary fallback.

type IntlWithOptionalCtors = typeof Intl & {
  PluralRules?: typeof Intl.PluralRules;
  Locale?: typeof Intl.Locale;
  getCanonicalLocales?: typeof Intl.getCanonicalLocales;
};

describe('selectPluralCategory parity with a Hermes-shaped Intl (no PluralRules/Locale/getCanonicalLocales)', () => {
  let originalPluralRules: typeof Intl.PluralRules | undefined;
  let originalLocale: typeof Intl.Locale | undefined;
  let originalGetCanonicalLocales: typeof Intl.getCanonicalLocales | undefined;
  let selectPluralCategory: (typeof import('../../src/i18n/pluralCategory'))['selectPluralCategory'];

  beforeAll(() => {
    const intl = Intl as IntlWithOptionalCtors;
    originalPluralRules = intl.PluralRules;
    originalLocale = intl.Locale;
    originalGetCanonicalLocales = intl.getCanonicalLocales;

    delete intl.PluralRules;
    delete intl.Locale;
    delete intl.getCanonicalLocales;

    // The polyfill bootstrap's imports are static, so it must be required
    // (not statically imported) after the native constructors are gone —
    // otherwise it would install against the still-present native APIs and
    // this suite would prove nothing about the Hermes-shaped environment.
    jest.resetModules();
    require('../../src/i18n/intlPolyfills');
    ({ selectPluralCategory } = require('../../src/i18n/pluralCategory'));
  });

  afterAll(() => {
    const intl = Intl as IntlWithOptionalCtors;
    if (originalPluralRules) intl.PluralRules = originalPluralRules;
    else delete intl.PluralRules;
    if (originalLocale) intl.Locale = originalLocale;
    else delete intl.Locale;
    if (originalGetCanonicalLocales) intl.getCanonicalLocales = originalGetCanonicalLocales;
    else delete intl.getCanonicalLocales;
  });

  it('resolves the polyfill onto the global Intl object', () => {
    expect(typeof Intl.PluralRules).toBe('function');
    expect(typeof Intl.Locale).toBe('function');
    expect(typeof Intl.getCanonicalLocales).toBe('function');
  });

  it("resolves Arabic's full zero/one/two/few/many/other split", () => {
    expect(selectPluralCategory('ar', 0)).toBe('zero');
    expect(selectPluralCategory('ar', 1)).toBe('one');
    expect(selectPluralCategory('ar', 2)).toBe('two');
    expect(selectPluralCategory('ar', 3)).toBe('few');
    expect(selectPluralCategory('ar', 11)).toBe('many');
    expect(selectPluralCategory('ar', 100)).toBe('other');
  });

  it("resolves French's 'one' category for both 0 and 1", () => {
    expect(selectPluralCategory('fr', 0)).toBe('one');
    expect(selectPluralCategory('fr', 1)).toBe('one');
  });

  it("resolves Japanese to 'other' for every count (no plural distinction)", () => {
    expect(selectPluralCategory('ja', 0)).toBe('other');
    expect(selectPluralCategory('ja', 1)).toBe('other');
    expect(selectPluralCategory('ja', 2)).toBe('other');
    expect(selectPluralCategory('ja', 100)).toBe('other');
  });

  it("resolves English's binary one/other split", () => {
    expect(selectPluralCategory('en', 1)).toBe('one');
    expect(selectPluralCategory('en', 0)).toBe('other');
    expect(selectPluralCategory('en', 2)).toBe('other');
  });
});
