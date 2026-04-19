import { Paths, Directory, File } from 'expo-file-system';
import type { CanvasSourceBundle } from '../../types';

const CANVAS_BUNDLE_STORAGE_DIRECTORY = 'canvas-bundles-v1';

function normalizeCanvasPath(path: string): string {
  let normalized = path.replace(/\\/g, '/').replace(/\0/g, '');
  normalized = normalized.replace(/^\/+/, '').replace(/\/+/g, '/');

  let previous = '';
  while (previous !== normalized) {
    previous = normalized;
    normalized = normalized
      .replace(/(^|\/)\.\//g, '$1')
      .replace(/(^|\/)(?!\.\.\/)[^/]+\/\.\.\//g, '$1')
      .replace(/^\.\.\//g, '');
  }

  return normalized.replace(/\/+$/, '');
}

function getCanvasBundleRootDirectory(): Directory {
  return new Directory(Paths.document, CANVAS_BUNDLE_STORAGE_DIRECTORY);
}

function getCanvasBundleDirectory(surfaceId: string): Directory {
  return new Directory(getCanvasBundleRootDirectory(), surfaceId);
}

async function ensureDirectory(directory: Directory): Promise<void> {
  await directory.create({ idempotent: true, intermediates: true });
}

function injectCanvasMessageBridge(html: string, surfaceId: string): string {
  if (/data-canvas-bridge\s*=\s*["']1["']/i.test(html)) {
    return html;
  }

  const bridge = `<script data-canvas-bridge="1">\nfunction sendAction(componentId, action, value) {\n  window.ReactNativeWebView?.postMessage(JSON.stringify({\n    type: 'userAction',\n    surfaceId: '${surfaceId}',\n    componentId: componentId,\n    action: action,\n    value: value\n  }));\n}\n</script>`;

  if (html.includes('</body>')) {
    return html.replace('</body>', `${bridge}\n</body>`);
  }

  if (html.includes('</html>')) {
    return html.replace('</html>', `${bridge}\n</html>`);
  }

  return `${html}\n${bridge}`;
}

function getRelativeBundlePath(sourceRootPath: string, filePath: string): string {
  const normalizedRootPath = normalizeCanvasPath(sourceRootPath);
  const normalizedFilePath = normalizeCanvasPath(filePath);

  if (!normalizedRootPath) {
    return normalizedFilePath;
  }

  if (normalizedFilePath === normalizedRootPath) {
    return normalizedFilePath.split('/').pop() || normalizedFilePath;
  }

  if (normalizedFilePath.startsWith(`${normalizedRootPath}/`)) {
    return normalizedFilePath.slice(normalizedRootPath.length + 1);
  }

  return normalizedFilePath;
}

export type PersistedCanvasSourceFile = {
  path: string;
  content: string;
};

export async function persistCanvasSourceBundle(params: {
  surfaceId: string;
  sourceRootPath: string;
  entryFilePath: string;
  files: PersistedCanvasSourceFile[];
  sourceBundle: CanvasSourceBundle;
}): Promise<CanvasSourceBundle> {
  const bundleDirectory = getCanvasBundleDirectory(params.surfaceId);
  if (bundleDirectory.exists) {
    bundleDirectory.delete();
  }

  await ensureDirectory(getCanvasBundleRootDirectory());
  await ensureDirectory(bundleDirectory);

  const normalizedEntryFilePath = normalizeCanvasPath(params.entryFilePath);
  const normalizedSourceRootPath = normalizeCanvasPath(params.sourceRootPath);
  const sortedFiles = [...params.files].sort((left, right) => left.path.localeCompare(right.path));

  let entryBundlePath: string | null = null;

  for (const file of sortedFiles) {
    const normalizedFilePath = normalizeCanvasPath(file.path);
    const relativeBundlePath = getRelativeBundlePath(normalizedSourceRootPath, normalizedFilePath);
    const parentPath = relativeBundlePath.includes('/')
      ? relativeBundlePath.slice(0, relativeBundlePath.lastIndexOf('/'))
      : '';

    if (parentPath) {
      await ensureDirectory(new Directory(bundleDirectory, parentPath));
    }

    const contentToWrite = /\.html?$/i.test(normalizedFilePath)
      ? injectCanvasMessageBridge(file.content, params.surfaceId)
      : file.content;

    new File(bundleDirectory, relativeBundlePath).write(contentToWrite);

    if (normalizedFilePath === normalizedEntryFilePath) {
      entryBundlePath = relativeBundlePath;
    }
  }

  if (!entryBundlePath) {
    throw new Error(
      `entry file "${params.entryFilePath}" was not found in the persisted canvas bundle`,
    );
  }

  const entryFile = new File(bundleDirectory, entryBundlePath);
  return {
    ...params.sourceBundle,
    bundleRootUri: bundleDirectory.uri,
    bundleEntryUri: entryFile.uri,
  };
}

export async function clearCanvasSourceBundle(
  sourceBundle?: CanvasSourceBundle | null,
): Promise<void> {
  if (!sourceBundle?.bundleRootUri) {
    return;
  }

  const bundleDirectory = new Directory(sourceBundle.bundleRootUri);
  if (!bundleDirectory.exists) {
    return;
  }

  bundleDirectory.delete();
}

export function hasCanvasSourceBundle(sourceBundle?: CanvasSourceBundle | null): boolean {
  if (!sourceBundle?.bundleEntryUri) {
    return false;
  }

  return new File(sourceBundle.bundleEntryUri).exists;
}
