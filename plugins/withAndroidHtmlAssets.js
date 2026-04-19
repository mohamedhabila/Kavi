// ---------------------------------------------------------------------------
// Expo Config Plugin — Android HTML Assets for WebView Screens
// ---------------------------------------------------------------------------
// Copies custom HTML files (editor, terminal) into the Android assets
// directory so they are accessible via file:///android_asset/ URIs in
// react-native-webview. Survives `expo prebuild --clean`.

const { withDangerousMod } = require('expo/config-plugins');
const fs = require('fs');
const path = require('path');

function copyDirSync(src, dst) {
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(dst, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const dstPath = path.join(dst, entry.name);
    if (entry.isDirectory()) {
      copyDirSync(srcPath, dstPath);
    } else {
      fs.copyFileSync(srcPath, dstPath);
    }
  }
}

function withAndroidHtmlAssets(config) {
  return withDangerousMod(config, [
    'android',
    (cfg) => {
      const projectRoot = cfg.modRequest.projectRoot;
      const androidAssetsDir = path.join(projectRoot, 'android', 'app', 'src', 'main', 'assets');

      // Copy editor HTML assets
      copyDirSync(
        path.join(projectRoot, 'assets', 'editor'),
        path.join(androidAssetsDir, 'editor'),
      );

      // Copy terminal HTML assets
      copyDirSync(
        path.join(projectRoot, 'assets', 'terminal'),
        path.join(androidAssetsDir, 'terminal'),
      );

      return cfg;
    },
  ]);
}

module.exports = withAndroidHtmlAssets;
