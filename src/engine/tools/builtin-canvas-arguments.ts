import type { CanvasComponent } from '../../types/canvas';
import {
  normalizeFocusedTextEditOperations,
  normalizeJsonPatchSubsetOperations,
} from './focusedEdits';
import {
  normalizeCanvasDirectoryPath,
  pickFirstCanvasFilePath,
  pickFirstCanvasString,
  resolveCanvasSurfaceTarget,
} from './builtin-canvas-helpers';
import { isRecord, normalizeCanvasComponentsInput } from './builtin-canvas-components';

export function deriveCanvasTitle(
  args: Record<string, unknown>,
  content?: string,
  components?: CanvasComponent[],
): string {
  const explicitTitle = pickFirstCanvasString(args, [
    'title',
    'name',
    'label',
    'surfaceTitle',
    'canvasTitle',
  ]);
  if (explicitTitle) {
    return explicitTitle;
  }

  const titleMatch = content?.match(/<title>([^<]+)<\/title>/i);
  if (titleMatch?.[1]?.trim()) {
    return titleMatch[1].trim();
  }

  const headingText = components?.find((component) => component.type === 'heading')?.props?.text;
  if (typeof headingText === 'string' && headingText.trim()) {
    return headingText.trim();
  }

  return content ? 'Canvas Preview' : 'Canvas Surface';
}

export function normalizeCanvasCreateArgs(args: Record<string, unknown>) {
  const content = pickFirstCanvasString(args, [
    'content',
    'html',
    'rawHtml',
    'raw_html',
    'markup',
    'body',
    'source',
    'template',
  ]);
  const filePath = pickFirstCanvasFilePath(args, [
    'filePath',
    'htmlFile',
    'sourceFile',
    'templateFile',
  ]);
  const directoryPath = normalizeCanvasDirectoryPath(
    pickFirstCanvasFilePath(args, ['directoryPath', 'dirPath', 'folderPath', 'directory']),
  );
  const entryFile = pickFirstCanvasFilePath(args, ['entryFile', 'indexFile', 'mainFile']);
  const components = normalizeCanvasComponentsInput(
    args.components ?? args.componentTree ?? args.tree ?? args.component ?? args.children,
  );
  return {
    title: deriveCanvasTitle(args, content, components),
    content,
    filePath,
    directoryPath,
    entryFile,
    catalogId: pickFirstCanvasString(args, ['catalogId', 'catalog', 'catalogName']),
    components,
    dataModel: isRecord(args.dataModel)
      ? args.dataModel
      : isRecord(args.data)
        ? args.data
        : isRecord(args.model)
          ? args.model
          : undefined,
  };
}

export function normalizeCanvasUpdateArgs(args: Record<string, unknown>) {
  const contentEdits = normalizeFocusedTextEditOperations(
    args.contentEdits ?? args.htmlEdits ?? args.sourceEdits,
    'canvas_update',
    'contentEdits',
  );
  const componentOperations = normalizeJsonPatchSubsetOperations(
    args.componentOperations ?? args.componentsPatch ?? args.componentPatch,
    'canvas_update',
    'componentOperations',
  );
  const dataOperations = normalizeJsonPatchSubsetOperations(
    args.dataOperations ?? args.operations ?? args.patch,
    'canvas_update',
    'dataOperations',
  );

  return {
    ...resolveCanvasSurfaceTarget(args, 'canvas_update'),
    ...(contentEdits.error ? { error: contentEdits.error } : {}),
    ...(componentOperations.error ? { error: componentOperations.error } : {}),
    ...(dataOperations.error ? { error: dataOperations.error } : {}),
    content: pickFirstCanvasString(args, [
      'content',
      'html',
      'rawHtml',
      'raw_html',
      'markup',
      'body',
      'source',
      'template',
    ]),
    filePath: pickFirstCanvasFilePath(args, ['filePath', 'htmlFile', 'sourceFile', 'templateFile']),
    directoryPath: normalizeCanvasDirectoryPath(
      pickFirstCanvasFilePath(args, ['directoryPath', 'dirPath', 'folderPath', 'directory']),
    ),
    entryFile: pickFirstCanvasFilePath(args, ['entryFile', 'indexFile', 'mainFile']),
    contentEdits: contentEdits.operations,
    components: normalizeCanvasComponentsInput(
      args.components ?? args.componentTree ?? args.tree ?? args.component ?? args.children,
    ),
    componentOperations: componentOperations.operations,
    dataOperations: dataOperations.operations,
  };
}
