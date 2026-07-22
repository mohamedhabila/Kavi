const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');
const runtimeEntryPath = path.join(
  projectRoot,
  'assets',
  'terminal',
  'runtime',
  'xterm-runtime.js',
);
const templatePath = path.join(projectRoot, 'assets', 'terminal', 'xterm.template.html');
const outputPaths = [
  path.join(projectRoot, 'assets', 'terminal', 'xterm.html'),
  path.join(projectRoot, 'android', 'app', 'src', 'main', 'assets', 'terminal', 'xterm.html'),
];
const bundlePlaceholder = '/* __INLINE_XTERM_BUNDLE__ */';

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
    globalName: '__KaviXtermBundle',
    minify: true,
    platform: 'browser',
    target: ['es2020'],
    write: false,
  });

  const bundledRuntime = result.outputFiles[0]?.text;
  if (!bundledRuntime) {
    throw new Error('terminal-runtime-bundle-missing');
  }

  return [
    bundledRuntime,
    'window.__KAVI_XTERM__=__KaviXtermBundle.createXtermModules();',
    "window.__KAVI_XTERM_BUILD__='local-bundle';",
  ].join('');
}

async function main() {
  const template = fs.readFileSync(templatePath, 'utf8');
  if (!template.includes(bundlePlaceholder)) {
    throw new Error('terminal-template-placeholder-missing');
  }

  const bundleCode = await buildRuntimeBundle();
  const renderedHtml = template.replace(bundlePlaceholder, () => escapeForInlineScript(bundleCode));
  let changedCount = 0;

  for (const outputPath of outputPaths) {
    if (writeIfChanged(outputPath, renderedHtml)) {
      changedCount += 1;
    }
  }

  console.log(`[build-terminal-assets] synced ${changedCount} file(s)`);
}

main().catch((error) => {
  const message = error instanceof Error ? error.stack || error.message : String(error);
  console.error('[build-terminal-assets] failed');
  console.error(message);
  process.exitCode = 1;
});
