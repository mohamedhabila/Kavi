// ---------------------------------------------------------------------------
// Tests — i18n Locale Completeness
// ---------------------------------------------------------------------------
// Verifies that all locale files have the same top-level keys as en.ts

import fs from 'node:fs';
import path from 'node:path';

import ts from 'typescript';

import { SUPPORTED_LOCALES } from '../../src/i18n/registry';
import { en } from '../../src/i18n/locales/en';

const localeModules = {
  ar: require('../../src/i18n/locales/ar').ar,
  de: require('../../src/i18n/locales/de').de,
  es: require('../../src/i18n/locales/es').es,
  fr: require('../../src/i18n/locales/fr').fr,
  ja: require('../../src/i18n/locales/ja').ja,
  'pt-BR': require('../../src/i18n/locales/pt-BR').ptBR,
  'zh-CN': require('../../src/i18n/locales/zh-CN').zhCN,
  'zh-TW': require('../../src/i18n/locales/zh-TW').zhTW,
} as const;

type TranslationMap = Record<string, unknown>;

function flattenRuntimeKeys(value: TranslationMap, prefix = ''): string[] {
  const keys: string[] = [];

  for (const [entryKey, entryValue] of Object.entries(value)) {
    const fullKey = prefix ? `${prefix}.${entryKey}` : entryKey;
    if (entryValue && typeof entryValue === 'object' && !Array.isArray(entryValue)) {
      keys.push(...flattenRuntimeKeys(entryValue as TranslationMap, fullKey));
      continue;
    }
    keys.push(fullKey);
  }

  return keys.sort();
}

function flattenObjectLiteralKeys(node: ts.ObjectLiteralExpression, prefix = ''): string[] {
  const keys: string[] = [];

  for (const property of node.properties) {
    if (!ts.isPropertyAssignment(property)) {
      continue;
    }

    const name =
      ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)
        ? property.name.text
        : null;
    if (!name) {
      continue;
    }

    const fullKey = prefix ? `${prefix}.${name}` : name;
    if (ts.isObjectLiteralExpression(property.initializer)) {
      keys.push(...flattenObjectLiteralKeys(property.initializer, fullKey));
      continue;
    }

    keys.push(fullKey);
  }

  return keys.sort();
}

function extractRawOverrideKeys(locale: string): string[] {
  const filePath = path.join(process.cwd(), 'src', 'i18n', 'locales', `${locale}.ts`);
  const sourceText = fs.readFileSync(filePath, 'utf8');
  const sourceFile = ts.createSourceFile(
    filePath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );

  let overrideObject: ts.ObjectLiteralExpression | undefined;

  const visit = (node: ts.Node) => {
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
    throw new Error(`Could not locate mergeTranslations override object for locale ${locale}`);
  }

  return flattenObjectLiteralKeys(overrideObject);
}

describe('Locale completeness', () => {
  const englishKeys = flattenRuntimeKeys(en);
  const englishKeySet = new Set(englishKeys);
  const nonEnglishLocales = SUPPORTED_LOCALES.filter((locale) => locale !== 'en');

  it.each(nonEnglishLocales)('%s exports the same effective key set as en', (locale) => {
    const localeMap = localeModules[locale as keyof typeof localeModules] as TranslationMap;
    expect(flattenRuntimeKeys(localeMap)).toEqual(englishKeys);
  });

  it.each(nonEnglishLocales)('%s does not define stale raw override keys', (locale) => {
    const overrideKeys = extractRawOverrideKeys(locale);
    const staleKeys = overrideKeys.filter((key) => !englishKeySet.has(key));
    expect(staleKeys).toEqual([]);
  });
});
