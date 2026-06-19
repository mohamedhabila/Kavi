// ---------------------------------------------------------------------------
// Kavi — Canvas Renderer
// ---------------------------------------------------------------------------
// Manages A2UI canvas surfaces. Processes server messages, maintains surface
// state, and coordinates WebView rendering requests.

import type { CanvasSurface } from '../../types/canvas';
import { clearCanvasSourceBundle } from './bundles';
import { applyDataModelOperations } from './canvasDataModel';
import { renderCanvasSurfaceToHtml } from './canvasHtmlRenderer';
import {
  buildCanvasReadResponse,
  buildStoredCanvasReadResponse,
  getSurfaceRenderMode,
  normalizeCanvasReadOptions,
  truncateDataUri,
} from './canvasReadResponses';
import {
  clearCanvasSurfaceStore,
  getActiveCanvasSurfaces,
  getAllCanvasSurfaces,
  getCanvasSurface,
  getCanvasSurfaceSnapshot,
  getFocusedCanvasSurfaceId,
  hasCanvasSurface,
  hydrateCanvasSurfaceStore,
  notifyCanvasFocusSubscribers,
  notifyCanvasSurfaceSubscribers,
  persistCanvasSurfaces,
  removeCanvasSurface,
  setCanvasSurface,
  setFocusedCanvasSurfaceId,
} from './canvasSurfaceStore';
import type {
  CanvasEventHandler,
  CanvasReadRequestOptions,
  CanvasReadResultPayload,
  ServerToClientMessage,
} from './types';

export {
  getFocusedCanvasSurfaceId,
  subscribeToCanvasFocus,
  subscribeToCanvasSurfaces,
} from './canvasSurfaceStore';

let eventHandler: CanvasEventHandler = {};

interface PendingRequest {
  resolve: (value: string) => void;
  timer: ReturnType<typeof setTimeout>;
}

interface PendingReadRequest extends PendingRequest {
  options: Required<CanvasReadRequestOptions>;
}

interface PendingSnapshotRequest extends PendingRequest {
  format: 'png' | 'jpeg';
}

const pendingEvals = new Map<string, PendingRequest>();
const pendingReads = new Map<string, PendingReadRequest>();
const pendingSnapshots = new Map<string, PendingSnapshotRequest>();

const EVAL_TIMEOUT_MS = 10_000;
const READ_TIMEOUT_MS = 10_000;
const SNAPSHOT_TIMEOUT_MS = 15_000;

function resolvePendingRequest<T extends PendingRequest>(
  map: Map<string, T>,
  surfaceId: string,
  result: string,
): void {
  const pending = map.get(surfaceId);
  if (!pending) {
    return;
  }

  clearTimeout(pending.timer);
  map.delete(surfaceId);
  pending.resolve(result);
}

function rejectPendingSurfaceRequests(surfaceId: string, reason: string): void {
  resolvePendingRequest(
    pendingEvals,
    surfaceId,
    JSON.stringify({ status: 'error', surfaceId, error: reason }),
  );
  resolvePendingRequest(
    pendingReads,
    surfaceId,
    JSON.stringify({ status: 'error', surfaceId, error: reason }),
  );
  resolvePendingRequest(
    pendingSnapshots,
    surfaceId,
    JSON.stringify({ status: 'error', surfaceId, error: reason }),
  );
}

function rejectAllPendingSurfaceRequests(reason: string): void {
  const pendingIds = new Set<string>([
    ...pendingEvals.keys(),
    ...pendingReads.keys(),
    ...pendingSnapshots.keys(),
  ]);

  pendingIds.forEach((surfaceId) => rejectPendingSurfaceRequests(surfaceId, reason));
}

function notifyCanvasStateChanged(): void {
  persistCanvasSurfaces();
  notifyCanvasSurfaceSubscribers();
  notifyCanvasFocusSubscribers();
}

export function openCanvasSurface(surfaceId: string): void {
  if (!hasCanvasSurface(surfaceId)) {
    return;
  }

  if (setFocusedCanvasSurfaceId(surfaceId)) {
    notifyCanvasFocusSubscribers();
  }
}

export function closeCanvasSurface(): void {
  if (setFocusedCanvasSurfaceId(null)) {
    notifyCanvasFocusSubscribers();
  }
}

export async function hydrateCanvasSurfaces(): Promise<void> {
  return hydrateCanvasSurfaceStore();
}

/**
 * Dispatches an eval request and returns a Promise that resolves
 * when the CanvasScreen's WebView returns the result (or times out).
 */
export function requestCanvasEval(surfaceId: string, script: string): Promise<string> {
  const surface = getCanvasSurface(surfaceId);
  if (!surface) return Promise.resolve(`Error: surface not found: ${surfaceId}`);

  return new Promise<string>((resolve) => {
    const timer = setTimeout(() => {
      pendingEvals.delete(surfaceId);
      resolve(
        JSON.stringify({ status: 'timeout', surfaceId, message: 'Eval timed out after 10s' }),
      );
    }, EVAL_TIMEOUT_MS);

    pendingEvals.set(surfaceId, { resolve, timer });
    eventHandler.onEval?.(surfaceId, script);

    if (!eventHandler.onEval) {
      clearTimeout(timer);
      pendingEvals.delete(surfaceId);
      resolve(
        JSON.stringify({
          status: 'eval_dispatched',
          surfaceId,
          note: 'Canvas preview is not available yet.',
        }),
      );
    }
  });
}

export function requestCanvasRead(
  surfaceId: string,
  options?: CanvasReadRequestOptions,
): Promise<string> {
  const surface = getCanvasSurface(surfaceId);
  if (!surface) {
    return Promise.resolve(
      JSON.stringify({ status: 'error', error: `surface not found: ${surfaceId}` }),
    );
  }

  const normalizedOptions = normalizeCanvasReadOptions(options);
  const focusedSurfaceId = getFocusedCanvasSurfaceId();
  const shouldReadLiveDom =
    normalizedOptions.mode === 'dom' ||
    getSurfaceRenderMode(surface) === 'url' ||
    (normalizedOptions.mode === 'auto' &&
      focusedSurfaceId === surfaceId &&
      Boolean(eventHandler.onRead));

  if (!shouldReadLiveDom) {
    return Promise.resolve(
      JSON.stringify(buildStoredCanvasReadResponse(surface, normalizedOptions, focusedSurfaceId)),
    );
  }

  return new Promise<string>((resolve) => {
    const timer = setTimeout(() => {
      pendingReads.delete(surfaceId);
      resolve(
        JSON.stringify({
          status: 'error',
          surfaceId,
          error: 'Canvas read timed out after 10s',
        }),
      );
    }, READ_TIMEOUT_MS);

    pendingReads.set(surfaceId, { resolve, timer, options: normalizedOptions });
    eventHandler.onRead?.(surfaceId, normalizedOptions);

    if (!eventHandler.onRead) {
      clearTimeout(timer);
      pendingReads.delete(surfaceId);
      resolve(
        JSON.stringify(
          buildStoredCanvasReadResponse(
            surface,
            normalizedOptions,
            focusedSurfaceId,
            'Live DOM read is not available because the canvas preview is not active.',
          ),
        ),
      );
    }
  });
}

/**
 * Dispatches a snapshot request and returns a Promise that resolves with
 * the captured image data (or times out).
 */
export function requestCanvasSnapshot(
  surfaceId: string,
  format: 'png' | 'jpeg',
  quality?: number,
): Promise<string> {
  const surface = getCanvasSurface(surfaceId);
  if (!surface) return Promise.resolve(`Error: surface not found: ${surfaceId}`);

  return new Promise<string>((resolve) => {
    const timer = setTimeout(() => {
      pendingSnapshots.delete(surfaceId);
      resolve(
        JSON.stringify({ status: 'timeout', surfaceId, message: 'Snapshot timed out after 15s' }),
      );
    }, SNAPSHOT_TIMEOUT_MS);

    pendingSnapshots.set(surfaceId, { resolve, timer, format });
    eventHandler.onSnapshot?.(surfaceId, format, quality);

    if (!eventHandler.onSnapshot) {
      clearTimeout(timer);
      pendingSnapshots.delete(surfaceId);
      resolve(
        JSON.stringify({
          status: 'snapshot_requested',
          surfaceId,
          format,
          note: 'Canvas preview is not available yet.',
        }),
      );
    }
  });
}

/** Called by CanvasScreen when a WebView eval completes */
export function resolveCanvasEval(surfaceId: string, result: string): void {
  resolvePendingRequest(
    pendingEvals,
    surfaceId,
    JSON.stringify({ status: 'eval_completed', surfaceId, result }),
  );
}

export function resolveCanvasRead(surfaceId: string, payload: CanvasReadResultPayload): void {
  const pending = pendingReads.get(surfaceId);
  if (!pending) {
    return;
  }

  clearTimeout(pending.timer);
  pendingReads.delete(surfaceId);

  const surface = getCanvasSurface(surfaceId);
  if (!surface) {
    pending.resolve(
      JSON.stringify({ status: 'error', surfaceId, error: `surface not found: ${surfaceId}` }),
    );
    return;
  }

  if (payload.error) {
    pending.resolve(JSON.stringify({ status: 'error', surfaceId, error: payload.error }));
    return;
  }

  const content = typeof payload.content === 'string' ? payload.content : '';
  const truncated = typeof payload.truncated === 'boolean' ? payload.truncated : false;
  const contentLength =
    typeof payload.contentLength === 'number' ? payload.contentLength : content.length;
  pending.resolve(
    JSON.stringify(
      buildCanvasReadResponse(surface, pending.options, getFocusedCanvasSurfaceId(), {
        modeUsed: 'dom',
        contentType: payload.contentType || 'live_dom',
        content,
        contentLength,
        truncated,
        note: payload.note,
        title: payload.title,
        url: payload.url,
      }),
    ),
  );
}

/** Called by CanvasScreen when a snapshot capture completes */
export function resolveCanvasSnapshot(
  surfaceId: string,
  result: { dataUri?: string; error?: string },
): void {
  const pending = pendingSnapshots.get(surfaceId);
  if (!pending) {
    return;
  }

  clearTimeout(pending.timer);
  pendingSnapshots.delete(surfaceId);

  if (result.error) {
    pending.resolve(
      JSON.stringify({ status: 'error', surfaceId, format: pending.format, error: result.error }),
    );
    return;
  }

  const dataUri = typeof result.dataUri === 'string' ? truncateDataUri(result.dataUri) : '';
  pending.resolve(
    JSON.stringify({
      status: 'snapshot_captured',
      surfaceId,
      format: pending.format,
      dataUri,
      truncated: dataUri !== (result.dataUri || ''),
    }),
  );
}

export function setCanvasEventHandler(handler: CanvasEventHandler): void {
  eventHandler = handler;
}

export function getSurface(id: string): CanvasSurface | undefined {
  return getCanvasSurface(id);
}

export function getAllSurfaces(): CanvasSurface[] {
  return getAllCanvasSurfaces();
}

export function getActiveSurfaces(): CanvasSurface[] {
  return getActiveCanvasSurfaces();
}

export function clearAllSurfaces(): void {
  rejectAllPendingSurfaceRequests('Canvas surfaces were cleared before the request completed.');
  getCanvasSurfaceSnapshot().forEach((surface) => {
    void clearCanvasSourceBundle(surface.sourceBundle);
  });
  clearCanvasSurfaceStore();
  persistCanvasSurfaces();
  notifyCanvasSurfaceSubscribers();
  notifyCanvasFocusSubscribers();
}

export function deleteSurface(id: string): void {
  processCanvasMessage({ type: 'deleteSurface', surfaceId: id });
}

export function processCanvasMessage(msg: ServerToClientMessage): void {
  switch (msg.type) {
    case 'createSurface': {
      const surface: CanvasSurface = {
        id: msg.surfaceId,
        catalogId: msg.catalogId,
        title: msg.title,
        state: 'active',
        renderMode: msg.rawHtml ? 'html' : 'components',
        rawHtml: msg.rawHtml,
        sourceBundle: msg.sourceBundle,
        components: msg.components || [],
        dataModel: msg.dataModel || {},
        createdAt: Date.now(),
      };
      setCanvasSurface(surface);
      setFocusedCanvasSurfaceId(msg.surfaceId);
      notifyCanvasStateChanged();
      eventHandler.onSurfaceCreated?.(surface);
      break;
    }

    case 'updateContent': {
      const surface = getCanvasSurface(msg.surfaceId);
      if (!surface) return;
      if (
        surface.sourceBundle?.bundleRootUri &&
        surface.sourceBundle.bundleRootUri !== msg.sourceBundle?.bundleRootUri
      ) {
        void clearCanvasSourceBundle(surface.sourceBundle);
      }
      surface.rawHtml = msg.rawHtml;
      surface.renderMode = 'html';
      surface.sourceBundle = msg.sourceBundle;
      setFocusedCanvasSurfaceId(msg.surfaceId);
      notifyCanvasStateChanged();
      eventHandler.onSurfaceUpdated?.(msg.surfaceId, surface.components);
      break;
    }

    case 'updateComponents': {
      const surface = getCanvasSurface(msg.surfaceId);
      if (!surface) return;
      void clearCanvasSourceBundle(surface.sourceBundle);
      surface.components = msg.components;
      surface.renderMode = 'components';
      surface.rawHtml = undefined;
      surface.sourceBundle = undefined;
      setFocusedCanvasSurfaceId(msg.surfaceId);
      notifyCanvasStateChanged();
      eventHandler.onSurfaceUpdated?.(msg.surfaceId, msg.components);
      break;
    }

    case 'updateDataModel': {
      const surface = getCanvasSurface(msg.surfaceId);
      if (!surface) return;
      applyDataModelOperations(surface.dataModel, msg.operations);
      setFocusedCanvasSurfaceId(msg.surfaceId);
      notifyCanvasStateChanged();
      eventHandler.onDataModelUpdated?.(msg.surfaceId, surface.dataModel);
      break;
    }

    case 'deleteSurface': {
      const surface = getCanvasSurface(msg.surfaceId);
      if (surface) {
        rejectPendingSurfaceRequests(
          msg.surfaceId,
          'Canvas surface was deleted before the request completed.',
        );
        void clearCanvasSourceBundle(surface.sourceBundle);
        surface.state = 'destroyed';
        removeCanvasSurface(msg.surfaceId);
        if (getFocusedCanvasSurfaceId() === msg.surfaceId) {
          setFocusedCanvasSurfaceId(null);
        }
        notifyCanvasStateChanged();
        eventHandler.onSurfaceDeleted?.(msg.surfaceId);
      }
      break;
    }

    case 'navigate': {
      const surface = getCanvasSurface(msg.surfaceId);
      if (!surface) return;
      void clearCanvasSourceBundle(surface.sourceBundle);
      surface.renderMode = 'url';
      surface.url = msg.url;
      surface.sourceBundle = undefined;
      setFocusedCanvasSurfaceId(msg.surfaceId);
      notifyCanvasStateChanged();
      eventHandler.onNavigate?.(msg.surfaceId, msg.url);
      break;
    }

    case 'eval': {
      const surface = getCanvasSurface(msg.surfaceId);
      if (!surface) return;
      eventHandler.onEval?.(msg.surfaceId, msg.script);
      break;
    }

    case 'snapshot': {
      const surface = getCanvasSurface(msg.surfaceId);
      if (!surface) return;
      eventHandler.onSnapshot?.(msg.surfaceId, msg.format, msg.quality);
      break;
    }
  }
}

export function renderSurfaceToHtml(surfaceOrId: CanvasSurface | string): string | null {
  const surface = typeof surfaceOrId === 'string' ? getCanvasSurface(surfaceOrId) : surfaceOrId;
  if (!surface) return null;

  return renderCanvasSurfaceToHtml(surface);
}
