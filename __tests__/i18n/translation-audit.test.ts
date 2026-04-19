import fs from 'node:fs';
import path from 'node:path';

import ts from 'typescript';

import { en } from '../../src/i18n/locales/en';

const ROOT = process.cwd();
const SOURCE_ROOT = path.join(ROOT, 'src');
const UI_ROOTS = [path.join(SOURCE_ROOT, 'screens'), path.join(SOURCE_ROOT, 'components')];
const TRANSLATION_KEY_CARRIER_NAMES = new Set([
  'labelKey',
  'titleKey',
  'hintKey',
  'summaryKey',
  'descriptionKey',
]);
const UI_PROP_NAMES = new Set([
  'accessibilityLabel',
  'accessibilityHint',
  'placeholder',
  'title',
  'label',
  'subtitle',
]);
const REPORTABLE_SINGLE_WORD_UI_STRINGS = new Set([
  'Authenticate',
  'Back',
  'Cancel',
  'Close',
  'Connect',
  'Continue',
  'Copy',
  'Delete',
  'Disconnect',
  'Done',
  'Edit',
  'Error',
  'File',
  'Files',
  'Image',
  'Install',
  'Loading',
  'Open',
  'Refresh',
  'Retry',
  'Save',
  'Search',
  'Share',
  'Terminal',
  'View',
]);
const ALLOWED_UNUSED_PREFIXES = [
  'agentRoster.',
  'languages.',
  'linkUnderstanding.',
  'mediaUnderstanding.',
  'model.',
  'onboarding.step',
];

function namespacedKeys(namespace: string, keys: string[]): string[] {
  return keys.map((key) => `${namespace}.${key}`);
}

const ALLOWED_UNUSED_KEYS = new Set([
  ...namespacedKeys('canvas', ['webviewNotMounted']),
  ...namespacedKeys('chat', [
    'deleteConversation',
    'loopDetected',
    'maxIterations',
    'newConversation',
    'requestCancelled',
    'searchConversations',
    'title',
    'toolCall',
  ]),
  ...namespacedKeys('common', [
    'copy',
    'disabled',
    'done',
    'loading',
    'off',
    'ok',
    'on',
    'version',
  ]),
  ...namespacedKeys('gateway', ['authenticating', 'listNodes', 'pairingCode']),
  ...namespacedKeys('mcpStatus', ['connected', 'connecting', 'disconnected', 'error']),
  ...namespacedKeys('nav', ['chat']),
  ...namespacedKeys('onboarding', ['customProvider', 'enterApiKey', 'serviceIntro']),
  ...namespacedKeys('remoteWork', [
    'activeCount',
    'activeJobsStat',
    'configStudioHint',
    'configStudioTitle',
    'jobStatusWaitingApproval',
    'readyCount',
    'runCommand',
    'shellCommandPlaceholder',
    'workspaceManageFromHub',
  ]),
  ...namespacedKeys('scheduler', [
    'cronExpression',
    'disabled',
    'enabled',
    'intervalMinutes',
    'intervalPlaceholder',
    'lastRun',
    'nextRun',
    'prompt',
    'schedule',
    'scheduleType',
    'taskCreated',
    'taskName',
  ]),
  ...namespacedKeys('skills', [
    'createCustom',
    'description',
    'disable',
    'enable',
    'featured',
    'skillName',
    'uninstall',
  ]),
  ...namespacedKeys('voice', ['responsePlaceholder', 'stopListening', 'transcriptPlaceholder']),
]);

const DYNAMIC_KEY_PREFIXES = [
  'chat.agentWorkflow.checkpointKind.',
  'chat.agentWorkflow.confidence.',
  'chat.agentWorkflow.controlAction.',
  'chat.agentWorkflow.phase.',
  'chat.agentWorkflow.status.',
  'onboarding.webProviders.',
  'settings.thinkingOptions.',
  'settings.toolGroups.',
  'toolCall.status.',
  'toolCall.tools.',
];
const DYNAMIC_KEYS = new Set([
  'scheduler.days',
  'scheduler.hours',
  'scheduler.minutes',
  'settings.serverTransportAuto',
  'settings.serverTransportHttp',
  'settings.serverTransportSse',
]);

const flattenedEnglishKeys = flattenTranslationMap(en);
const englishKeySet = new Set(flattenedEnglishKeys);
const topLevelNamespaces = new Set(Object.keys(en));

function flattenTranslationMap(value: Record<string, unknown>, prefix = ''): string[] {
  const keys: string[] = [];

  for (const [entryKey, entryValue] of Object.entries(value)) {
    const fullKey = prefix ? `${prefix}.${entryKey}` : entryKey;
    if (entryValue && typeof entryValue === 'object' && !Array.isArray(entryValue)) {
      keys.push(...flattenTranslationMap(entryValue as Record<string, unknown>, fullKey));
      continue;
    }
    keys.push(fullKey);
  }

  return keys.sort();
}

function listSourceFiles(rootDir: string): string[] {
  const files: string[] = [];

  const visit = (dirPath: string) => {
    for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
      const fullPath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        if (fullPath === path.join(SOURCE_ROOT, 'i18n', 'locales')) {
          continue;
        }
        visit(fullPath);
        continue;
      }

      if (/\.(ts|tsx)$/.test(entry.name)) {
        files.push(fullPath);
      }
    }
  };

  visit(rootDir);
  return files.sort();
}

function createSourceFile(filePath: string): ts.SourceFile {
  const sourceText = fs.readFileSync(filePath, 'utf8');
  const scriptKind = filePath.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  return ts.createSourceFile(filePath, sourceText, ts.ScriptTarget.Latest, true, scriptKind);
}

function isTranslationCall(node: ts.CallExpression, sourceFile: ts.SourceFile): boolean {
  if (ts.isIdentifier(node.expression)) {
    return ['t', 'translateOrFallback', 'translateWithFallback', 'pushDetail'].includes(
      node.expression.text,
    );
  }

  return (
    ts.isPropertyAccessExpression(node.expression) &&
    node.expression.expression.getText(sourceFile) === 'i18n' &&
    node.expression.name.text === 't'
  );
}

function addDynamicFamilies(target: Set<string>) {
  for (const prefix of DYNAMIC_KEY_PREFIXES) {
    for (const key of flattenedEnglishKeys) {
      if (key.startsWith(prefix)) {
        target.add(key);
      }
    }
  }

  for (const key of DYNAMIC_KEYS) {
    target.add(key);
  }
}

function collectUsedTranslationKeys(): Set<string> {
  const usedKeys = new Set<string>();

  for (const filePath of listSourceFiles(SOURCE_ROOT)) {
    const sourceFile = createSourceFile(filePath);

    const visit = (node: ts.Node) => {
      if (ts.isCallExpression(node) && isTranslationCall(node, sourceFile)) {
        const firstArg = node.arguments[0];
        if (
          firstArg &&
          (ts.isStringLiteral(firstArg) || ts.isNoSubstitutionTemplateLiteral(firstArg))
        ) {
          usedKeys.add(firstArg.text);
        }
      }

      if (
        ts.isPropertyAssignment(node) &&
        (ts.isIdentifier(node.name) || ts.isStringLiteral(node.name)) &&
        TRANSLATION_KEY_CARRIER_NAMES.has(node.name.text) &&
        (ts.isStringLiteral(node.initializer) ||
          ts.isNoSubstitutionTemplateLiteral(node.initializer))
      ) {
        usedKeys.add(node.initializer.text);
      }

      if (ts.isStringLiteralLike(node) && englishKeySet.has(node.text)) {
        usedKeys.add(node.text);
      }

      ts.forEachChild(node, visit);
    };

    visit(sourceFile);
  }

  addDynamicFamilies(usedKeys);
  return usedKeys;
}

function isAllowedUnusedKey(key: string): boolean {
  return (
    ALLOWED_UNUSED_KEYS.has(key) || ALLOWED_UNUSED_PREFIXES.some((prefix) => key.startsWith(prefix))
  );
}

function isTranslationKeyLiteral(value: string): boolean {
  const [namespace] = value.split('.');
  return topLevelNamespaces.has(namespace);
}

function isHardcodedUiCandidate(value: string): boolean {
  const text = value.replace(/\s+/g, ' ').trim();
  if (!text || !/[A-Za-z]/.test(text)) {
    return false;
  }
  if (isTranslationKeyLiteral(text)) {
    return false;
  }
  if (/^(https?:|file:|sk-|bb_project_|gpt-|eas_)/i.test(text)) {
    return false;
  }
  if (/^(console\.log\(\)|ls -la)$/i.test(text)) {
    return false;
  }
  return /\s/.test(text) || REPORTABLE_SINGLE_WORD_UI_STRINGS.has(text);
}

function getLineNumber(sourceFile: ts.SourceFile, position: number): number {
  return sourceFile.getLineAndCharacterOfPosition(position).line + 1;
}
function isAlertCall(node: ts.CallExpression, sourceFile: ts.SourceFile): boolean {
  return (
    ts.isPropertyAccessExpression(node.expression) &&
    node.expression.expression.getText(sourceFile) === 'Alert' &&
    node.expression.name.text === 'alert'
  );
}

function collectHardcodedUiStrings(): string[] {
  const findings: string[] = [];

  for (const rootDir of UI_ROOTS) {
    for (const filePath of listSourceFiles(rootDir)) {
      const sourceFile = createSourceFile(filePath);

      const visit = (node: ts.Node, ancestors: ts.Node[]) => {
        if (ts.isJsxText(node)) {
          const text = node.getText(sourceFile).replace(/\s+/g, ' ').trim();
          if (isHardcodedUiCandidate(text)) {
            findings.push(
              `${path.relative(ROOT, filePath)}:${getLineNumber(sourceFile, node.getStart(sourceFile))} JSXText ${JSON.stringify(text)}`,
            );
          }
        }

        if (ts.isStringLiteralLike(node)) {
          const text = node.text;

          const parent = ancestors[ancestors.length - 1];
          if (
            parent &&
            ts.isJsxAttribute(parent) &&
            UI_PROP_NAMES.has(parent.name.text) &&
            isHardcodedUiCandidate(text)
          ) {
            findings.push(
              `${path.relative(ROOT, filePath)}:${getLineNumber(sourceFile, node.getStart(sourceFile))} JSXAttribute ${parent.name.text}=${JSON.stringify(text)}`,
            );
          }

          if (
            parent &&
            ts.isPropertyAssignment(parent) &&
            ts.isIdentifier(parent.name) &&
            parent.name.text === 'text' &&
            ancestors.some(
              (ancestor) => ts.isCallExpression(ancestor) && isAlertCall(ancestor, sourceFile),
            ) &&
            isHardcodedUiCandidate(text)
          ) {
            findings.push(
              `${path.relative(ROOT, filePath)}:${getLineNumber(sourceFile, node.getStart(sourceFile))} Alert action ${JSON.stringify(text)}`,
            );
          }
        }

        if (ts.isCallExpression(node) && isAlertCall(node, sourceFile)) {
          for (const arg of node.arguments.slice(0, 2)) {
            if (
              (ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg)) &&
              isHardcodedUiCandidate(arg.text)
            ) {
              findings.push(
                `${path.relative(ROOT, filePath)}:${getLineNumber(sourceFile, arg.getStart(sourceFile))} Alert ${JSON.stringify(arg.text)}`,
              );
            }
          }
        }

        ts.forEachChild(node, (child) => visit(child, [...ancestors, node]));
      };

      visit(sourceFile, []);
    }
  }

  return findings.sort();
}

describe('Translation audit', () => {
  it('keeps every referenced translation key defined in English', () => {
    const usedKeys = collectUsedTranslationKeys();
    const missingKeys = [...usedKeys].filter((key) => !englishKeySet.has(key)).sort();
    expect(missingKeys).toEqual([]);
  });

  it('does not accumulate untranslated stale English keys outside the reserved set', () => {
    const usedKeys = collectUsedTranslationKeys();
    const unusedKeys = flattenedEnglishKeys.filter(
      (key) => !usedKeys.has(key) && !isAllowedUnusedKey(key),
    );
    expect(unusedKeys).toEqual([]);
  });

  it('rejects new hardcoded English UI strings in screens and components', () => {
    expect(collectHardcodedUiStrings()).toEqual([]);
  });
});
