// ---------------------------------------------------------------------------
// Kavi — Intl Polyfill Bootstrap
// ---------------------------------------------------------------------------
// Hermes — the JS engine on both Android and iOS builds of this app —
// implements only a subset of ECMA-402. Per Hermes's own documentation
// (https://github.com/facebook/hermes/blob/main/doc/IntlAPIs.md), it ships
// `Intl.getCanonicalLocales`, `Intl.Collator`, `Intl.DateTimeFormat` and
// `Intl.NumberFormat` on both platforms, but NOT `Intl.PluralRules` or
// `Intl.Locale`. Without `Intl.PluralRules`, `src/i18n/pluralCategory.ts`
// silently falls back to English's binary one/other rule for every locale,
// which is wrong for Arabic's six-way split (zero/one/two/few/many/other)
// and every other CLDR language with non-binary plurals — confirmed on a
// cold-started Android emulator in Arabic, where counts 0, 2 and 5 all
// rendered the `other` form. Jest never caught this because Node ships
// full ICU and a conformant `Intl.PluralRules`.
//
// This module installs the FormatJS polyfills
// (https://formatjs.github.io/docs/polyfills/intl-pluralrules — pinned
// versions in package.json: @formatjs/intl-getcanonicallocales 3.2.11,
// @formatjs/intl-locale 5.3.10, @formatjs/intl-pluralrules 6.3.13) for
// exactly the APIs Hermes is missing, using each package's conditional
// `/polyfill.js` entry point rather than `/polyfill-force.js`:
// `shouldPolyfill()` runs first and skips the install whenever the
// engine's own implementation is already present and spec-conformant, so
// a full-ICU engine — Node under Jest today, and any future Hermes release
// that gains a native `Intl.PluralRules` — keeps its own implementation
// untouched. FormatJS's React Native guide suggests the unconditional
// `-force` variant instead, for a small Android startup win by skipping
// the capability check; that guide also assumes `Intl.PluralRules` is
// always absent on Hermes, which is true today but not a contract this
// bootstrap should hard-code. The conditional check this app uses is a
// handful of property lookups (see each package's `should-polyfill.js`),
// not a meaningful cost, and it means an already-correct native
// implementation is never silently shadowed.
//
// Order matters: `Intl.PluralRules` calls `Intl.getCanonicalLocales`
// internally, and FormatJS's docs list `Intl.getCanonicalLocales` and
// `Intl.Locale` as hard requirements for the `Intl.PluralRules` polyfill
// (https://formatjs.github.io/docs/polyfills/intl-pluralrules#requirements),
// so both must be installed first, in that order.
//
// Per-locale plural-rule data is loaded only for the nine locales this app
// supports (`src/i18n/registry.ts`: en, ar, de, es, fr, ja, pt-BR, zh-CN,
// zh-TW). CLDR plural rules do not vary by region for Portuguese-Brazil or
// either Chinese script, and the package does not ship `pt-BR`,
// `zh-Hans` or `zh-Hant` data files — only base-language ones — so `pt-BR`
// resolves through `locale-data/pt.js` and both `zh-CN` and `zh-TW`
// resolve through `locale-data/zh.js` via FormatJS's own locale-matching
// fallback (the same lookup algorithm `Intl.PluralRules` itself uses).
import '@formatjs/intl-getcanonicallocales/polyfill.js';
import '@formatjs/intl-locale/polyfill.js';
import '@formatjs/intl-pluralrules/polyfill.js';

import '@formatjs/intl-pluralrules/locale-data/en.js';
import '@formatjs/intl-pluralrules/locale-data/ar.js';
import '@formatjs/intl-pluralrules/locale-data/de.js';
import '@formatjs/intl-pluralrules/locale-data/es.js';
import '@formatjs/intl-pluralrules/locale-data/fr.js';
import '@formatjs/intl-pluralrules/locale-data/ja.js';
import '@formatjs/intl-pluralrules/locale-data/pt.js'; // covers 'pt-BR'
import '@formatjs/intl-pluralrules/locale-data/zh.js'; // covers 'zh-CN' and 'zh-TW'
