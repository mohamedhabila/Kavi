const fs = require('fs');
const path = require('path');
const ts = require('typescript');

const COMPONENT_REQUIREMENTS = new Map([
  ['TouchableOpacity', ['accessibilityRole', 'accessibilityLabel']],
  ['Pressable', ['accessibilityRole', 'accessibilityLabel']],
  ['TouchableWithoutFeedback', ['accessibilityRole', 'accessibilityLabel']],
  ['TextInput', ['accessibilityLabel']],
  ['Switch', ['accessibilityLabel']],
]);

const DECORATIVE_OPT_OUT_COMPONENTS = new Set([
  'TouchableOpacity',
  'Pressable',
  'TouchableWithoutFeedback',
]);

function listTsxFiles(rootDir) {
  const files = [];

  function visit(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const filePath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        visit(filePath);
      } else if (entry.isFile() && filePath.endsWith('.tsx')) {
        files.push(filePath);
      }
    }
  }

  visit(rootDir);
  return files.sort();
}

function getReactNativeAliases(sourceFile) {
  const aliases = new Map();
  const namespaces = new Set();

  for (const statement of sourceFile.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteral(statement.moduleSpecifier) ||
      statement.moduleSpecifier.text !== 'react-native'
    ) {
      continue;
    }

    const bindings = statement.importClause?.namedBindings;
    if (bindings && ts.isNamedImports(bindings)) {
      for (const binding of bindings.elements) {
        const importedName = (binding.propertyName || binding.name).text;
        if (COMPONENT_REQUIREMENTS.has(importedName)) {
          aliases.set(binding.name.text, importedName);
        }
      }
    } else if (bindings && ts.isNamespaceImport(bindings)) {
      namespaces.add(bindings.name.text);
    }
  }

  return { aliases, namespaces };
}

function resolveComponentName(tagName, sourceFile, aliases, namespaces) {
  if (ts.isIdentifier(tagName)) {
    const localName = tagName.text;
    return aliases.get(localName) || (COMPONENT_REQUIREMENTS.has(localName) ? localName : null);
  }

  if (ts.isPropertyAccessExpression(tagName)) {
    const namespace = tagName.expression.getText(sourceFile);
    const componentName = tagName.name.text;
    if (namespaces.has(namespace) && COMPONENT_REQUIREMENTS.has(componentName)) {
      return componentName;
    }
  }

  return null;
}

function getJsxAttribute(openingElement, name) {
  return openingElement.attributes.properties.find(
    (property) => ts.isJsxAttribute(property) && property.name.getText() === name,
  );
}

function isUsableAttribute(attribute) {
  if (!attribute?.initializer) {
    return false;
  }

  if (ts.isStringLiteral(attribute.initializer)) {
    return attribute.initializer.text.trim().length > 0;
  }

  if (!ts.isJsxExpression(attribute.initializer) || !attribute.initializer.expression) {
    return false;
  }

  const expression = attribute.initializer.expression;
  if (ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression)) {
    return expression.text.trim().length > 0;
  }
  if (
    expression.kind === ts.SyntaxKind.FalseKeyword ||
    expression.kind === ts.SyntaxKind.NullKeyword ||
    (ts.isIdentifier(expression) && expression.text === 'undefined')
  ) {
    return false;
  }

  return true;
}

function isDecorativeOptOut(openingElement, componentName) {
  if (!DECORATIVE_OPT_OUT_COMPONENTS.has(componentName)) {
    return false;
  }

  const accessible = getJsxAttribute(openingElement, 'accessible');
  return Boolean(
    accessible?.initializer &&
    ts.isJsxExpression(accessible.initializer) &&
    accessible.initializer.expression?.kind === ts.SyntaxKind.FalseKeyword,
  );
}

function scanNativeAccessibilitySource(sourceText, filePath = 'fixture.tsx') {
  const sourceFile = ts.createSourceFile(
    filePath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const { aliases, namespaces } = getReactNativeAliases(sourceFile);
  const issues = [];
  let controlsScanned = 0;

  function visit(node) {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const componentName = resolveComponentName(node.tagName, sourceFile, aliases, namespaces);
      if (componentName) {
        controlsScanned += 1;
        if (!isDecorativeOptOut(node, componentName)) {
          const missing = COMPONENT_REQUIREMENTS.get(componentName).filter(
            (attributeName) => !isUsableAttribute(getJsxAttribute(node, attributeName)),
          );
          if (missing.length > 0) {
            const location = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
            issues.push({
              filePath,
              line: location.line + 1,
              column: location.character + 1,
              componentName,
              missing,
            });
          }
        }
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return { issues, controlsScanned };
}

function scanNativeAccessibilityDirectory(rootDir) {
  const files = listTsxFiles(rootDir);
  const issues = [];
  let controlsScanned = 0;

  for (const filePath of files) {
    const result = scanNativeAccessibilitySource(fs.readFileSync(filePath, 'utf8'), filePath);
    issues.push(...result.issues);
    controlsScanned += result.controlsScanned;
  }

  return { issues, controlsScanned, filesScanned: files.length };
}

function formatNativeAccessibilityIssues(issues, baseDir = process.cwd()) {
  return issues.map((issue) => {
    const displayPath = path.relative(baseDir, issue.filePath) || issue.filePath;
    return `${displayPath}:${issue.line}:${issue.column} ${issue.componentName} missing ${issue.missing.join(', ')}`;
  });
}

module.exports = {
  formatNativeAccessibilityIssues,
  scanNativeAccessibilityDirectory,
  scanNativeAccessibilitySource,
};
