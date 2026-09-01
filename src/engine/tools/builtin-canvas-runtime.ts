import {
  getAllSurfaces,
  getFocusedCanvasSurfaceId,
  processCanvasMessage,
  requestCanvasEval,
  requestCanvasRead,
  requestCanvasSnapshot,
} from '../../services/canvas/renderer';
import type { CanvasReadMode } from '../../services/canvas/types';
import { requireToolStringArg } from './fileArgumentUtils';
import {
  normalizeCanvasReadArgs,
  pickFirstCanvasString,
  resolveCanvasSurfaceTarget,
} from './builtin-canvas-helpers';
import { isAllowedUrl } from '../../services/security/ssrf';
import {
  completedToolOutcome,
  failedToolOutcome,
  type ToolRuntimeOutcome,
} from '../../types/toolRuntimeOutcome';

function appendCanvasOutcomeNote(
  outcome: ToolRuntimeOutcome,
  note: string | undefined,
): ToolRuntimeOutcome {
  if (!note) return outcome;
  let content = outcome.content;
  try {
    content = JSON.stringify({ ...JSON.parse(content), note });
  } catch {
    // Opaque non-JSON results remain unchanged; terminal status stays code-owned.
  }
  return outcome.status === 'completed'
    ? completedToolOutcome(content)
    : failedToolOutcome(content);
}

export async function executeCanvasNavigate(args: {
  surfaceId: string;
  url: string;
}): Promise<ToolRuntimeOutcome> {
  const resolved = resolveCanvasSurfaceTarget(args as Record<string, unknown>, 'canvas_navigate');
  if (resolved.error) {
    return failedToolOutcome(JSON.stringify({ status: 'error', error: resolved.error }));
  }

  let parsedUrl: URL;
  try {
    const urlArg = requireToolStringArg(args as Record<string, unknown>, 'url', 'canvas_navigate');
    if (urlArg.error) return failedToolOutcome(urlArg.error);
    parsedUrl = new URL(urlArg.value!);
  } catch {
    return failedToolOutcome(
      'Error: canvas_navigate requires a valid remote http or https URL. Use canvas_create or canvas_update for session canvas content instead of local file paths.',
    );
  }

  if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
    return failedToolOutcome(
      'Error: canvas_navigate only supports remote http or https URLs. Use canvas_create or canvas_update for session canvas content instead of local files or generated HTML.',
    );
  }

  if (!isAllowedUrl(parsedUrl.toString())) {
    return failedToolOutcome(
      'Error: canvas_navigate URL blocked by security policy (private/internal address).',
    );
  }

  processCanvasMessage({
    type: 'navigate',
    surfaceId: resolved.surfaceId!,
    url: parsedUrl.toString(),
  });
  return completedToolOutcome(
    JSON.stringify({
      status: 'navigated',
      surfaceId: resolved.surfaceId!,
      url: parsedUrl.toString(),
      ...(resolved.note ? { note: resolved.note } : {}),
    }),
  );
}

export async function executeCanvasEval(args: {
  surfaceId: string;
  script: string;
}): Promise<ToolRuntimeOutcome> {
  const resolved = resolveCanvasSurfaceTarget(args as Record<string, unknown>, 'canvas_eval');
  if (resolved.error) {
    return failedToolOutcome(JSON.stringify({ status: 'error', error: resolved.error }));
  }

  const script = pickFirstCanvasString(args as Record<string, unknown>, [
    'script',
    'code',
    'expression',
    'javascript',
    'js',
  ]);
  if (!script) {
    return failedToolOutcome(
      JSON.stringify({ status: 'error', error: 'canvas_eval requires a script string.' }),
    );
  }

  try {
    return appendCanvasOutcomeNote(
      await requestCanvasEval(resolved.surfaceId!, script),
      resolved.note,
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return failedToolOutcome(JSON.stringify({ status: 'error', error: message }));
  }
}

export async function executeCanvasRead(args: {
  surfaceId?: string;
  mode?: CanvasReadMode;
  maxChars?: number;
}): Promise<ToolRuntimeOutcome> {
  const normalized = normalizeCanvasReadArgs(args as Record<string, unknown>);
  if (normalized.error) {
    return failedToolOutcome(JSON.stringify({ status: 'error', error: normalized.error }));
  }

  try {
    return appendCanvasOutcomeNote(
      await requestCanvasRead(normalized.surfaceId!, {
        mode: normalized.mode,
        maxChars: normalized.maxChars,
      }),
      normalized.note,
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return failedToolOutcome(JSON.stringify({ status: 'error', error: message }));
  }
}

export async function executeCanvasSnapshot(args: {
  surfaceId: string;
  format?: string;
  quality?: number;
}): Promise<ToolRuntimeOutcome> {
  const resolved = resolveCanvasSurfaceTarget(args as Record<string, unknown>, 'canvas_snapshot');
  if (resolved.error) {
    return failedToolOutcome(JSON.stringify({ status: 'error', error: resolved.error }));
  }
  const format = (args.format === 'jpeg' ? 'jpeg' : 'png') as 'png' | 'jpeg';
  const quality =
    typeof args.quality === 'number' && Number.isFinite(args.quality)
      ? Math.min(1, Math.max(0, args.quality))
      : undefined;
  return appendCanvasOutcomeNote(
    await requestCanvasSnapshot(resolved.surfaceId!, format, quality),
    resolved.note,
  );
}

export async function executeCanvasList(args: {
  includeDestroyed?: boolean;
}): Promise<ToolRuntimeOutcome> {
  const focusedSurfaceId = getFocusedCanvasSurfaceId();
  const surfaces = getAllSurfaces()
    .filter((surface) => args.includeDestroyed || surface.state !== 'destroyed')
    .map((surface) => ({
      surfaceId: surface.id,
      title: surface.title || surface.id,
      state: surface.state,
      renderMode: surface.renderMode || 'components',
      url: surface.url,
      sourceBundle: surface.sourceBundle,
      componentCount: surface.components.length,
      dataKeys: Object.keys(surface.dataModel || {}),
      isFocused: surface.id === focusedSurfaceId,
    }));

  return completedToolOutcome(
    JSON.stringify({
      status: 'listed',
      count: surfaces.length,
      focusedSurfaceId,
      surfaces,
      guidance: surfaces.length
        ? 'Update an existing surface with canvas_update when possible before creating a new one. Use canvas_read to inspect stored content or live DOM before editing, prefer directoryPath for multi-file HTML/CSS/JS apps, prefer filePath for a single local HTML entry file, use contentEdits for focused raw HTML patches, use componentOperations/dataOperations for structured canvases, reuse the returned surfaceId from canvas_create or the focusedSurfaceId from canvas_list, and avoid unrelated workspace file tools unless the user explicitly asks for persisted exports.'
        : 'No existing surfaces found. Create a new session canvas with canvas_create and pass components directly instead of writing files first.',
    }),
  );
}
