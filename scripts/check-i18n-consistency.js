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

function flattenTranslations(value, prefix = '') {
  const entries = new Map();

  for (const [key, childValue] of Object.entries(value)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
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

function compareLocale(locale, baseEntries, localeEntries) {
  const missing = [];
  const extra = [];
  const shape = [];
  const placeholders = [];

  for (const [key, baseValue] of baseEntries) {
    if (!localeEntries.has(key)) {
      if (baseValue.type === 'string') missing.push(key);
      continue;
    }

    const localeValue = localeEntries.get(key);
    const baseIsBranch = baseValue.type === 'branch';
    const localeIsBranch = localeValue.type === 'branch';

    if (baseIsBranch !== localeIsBranch) {
      shape.push(`${key} expected ${baseValue.type}, got ${localeValue.type}`);
      continue;
    }

    if (!baseIsBranch) {
      if (baseValue.type !== 'string' || localeValue.type !== 'string') {
        shape.push(`${key} expected ${baseValue.type}, got ${localeValue.type}`);
        continue;
      }

      const expected = placeholdersFor(baseValue.value);
      const actual = placeholdersFor(localeValue.value);
      if (!sameValues(expected, actual)) {
        placeholders.push(
          `${key} expected {${describeList(expected)}} got {${describeList(actual)}}`,
        );
      }
    }
  }

  for (const key of localeEntries.keys()) {
    if (!baseEntries.has(key) && localeEntries.get(key).type === 'string') {
      extra.push(key);
    }
  }

  return { locale, missing, extra, shape, placeholders };
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

  if (!Array.isArray(supportedLocales) || supportedLocales[0] !== 'en') {
    throw new Error('SUPPORTED_LOCALES must be an array with en as the baseline locale.');
  }

  const englishModule = loadTypeScriptModule(path.join(localeDir, 'en.ts'));
  const englishTranslations = englishModule.en;
  const baseEntries = flattenTranslations(englishTranslations);
  const reports = [];

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
        flattenTranslations(extractRawLocaleOverrides(locale, localePath)),
      ),
    );
  }

  const failedReports = reports.filter(
    (report) =>
      report.missing.length > 0 ||
      report.extra.length > 0 ||
      report.shape.length > 0 ||
      report.placeholders.length > 0,
  );

  if (failedReports.length === 0) {
    console.log(
      `[check-i18n-consistency] ${supportedLocales.length} locales match ${baseEntries.size} English key entries without fallback gaps.`,
    );
    return;
  }

  console.error(
    `[check-i18n-consistency] Found inconsistencies in ${failedReports.length} locale(s).`,
  );
  for (const report of failedReports) {
    console.error(`\n${report.locale}:`);
    printIssues('missing keys', report.missing);
    printIssues('extra keys', report.extra);
    printIssues('shape mismatches', report.shape);
    printIssues('placeholder mismatches', report.placeholders);
  }

  process.exitCode = 1;
}

main();
