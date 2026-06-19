import { getSurface, processCanvasMessage } from '../../services/canvas/renderer';
import type { CanvasComponent } from '../../types/canvas';
import { generateId } from '../../utils/id';
import { applyFocusedTextEditOperations, applyJsonPatchSubset } from './focusedEdits';
import {
  deriveCanvasTitle,
  normalizeCanvasCreateArgs,
  normalizeCanvasUpdateArgs,
} from './builtin-canvas-arguments';
import { resolveCanvasSurfaceTarget } from './builtin-canvas-helpers';
import type { CanvasToolExecutionContext } from './builtin-canvas-sourceTypes';
import { buildCanvasSourceBundle } from './builtin-canvas-sourcePathing';
import { resolveCanvasHtmlSource } from './builtin-canvas-sourceResolution';

export async function executeCanvasCreate(
  args: {
    title: string;
    content?: string;
    filePath?: string;
    directoryPath?: string;
    entryFile?: string;
    catalogId?: string;
    components?: CanvasComponent[];
    dataModel?: Record<string, any>;
  },
  executionContext: CanvasToolExecutionContext = {},
): Promise<string> {
  const normalized = normalizeCanvasCreateArgs(args as Record<string, unknown>);
  const surfaceId = `surface-${generateId()}`;
  const htmlSource = await resolveCanvasHtmlSource(
    surfaceId,
    'canvas_create',
    normalized.content,
    normalized.filePath,
    normalized.directoryPath,
    normalized.entryFile,
    executionContext,
  );
  if (htmlSource.error) return htmlSource.error;

  const title = deriveCanvasTitle(
    args as Record<string, unknown>,
    htmlSource.content,
    normalized.components,
  );
  processCanvasMessage({
    type: 'createSurface',
    surfaceId,
    catalogId: normalized.catalogId || 'default',
    title,
    rawHtml: htmlSource.content,
    sourceBundle: htmlSource.sourceBundle,
    components: normalized.components || [],
    dataModel: normalized.dataModel,
  });
  return JSON.stringify({
    status: 'created',
    surfaceId,
    title,
    renderMode: htmlSource.content ? 'html' : 'components',
    ...(htmlSource.sourceBundle ? { sourceBundle: htmlSource.sourceBundle } : {}),
    guidance: `Canvas created. Next call canvas_eval with {"surfaceId":"${surfaceId}","script":"document.title || 'loaded'"} to open or refresh the preview.`,
  });
}

export async function executeCanvasUpdate(
  args: {
    surfaceId: string;
    content?: string;
    filePath?: string;
    directoryPath?: string;
    entryFile?: string;
    contentEdits?: Array<Record<string, unknown>>;
    components?: CanvasComponent[];
    componentOperations?: Array<Record<string, unknown>>;
    dataOperations?: Array<{ op: string; path: string; value?: any }>;
  },
  executionContext: CanvasToolExecutionContext = {},
): Promise<string> {
  const normalized = normalizeCanvasUpdateArgs(args as Record<string, unknown>);
  if (normalized.error) return normalized.error;

  const htmlSource = await resolveCanvasHtmlSource(
    normalized.surfaceId!,
    'canvas_update',
    normalized.content,
    normalized.filePath,
    normalized.directoryPath,
    normalized.entryFile,
    executionContext,
  );
  if (htmlSource.error) return htmlSource.error;

  const surface = getSurface(normalized.surfaceId!);
  if (!surface) return `Error: surface not found: ${normalized.surfaceId}`;

  if (htmlSource.content && normalized.contentEdits?.length) {
    return 'Error: canvas_update accepts either content, filePath, directoryPath, or contentEdits for HTML updates, not both. Prefer contentEdits for focused changes or directoryPath/filePath after local HTML edits.';
  }

  if (normalized.components?.length && normalized.componentOperations?.length) {
    return 'Error: canvas_update accepts either components or componentOperations for component updates, not both. Prefer componentOperations for focused changes.';
  }

  if (
    !htmlSource.content &&
    !normalized.contentEdits?.length &&
    !normalized.components?.length &&
    !normalized.componentOperations?.length &&
    !normalized.dataOperations?.length
  ) {
    return 'Error: canvas_update requires content, filePath, directoryPath, contentEdits, components, componentOperations, or dataOperations.';
  }

  try {
    const appliedUpdates: string[] = [];

    let nextContent = htmlSource.content;
    let nextSourceBundle = htmlSource.sourceBundle;
    if (normalized.contentEdits?.length) {
      if (surface.renderMode !== 'html' || typeof surface.rawHtml !== 'string') {
        return 'Error: contentEdits can only be used with HTML-mode canvases that have stored rawHtml. Use componentOperations/dataOperations for structured canvases or content for a deliberate mode switch.';
      }

      const contentEditResult = applyFocusedTextEditOperations(
        surface.rawHtml,
        normalized.contentEdits,
        'canvas_update contentEdits',
      );
      if (contentEditResult.error) return contentEditResult.error;
      nextContent = contentEditResult.content!;
      nextSourceBundle = buildCanvasSourceBundle({ sourceType: 'content' });
      appliedUpdates.push(`contentEdits:${normalized.contentEdits.length}`);
    } else if (htmlSource.directoryPath) {
      appliedUpdates.push(`directoryPath:${htmlSource.directoryPath}`);
    } else if (htmlSource.filePath) {
      appliedUpdates.push(`filePath:${htmlSource.filePath}`);
    } else if (htmlSource.content) {
      appliedUpdates.push('content');
    }

    if (nextContent) {
      processCanvasMessage({
        type: 'updateContent',
        surfaceId: normalized.surfaceId!,
        rawHtml: nextContent,
        sourceBundle: nextSourceBundle,
      });
    }

    let nextComponents = normalized.components;
    if (normalized.componentOperations?.length) {
      const componentPatchResult = applyJsonPatchSubset(
        surface.components || [],
        normalized.componentOperations,
        'canvas_update componentOperations',
      );
      if (componentPatchResult.error) return componentPatchResult.error;
      if (!Array.isArray(componentPatchResult.value)) {
        return 'Error: componentOperations must resolve to an array of canvas components.';
      }
      nextComponents = componentPatchResult.value as CanvasComponent[];
      appliedUpdates.push(`componentOperations:${normalized.componentOperations.length}`);
    } else if (normalized.components?.length) {
      appliedUpdates.push('components');
    }

    if (nextComponents?.length) {
      processCanvasMessage({
        type: 'updateComponents',
        surfaceId: normalized.surfaceId!,
        components: nextComponents,
      });
    }

    if (normalized.dataOperations?.length) {
      processCanvasMessage({
        type: 'updateDataModel',
        surfaceId: normalized.surfaceId!,
        operations: normalized.dataOperations.map((op) => ({
          op: op.op,
          path: op.path,
          value: op.value,
        })),
      });
      appliedUpdates.push(`dataOperations:${normalized.dataOperations.length}`);
    }

    return JSON.stringify({
      status: 'updated',
      surfaceId: normalized.surfaceId!,
      appliedUpdates,
      ...(nextSourceBundle ? { sourceBundle: nextSourceBundle } : {}),
      ...(normalized.note ? { note: normalized.note } : {}),
      guidance: `If the user should see the latest canvas, call canvas_eval with {"surfaceId":"${normalized.surfaceId!}","script":"document.title || 'loaded'"}.`,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return JSON.stringify({ status: 'error', surfaceId: normalized.surfaceId!, error: message });
  }
}

export async function executeCanvasDelete(args: { surfaceId: string }): Promise<string> {
  const resolved = resolveCanvasSurfaceTarget(args as Record<string, unknown>, 'canvas_delete');
  if (resolved.error) return JSON.stringify({ status: 'error', error: resolved.error });
  processCanvasMessage({ type: 'deleteSurface', surfaceId: resolved.surfaceId! });
  return JSON.stringify({
    status: 'deleted',
    surfaceId: resolved.surfaceId!,
    ...(resolved.note ? { note: resolved.note } : {}),
  });
}
