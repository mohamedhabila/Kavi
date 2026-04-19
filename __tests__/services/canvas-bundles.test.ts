import { File } from 'expo-file-system';
import {
  clearCanvasSourceBundle,
  hasCanvasSourceBundle,
  persistCanvasSourceBundle,
} from '../../src/services/canvas/bundles';

describe('canvas bundle storage', () => {
  beforeEach(() => {
    const fileSystem = require('expo-file-system');
    fileSystem.__resetStore();
  });

  it('persists a local HTML/CSS/JS bundle and injects the bridge into html files', async () => {
    const sourceBundle = await persistCanvasSourceBundle({
      surfaceId: 'surf-bundle',
      sourceRootPath: 'canvas/app',
      entryFilePath: 'canvas/app/index.html',
      sourceBundle: {
        sourceType: 'directory',
        directoryPath: 'canvas/app',
        entryFilePath: 'canvas/app/index.html',
        importedFiles: ['canvas/app/index.html', 'canvas/app/styles.css', 'canvas/app/app.js'],
      },
      files: [
        { path: 'canvas/app/index.html', content: '<html><body><main>App</main></body></html>' },
        { path: 'canvas/app/styles.css', content: 'main { color: red; }' },
        { path: 'canvas/app/app.js', content: 'window.appLoaded = true;' },
      ],
    });

    expect(sourceBundle.bundleRootUri).toContain('canvas-bundles-v1/surf-bundle');
    expect(sourceBundle.bundleEntryUri).toContain('canvas-bundles-v1/surf-bundle/index.html');
    expect(hasCanvasSourceBundle(sourceBundle)).toBe(true);

    const entryFile = new File(sourceBundle.bundleEntryUri!);
    const entryText = await entryFile.text();
    expect(entryText).toContain('data-canvas-bridge="1"');
    expect(entryText).toContain("surfaceId: 'surf-bundle'");

    const nestedScriptFile = new File(sourceBundle.bundleRootUri!, 'app.js');
    expect(await nestedScriptFile.text()).toBe('window.appLoaded = true;');
  });

  it('preserves nested paths inside the persisted bundle', async () => {
    const sourceBundle = await persistCanvasSourceBundle({
      surfaceId: 'surf-nested',
      sourceRootPath: 'canvas/site',
      entryFilePath: 'canvas/site/index.html',
      sourceBundle: {
        sourceType: 'directory',
        directoryPath: 'canvas/site',
        entryFilePath: 'canvas/site/index.html',
        importedFiles: ['canvas/site/index.html', 'canvas/site/nested/feature.js'],
      },
      files: [
        { path: 'canvas/site/index.html', content: '<html><body>Nested</body></html>' },
        { path: 'canvas/site/nested/feature.js', content: 'window.nested = true;' },
      ],
    });

    const nestedScriptFile = new File(sourceBundle.bundleRootUri!, 'nested/feature.js');
    expect(await nestedScriptFile.text()).toBe('window.nested = true;');
  });

  it('clears a persisted bundle', async () => {
    const sourceBundle = await persistCanvasSourceBundle({
      surfaceId: 'surf-clear',
      sourceRootPath: 'canvas/app',
      entryFilePath: 'canvas/app/index.html',
      sourceBundle: {
        sourceType: 'file',
        filePath: 'canvas/app/index.html',
        entryFilePath: 'canvas/app/index.html',
        importedFiles: ['canvas/app/index.html'],
      },
      files: [{ path: 'canvas/app/index.html', content: '<html><body>Clear me</body></html>' }],
    });

    expect(hasCanvasSourceBundle(sourceBundle)).toBe(true);

    await clearCanvasSourceBundle(sourceBundle);

    expect(hasCanvasSourceBundle(sourceBundle)).toBe(false);
  });
});
