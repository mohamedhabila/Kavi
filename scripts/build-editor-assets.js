const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');
const runtimeEntryPath = path.join(
  projectRoot,
  'assets',
  'editor',
  'runtime',
  'codemirror-runtime.js',
);
const templatePath = path.join(projectRoot, 'assets', 'editor', 'editor.template.html');
const outputPaths = [
  path.join(projectRoot, 'assets', 'editor', 'editor.html'),
  path.join(projectRoot, 'android', 'app', 'src', 'main', 'assets', 'editor', 'editor.html'),
];
const bundlePlaceholder = '/* __INLINE_CODEMIRROR_BUNDLE__ */';

function escapeForInlineScript(code) {
  return code.replace(/<\/script/gi, '<\\/script').replace(/<!--/g, '<\\!--');
}

function writeIfChanged(targetPath, content) {
  const existingContent = fs.existsSync(targetPath) ? fs.readFileSync(targetPath, 'utf8') : null;
  if (existingContent === content) {
    return false;
  }

  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(targetPath, content, 'utf8');
  return true;
}

async function buildRuntimeBundle() {
  const result = await esbuild.build({
    bundle: true,
    entryPoints: [runtimeEntryPath],
    format: 'iife',
    globalName: '__KaviCodeMirrorBundle',
    minify: true,
    platform: 'browser',
    target: ['es2020'],
    write: false,
  });

  const bundledRuntime = result.outputFiles[0]?.text;
  if (!bundledRuntime) {
    throw new Error('editor-runtime-bundle-missing');
  }

  return [
    bundledRuntime,
    'window.__KAVI_CODEMIRROR__=__KaviCodeMirrorBundle.createCodeMirrorModules();',
    "window.__KAVI_CODEMIRROR_BUILD__='local-bundle';",
  ].join('');
}

async function main() {
  const template = fs.readFileSync(templatePath, 'utf8');
  if (!template.includes(bundlePlaceholder)) {
    throw new Error('editor-template-placeholder-missing');
  }

  const bundleCode = await buildRuntimeBundle();
  const renderedHtml = template.replace(bundlePlaceholder, () => escapeForInlineScript(bundleCode));
  let changedCount = 0;

  for (const outputPath of outputPaths) {
    if (writeIfChanged(outputPath, renderedHtml)) {
      changedCount += 1;
    }
  }

  console.log(`[build-editor-assets] synced ${changedCount} file(s)`);
}

main().catch((error) => {
  const message = error instanceof Error ? error.stack || error.message : String(error);
  console.error('[build-editor-assets] failed');
  console.error(message);
  process.exitCode = 1;
});
