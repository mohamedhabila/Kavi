#!/usr/bin/env node

const path = require('path');

const {
  formatNativeAccessibilityIssues,
  scanNativeAccessibilityDirectory,
} = require('./lib/nativeAccessibilityCheck');

const repositoryRoot = path.resolve(__dirname, '..');
const result = scanNativeAccessibilityDirectory(path.join(repositoryRoot, 'src'));

if (result.issues.length > 0) {
  console.error(
    '[check-native-accessibility] Native controls need explicit accessibility semantics:',
  );
  for (const issue of formatNativeAccessibilityIssues(result.issues, repositoryRoot)) {
    console.error(`- ${issue}`);
  }
  process.exitCode = 1;
} else {
  console.log(
    `[check-native-accessibility] ${result.controlsScanned} native controls across ${result.filesScanned} TSX files have explicit accessibility semantics.`,
  );
}
