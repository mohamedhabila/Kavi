#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const vm = require('vm');

let ts;
try {
  ts = require('typescript');
} catch (error) {
  console.error('[check-i18n-consistency] Missing dependency: typescript');
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

const projectRoot = path.resolve(__dirname, '..');
const moduleCache = new Map();
const localeDir = path.join(projectRoot, 'src', 'i18n', 'locales');
const registryPath = path.join(projectRoot, 'src', 'i18n', 'registry.ts');
const localeBcp47Path = path.join(projectRoot, 'src', 'i18n', 'localeBcp47.ts');

const PLURAL_CATEGORIES = ['zero', 'one', 'two', 'few', 'many', 'other'];

function resolveLocalModule(fromFile, request) {
  const basePath = path.resolve(path.dirname(fromFile), request);
  const candidates = [
    basePath,
    `${basePath}.ts`,
    `${basePath}.js`,
    path.join(basePath, 'index.ts'),
  ];
  const resolved = candidates.find(
    (candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile(),
  );

  if (!resolved) {
    throw new Error(`Unable to resolve ${request} from ${fromFile}`);
  }

  return resolved;
}

function loadTypeScriptModule(filePath) {
  const resolvedPath = path.resolve(filePath);
  const cached = moduleCache.get(resolvedPath);
  if (cached) return cached.exports;

  const sourceText = fs.readFileSync(resolvedPath, 'utf8');
  const module = { exports: {} };
  moduleCache.set(resolvedPath, module);

  const outputText = ts.transpileModule(sourceText, {
    compilerOptions: {
      esModuleInterop: true,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
    fileName: resolvedPath,
  }).outputText;

  const localRequire = (request) => {
    if (request.startsWith('.')) {
      return loadTypeScriptModule(resolveLocalModule(resolvedPath, request));
    }
    return require(request);
  };

  vm.runInNewContext(
    outputText,
    {
      __dirname: path.dirname(resolvedPath),
      __filename: resolvedPath,
      exports: module.exports,
      module,
      require: localRequire,
    },
    { filename: resolvedPath },
  );

  return module.exports;
}

function exportNameForLocale(locale) {
  return locale.replace(/-([a-z])/gi, (_match, letter) => letter.toUpperCase());
}

function isBranch(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * True when `value` is a resolved `PluralTable` — a plain object whose
 * `other` property is a string and whose every own key is a CLDR plural
 * category. Mirrors `isPluralTable` in `src/i18n/types.ts`; duplicated here
 * (rather than imported) because this script loads locale modules through
 * its own `vm` sandbox, not the app's module graph.
 */
function isPluralTable(value) {
  if (!isBranch(value)) return false;
  if (typeof value.other !== 'string') return false;
  return Object.keys(value).every((key) => PLURAL_CATEGORIES.includes(key));
}

function flattenTranslations(value, prefix = '') {
  const entries = new Map();

  for (const [key, childValue] of Object.entries(value)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (isPluralTable(childValue)) {
      entries.set(fullKey, { type: 'plural', categories: { ...childValue } });
      continue;
    }
    if (isBranch(childValue)) {
      entries.set(fullKey, { type: 'branch' });
      for (const [childKey, childEntry] of flattenTranslations(childValue, fullKey)) {
        entries.set(childKey, childEntry);
      }
      continue;
    }
    entries.set(fullKey, { type: typeof childValue, value: childValue });
  }

  return entries;
}

function propertyNameText(name) {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) {
    return name.text;
  }
  return undefined;
}

/** Parses a `plural({ one: '...', other: '...' })` call's argument into a plain category map. */
function pluralCallToCategories(callNode, filePath, pathSegments) {
  const arg = callNode.arguments[0];
  if (!arg || !ts.isObjectLiteralExpression(arg)) {
    throw new Error(`${filePath}: plural() at ${pathSegments.join('.')} must take an object literal`);
  }
  const categories = {};
  for (const property of arg.properties) {
    if (!ts.isPropertyAssignment(property)) {
      throw new Error(`${filePath}: unsupported plural() property at ${pathSegments.join('.')}`);
    }
    const categoryName = propertyNameText(property.name);
    if (!categoryName) {
      throw new Error(`${filePath}: unsupported plural() category at ${pathSegments.join('.')}`);
    }
    const initializer = property.initializer;
    if (!ts.isStringLiteral(initializer) && !ts.isNoSubstitutionTemplateLiteral(initializer)) {
      throw new Error(
        `${filePath}: plural() category "${categoryName}" at ${pathSegments.join('.')} must be a string literal`,
      );
    }
    categories[categoryName] = initializer.text;
  }
  return categories;
}

function objectLiteralToTranslationMap(node, filePath, pathSegments = []) {
  const value = {};

  for (const property of node.properties) {
    if (!ts.isPropertyAssignment(property)) {
      throw new Error(
        `${filePath}: unsupported translation property at ${pathSegments.join('.') || '<root>'}`,
      );
    }

    const key = propertyNameText(property.name);
    if (!key) {
      throw new Error(
        `${filePath}: unsupported translation key at ${pathSegments.join('.') || '<root>'}`,
      );
    }

    const initializer = property.initializer;
    const nextPath = [...pathSegments, key];

    if (
      ts.isCallExpression(initializer) &&
      ts.isIdentifier(initializer.expression) &&
      initializer.expression.text === 'plural'
    ) {
      value[key] = { __pluralCategories: pluralCallToCategories(initializer, filePath, nextPath) };
      continue;
    }

    if (ts.isObjectLiteralExpression(initializer)) {
      value[key] = objectLiteralToTranslationMap(initializer, filePath, nextPath);
      continue;
    }

    if (ts.isStringLiteral(initializer) || ts.isNoSubstitutionTemplateLiteral(initializer)) {
      value[key] = initializer.text;
      continue;
    }

    throw new Error(`${filePath}: unsupported translation value at ${nextPath.join('.')}`);
  }

  return value;
}

/** Flattens the statically-parsed override tree, treating a `{ __pluralCategories }` marker as one leaf. */
function flattenStaticOverrides(value, prefix = '') {
  const entries = new Map();

  for (const [key, childValue] of Object.entries(value)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (isBranch(childValue) && childValue.__pluralCategories) {
      entries.set(fullKey, { type: 'plural', categories: childValue.__pluralCategories });
      continue;
    }
    if (isBranch(childValue)) {
      entries.set(fullKey, { type: 'branch' });
      for (const [childKey, childEntry] of flattenStaticOverrides(childValue, fullKey)) {
        entries.set(childKey, childEntry);
      }
      continue;
    }
    entries.set(fullKey, { type: typeof childValue, value: childValue });
  }

  return entries;
}

function extractRawLocaleOverrides(locale, filePath) {
  const sourceText = fs.readFileSync(filePath, 'utf8');
  const sourceFile = ts.createSourceFile(
    filePath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  let overrideObject;

  const visit = (node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'mergeTranslations' &&
      node.arguments.length >= 2 &&
      ts.isObjectLiteralExpression(node.arguments[1])
    ) {
      overrideObject = node.arguments[1];
      return;
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);

  if (!overrideObject) {
    throw new Error(
      `${filePath}: unable to locate mergeTranslations(en, { ... }) overrides for ${locale}.`,
    );
  }

  return objectLiteralToTranslationMap(overrideObject, filePath);
}

function placeholdersFor(value) {
  if (typeof value !== 'string') return [];

  const placeholders = new Set();
  const placeholderPattern = /\{([A-Za-z][A-Za-z0-9_]*)\}/g;
  let match;
  while ((match = placeholderPattern.exec(value)) !== null) {
    placeholders.add(match[1]);
  }

  return [...placeholders].sort();
}

function sameValues(first, second) {
  return first.length === second.length && first.every((value, index) => value === second[index]);
}

function describeList(values) {
  return values.length > 0 ? values.join(', ') : 'none';
}

/** The CLDR plural categories `locale` actually uses (always includes 'other'). */
function requiredPluralCategories(locale, localeBcp47Tags) {
  const tag = localeBcp47Tags[locale] || locale;
  return new Set(new Intl.PluralRules(tag).resolvedOptions().pluralCategories);
}

function comparePluralEntry(key, baseValue, localeValue, locale, localeBcp47Tags, report) {
  const required = requiredPluralCategories(locale, localeBcp47Tags);
  const actual = new Set(Object.keys(localeValue.categories));

  const missingCategories = [...required].filter((category) => !actual.has(category));
  const extraCategories = [...actual].filter((category) => !required.has(category));

  if (missingCategories.length > 0 || extraCategories.length > 0) {
    report.pluralCategories.push(
      `${key} requires {${describeList([...required].sort())}} for ${locale}` +
        (missingCategories.length > 0 ? `; missing {${describeList(missingCategories)}}` : '') +
        (extraCategories.length > 0 ? `; unexpected {${describeList(extraCategories)}}` : ''),
    );
  }

  // Placeholder parity. `count` itself is allowed to vary per category — a
  // `one`/`zero`/`two` form is allowed to spell the count out in words
  // instead of interpolating it (`'أداة واحدة'`, not `'{count} أداة'`; the
  // English `'1 tool'` does the same, hardcoding the numeral) — that is
  // standard CLDR-authoring practice, not a bug. But `other` covers an
  // unbounded value, so it must keep `count`; and every *other*
  // interpolation placeholder the base's `other` form uses (e.g.
  // `{iteration}` alongside `{count}`) is structural, not
  // grammar-dependent, and must appear in every category.
  const baseOtherPlaceholders = placeholdersFor(baseValue.categories.other);
  const baseRequiresCount = baseOtherPlaceholders.includes('count');
  const structuralPlaceholders = baseOtherPlaceholders.filter((name) => name !== 'count');

  const localeOtherPlaceholders = placeholdersFor(localeValue.categories.other);
  if (baseRequiresCount && !localeOtherPlaceholders.includes('count')) {
    report.placeholders.push(`${key}#other must interpolate {count}, got {${describeList(localeOtherPlaceholders)}}`);
  }

  for (const [category, text] of Object.entries(localeValue.categories)) {
    const categoryPlaceholders = placeholdersFor(text);
    const missingStructural = structuralPlaceholders.filter(
      (name) => !categoryPlaceholders.includes(name),
    );
    const unexpectedExtra = categoryPlaceholders.filter(
      (name) => name !== 'count' && !structuralPlaceholders.includes(name),
    );
    if (missingStructural.length > 0 || unexpectedExtra.length > 0) {
      report.placeholders.push(
        `${key}#${category} expected structural {${describeList(structuralPlaceholders)}} got {${describeList(categoryPlaceholders.filter((name) => name !== 'count'))}}`,
      );
    }
  }
}

function compareLocale(locale, baseEntries, localeEntries, localeBcp47Tags) {
  const report = { locale, missing: [], extra: [], shape: [], placeholders: [], pluralCategories: [] };

  for (const [key, baseValue] of baseEntries) {
    if (!localeEntries.has(key)) {
      if (baseValue.type === 'string' || baseValue.type === 'plural') report.missing.push(key);
      continue;
    }

    const localeValue = localeEntries.get(key);
    const baseKind = baseValue.type === 'branch' ? 'branch' : baseValue.type === 'plural' ? 'plural' : 'string';
    const localeKind =
      localeValue.type === 'branch' ? 'branch' : localeValue.type === 'plural' ? 'plural' : 'string';

    if (baseKind !== localeKind) {
      report.shape.push(`${key} expected ${baseKind}, got ${localeKind}`);
      continue;
    }

    if (baseKind === 'plural') {
      comparePluralEntry(key, baseValue, localeValue, locale, localeBcp47Tags, report);
      continue;
    }

    if (baseKind === 'string') {
      if (localeValue.type !== 'string') {
        report.shape.push(`${key} expected string, got ${localeValue.type}`);
        continue;
      }
      const expected = placeholdersFor(baseValue.value);
      const actual = placeholdersFor(localeValue.value);
      if (!sameValues(expected, actual)) {
        report.placeholders.push(
          `${key} expected {${describeList(expected)}} got {${describeList(actual)}}`,
        );
      }
    }
  }

  for (const key of localeEntries.keys()) {
    const entry = localeEntries.get(key);
    if (!baseEntries.has(key) && (entry.type === 'string' || entry.type === 'plural')) {
      report.extra.push(key);
    }
  }

  return report;
}

// ---------------------------------------------------------------------------
// Task C — identical-to-English lint
// ---------------------------------------------------------------------------
// Flags a non-English locale's leaf string (flat, or one category inside a
// plural table) that is byte-for-byte identical to the English value. A
// handful of keys are legitimately identical in every language — a brand
// name, a protocol acronym, a format string that is pure placeholders — and
// those are named explicitly below rather than guessed at with a pattern,
// per the project's "no heuristics over natural-language text" rule: this
// is an explicit allowlist of *keys*, not a rule that inspects the string's
// language.

// See scripts/i18nConsistencyAllowlist.js for the allowlist data itself
// (split out purely to stay under this repo's per-file line budget).
const {
  GLOBAL_IDENTICAL_ALLOWLIST,
  PER_LOCALE_COGNATE_VALUES,
  PLACEHOLDER_EXAMPLE_ALLOWLIST,
  TECHNICAL_NAMESPACE_PREFIXES,
  PER_LOCALE_IDENTICAL_ALLOWLIST,
} = require('./i18nConsistencyAllowlist');

function isAllowlisted(key, locale, value) {
  if (GLOBAL_IDENTICAL_ALLOWLIST.has(key)) return true;
  if (PLACEHOLDER_EXAMPLE_ALLOWLIST.has(key)) return true;
  if (PER_LOCALE_IDENTICAL_ALLOWLIST[locale]?.has(key)) return true;
  if (PER_LOCALE_COGNATE_VALUES[locale]?.has(value)) return true;
  return TECHNICAL_NAMESPACE_PREFIXES.some((prefix) => key.startsWith(prefix));
}

/** Flattens a fully-resolved (already-merged) locale module into leaf strings, splitting plural tables per category. */
function collectLeafStrings(value, prefix = '') {
  const leaves = [];
  for (const [key, childValue] of Object.entries(value)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (isPluralTable(childValue)) {
      for (const [category, text] of Object.entries(childValue)) {
        leaves.push({ key: fullKey, reportKey: `${fullKey}#${category}`, value: text });
      }
      continue;
    }
    if (isBranch(childValue)) {
      leaves.push(...collectLeafStrings(childValue, fullKey));
      continue;
    }
    if (typeof childValue === 'string') {
      leaves.push({ key: fullKey, reportKey: fullKey, value: childValue });
    }
  }
  return leaves;
}

function findIdenticalToEnglish(locale, englishLeavesByKey, localeModule) {
  const localeLeaves = collectLeafStrings(localeModule);
  const identical = [];
  for (const leaf of localeLeaves) {
    if (isAllowlisted(leaf.key, locale, leaf.value)) continue;
    const englishValue = englishLeavesByKey.get(leaf.reportKey);
    if (englishValue === undefined) continue; // covered by missing/extra-key checks instead
    if (englishValue === leaf.value && leaf.value.trim() !== '') {
      identical.push(leaf.reportKey);
    }
  }
  return identical.sort();
}

function printIssues(title, issues) {
  if (issues.length === 0) return;
  console.error(`  ${title} (${issues.length}):`);
  for (const issue of issues.slice(0, 80)) {
    console.error(`    - ${issue}`);
  }
  if (issues.length > 80) {
    console.error(`    ...and ${issues.length - 80} more`);
  }
}

function main() {
  const registry = loadTypeScriptModule(registryPath);
  const supportedLocales = registry.SUPPORTED_LOCALES;
  const localeBcp47 = loadTypeScriptModule(localeBcp47Path);
  const localeBcp47Tags = localeBcp47.LOCALE_BCP47_TAGS || {};

  if (!Array.isArray(supportedLocales) || supportedLocales[0] !== 'en') {
    throw new Error('SUPPORTED_LOCALES must be an array with en as the baseline locale.');
  }

  const englishModule = loadTypeScriptModule(path.join(localeDir, 'en.ts'));
  const englishTranslations = englishModule.en;
  const baseEntries = flattenTranslations(englishTranslations);
  const englishLeavesByKey = new Map(
    collectLeafStrings(englishTranslations).map((leaf) => [leaf.reportKey, leaf.value]),
  );
  const reports = [];
  const identicalReports = [];

  for (const locale of supportedLocales.filter((entry) => entry !== 'en')) {
    const localePath = path.join(localeDir, `${locale}.ts`);
    const exportName = exportNameForLocale(locale);
    const localeModule = loadTypeScriptModule(localePath);
    if (!isBranch(localeModule[exportName])) {
      throw new Error(`${localePath} does not export ${exportName} as a translation map.`);
    }

    reports.push(
      compareLocale(
        locale,
        baseEntries,
        flattenStaticOverrides(extractRawLocaleOverrides(locale, localePath)),
        localeBcp47Tags,
      ),
    );

    const identical = findIdenticalToEnglish(locale, englishLeavesByKey, localeModule[exportName]);
    if (identical.length > 0) {
      identicalReports.push({ locale, identical });
    }
  }

  const failedReports = reports.filter(
    (report) =>
      report.missing.length > 0 ||
      report.extra.length > 0 ||
      report.shape.length > 0 ||
      report.placeholders.length > 0 ||
      report.pluralCategories.length > 0,
  );

  let ok = true;

  if (failedReports.length === 0) {
    console.log(
      `[check-i18n-consistency] ${supportedLocales.length} locales match ${baseEntries.size} English key entries without fallback gaps.`,
    );
  } else {
    ok = false;
    console.error(
      `[check-i18n-consistency] Found inconsistencies in ${failedReports.length} locale(s).`,
    );
    for (const report of failedReports) {
      console.error(`\n${report.locale}:`);
      printIssues('missing keys', report.missing);
      printIssues('extra keys', report.extra);
      printIssues('shape mismatches', report.shape);
      printIssues('placeholder mismatches', report.placeholders);
      printIssues('plural category mismatches', report.pluralCategories);
    }
  }

  if (identicalReports.length > 0) {
    ok = false;
    console.error(
      `\n[check-i18n-consistency] Found untranslated (identical-to-English) strings in ${identicalReports.length} locale(s).`,
    );
    for (const report of identicalReports) {
      console.error(`\n${report.locale}:`);
      printIssues('identical to English', report.identical);
    }
  } else {
    console.log(
      '[check-i18n-consistency] No untranslated (identical-to-English) strings outside the allowlist.',
    );
  }

  process.exitCode = ok ? 0 : 1;
}

if (require.main === module) {
  main();
}

module.exports = {
  compareLocale,
  comparePluralEntry,
  isAllowlisted,
  findIdenticalToEnglish,
  flattenTranslations,
  flattenStaticOverrides,
  isPluralTable,
  placeholdersFor,
};
