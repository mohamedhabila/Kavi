// ---------------------------------------------------------------------------
// Kavi — Canvas Renderer
// ---------------------------------------------------------------------------
// Manages A2UI canvas surfaces. Processes server messages, maintains surface
// state, and generates HTML for WebView rendering.

import AsyncStorage from '@react-native-async-storage/async-storage';
import type { CanvasSurface, CanvasComponent, CanvasAction } from '../../types';
import type {
  ServerToClientMessage,
  ClientToServerEvent,
  DataModelOperation,
  CanvasEventHandler,
  CanvasReadRequestOptions,
  CanvasReadResultPayload,
} from './types';
import { clearCanvasSourceBundle } from './bundles';

// ── Surface state management ─────────────────────────────────────────────

const surfaces = new Map<string, CanvasSurface>();
let eventHandler: CanvasEventHandler = {};
const surfaceSubscribers = new Set<() => void>();
const focusSubscribers = new Set<(surfaceId: string | null) => void>();
const CANVAS_STORAGE_KEY = 'kavi_canvas_surfaces_v1';
let hydrationPromise: Promise<void> | null = null;
let focusedSurfaceId: string | null = null;

function notifySurfaceSubscribers(): void {
  surfaceSubscribers.forEach((subscriber) => subscriber());
}

function notifyFocusSubscribers(): void {
  focusSubscribers.forEach((subscriber) => subscriber(focusedSurfaceId));
}

function serializeSurfaces(): string {
  return JSON.stringify(Array.from(surfaces.values()));
}

function persistSurfaces(): void {
  void AsyncStorage.setItem(CANVAS_STORAGE_KEY, serializeSurfaces()).catch((e) =>
    console.warn('[canvas] persistSurfaces failed:', e),
  );
}

function applyHydratedSurfaces(hydratedSurfaces: CanvasSurface[]): void {
  const currentSurfaces = Array.from(surfaces.values());
  const nextSurfaces = new Map<string, CanvasSurface>();

  hydratedSurfaces.forEach((surface) => {
    if (surface?.id) {
      nextSurfaces.set(surface.id, surface);
    }
  });

  currentSurfaces.forEach((surface) => {
    nextSurfaces.set(surface.id, surface);
  });

  surfaces.clear();
  nextSurfaces.forEach((surface, id) => surfaces.set(id, surface));
}

// ── Pending eval/snapshot requests (Promise-based) ───────────────────────

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
const DEFAULT_CANVAS_READ_MAX_CHARS = 20_000;
const MAX_CANVAS_READ_MAX_CHARS = 120_000;

function getSurfaceRenderMode(surface: CanvasSurface): 'components' | 'url' | 'html' {
  if (surface.renderMode === 'url' || surface.renderMode === 'html') {
    return surface.renderMode;
  }
  return 'components';
}

function clampCanvasReadMaxChars(value?: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return DEFAULT_CANVAS_READ_MAX_CHARS;
  }

  return Math.min(MAX_CANVAS_READ_MAX_CHARS, Math.max(1_000, Math.floor(value)));
}

function normalizeCanvasReadOptions(
  options?: CanvasReadRequestOptions,
): Required<CanvasReadRequestOptions> {
  return {
    mode: options?.mode === 'dom' || options?.mode === 'source' ? options.mode : 'auto',
    maxChars: clampCanvasReadMaxChars(options?.maxChars),
  };
}

function truncateCanvasText(
  content: string,
  maxChars: number,
): {
  content: string;
  truncated: boolean;
  contentLength: number;
} {
  const contentLength = content.length;
  if (contentLength <= maxChars) {
    return {
      content,
      truncated: false,
      contentLength,
    };
  }

  return {
    content: content.slice(0, maxChars),
    truncated: true,
    contentLength,
  };
}

function truncateDataUri(dataUri: string, maxLen = 200_000): string {
  const match = dataUri.match(/^(data:[^;]+;base64,)(.*)$/);
  if (!match) {
    return dataUri.length <= maxLen ? dataUri : dataUri.slice(0, maxLen);
  }

  const prefix = match[1];
  const payload = match[2];
  const available = maxLen - prefix.length;
  if (available <= 0 || payload.length <= available) {
    return dataUri;
  }

  const safePayloadLength = available - (available % 4);
  return `${prefix}${payload.slice(0, Math.max(0, safePayloadLength))}`;
}

function buildCanvasReadResponse(
  surface: CanvasSurface,
  options: Required<CanvasReadRequestOptions>,
  params?: {
    modeUsed?: 'source' | 'dom';
    content?: string;
    contentType?: 'raw_html' | 'generated_html' | 'live_dom' | 'url';
    contentLength?: number;
    truncated?: boolean;
    note?: string;
    title?: string;
    url?: string;
  },
): Record<string, unknown> {
  const renderMode = getSurfaceRenderMode(surface);
  const dataKeys = Object.keys(surface.dataModel || {});
  const response: Record<string, unknown> = {
    status: 'read_completed',
    surfaceId: surface.id,
    title: params?.title || surface.title || surface.id,
    state: surface.state,
    renderMode,
    requestedMode: options.mode,
    modeUsed: params?.modeUsed || 'source',
    contentType:
      params?.contentType ||
      (renderMode === 'html' ? 'raw_html' : renderMode === 'url' ? 'url' : 'generated_html'),
    componentCount: surface.components.length,
    dataKeys,
    isFocused: surface.id === focusedSurfaceId,
  };

  const resolvedUrl = params?.url || surface.url;
  if (resolvedUrl) {
    response.url = resolvedUrl;
  }

  if (params?.content !== undefined) {
    response.content = params.content;
    response.contentLength =
      typeof params.contentLength === 'number' ? params.contentLength : params.content.length;
    response.truncated = params.truncated === true;
  }

  if (surface.components.length > 0) {
    response.components = surface.components;
  }

  if (dataKeys.length > 0) {
    response.dataModel = surface.dataModel;
  }

  if (surface.sourceBundle) {
    response.sourceBundle = surface.sourceBundle;
  }

  if (params?.note) {
    response.note = params.note;
  }

  return response;
}

function buildStoredCanvasReadResponse(
  surface: CanvasSurface,
  options: Required<CanvasReadRequestOptions>,
  note?: string,
): Record<string, unknown> {
  const renderMode = getSurfaceRenderMode(surface);

  if (renderMode === 'html' && surface.rawHtml) {
    const truncated = truncateCanvasText(surface.rawHtml, options.maxChars);
    return buildCanvasReadResponse(surface, options, {
      modeUsed: 'source',
      contentType: 'raw_html',
      content: truncated.content,
      contentLength: truncated.contentLength,
      truncated: truncated.truncated,
      note,
    });
  }

  if (renderMode === 'components') {
    const html = renderSurfaceToHtml(surface) || '';
    const truncated = truncateCanvasText(html, options.maxChars);
    return buildCanvasReadResponse(surface, options, {
      modeUsed: 'source',
      contentType: 'generated_html',
      content: truncated.content,
      contentLength: truncated.contentLength,
      truncated: truncated.truncated,
      note,
    });
  }

  return buildCanvasReadResponse(surface, options, {
    modeUsed: 'source',
    contentType: 'url',
    content: surface.url || '',
    contentLength: surface.url?.length || 0,
    truncated: false,
    note: note || 'This canvas is URL-backed. Use mode="dom" when you need the live page DOM.',
  });
}

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

export function subscribeToCanvasSurfaces(listener: () => void): () => void {
  surfaceSubscribers.add(listener);
  return () => {
    surfaceSubscribers.delete(listener);
  };
}

export function subscribeToCanvasFocus(listener: (surfaceId: string | null) => void): () => void {
  focusSubscribers.add(listener);
  listener(focusedSurfaceId);
  return () => {
    focusSubscribers.delete(listener);
  };
}

export function getFocusedCanvasSurfaceId(): string | null {
  return focusedSurfaceId;
}

export function openCanvasSurface(surfaceId: string): void {
  if (!surfaces.has(surfaceId)) {
    return;
  }

  if (focusedSurfaceId === surfaceId) {
    return;
  }

  focusedSurfaceId = surfaceId;
  notifyFocusSubscribers();
}

export function closeCanvasSurface(): void {
  if (focusedSurfaceId === null) {
    return;
  }

  focusedSurfaceId = null;
  notifyFocusSubscribers();
}

export async function hydrateCanvasSurfaces(): Promise<void> {
  if (hydrationPromise) return hydrationPromise;

  hydrationPromise = (async () => {
    try {
      const raw = await AsyncStorage.getItem(CANVAS_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return;
      applyHydratedSurfaces(parsed as CanvasSurface[]);
      notifySurfaceSubscribers();
    } catch {
      // Ignore corrupted persisted state.
    }
  })();

  return hydrationPromise;
}

/**
 * Dispatches an eval request and returns a Promise that resolves
 * when the CanvasScreen's WebView returns the result (or times out).
 */
export function requestCanvasEval(surfaceId: string, script: string): Promise<string> {
  const surface = surfaces.get(surfaceId);
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

    // If no handler is registered, resolve immediately with a note
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
  const surface = surfaces.get(surfaceId);
  if (!surface) {
    return Promise.resolve(
      JSON.stringify({ status: 'error', error: `surface not found: ${surfaceId}` }),
    );
  }

  const normalizedOptions = normalizeCanvasReadOptions(options);
  const shouldReadLiveDom =
    normalizedOptions.mode === 'dom' ||
    getSurfaceRenderMode(surface) === 'url' ||
    (normalizedOptions.mode === 'auto' &&
      focusedSurfaceId === surfaceId &&
      Boolean(eventHandler.onRead));

  if (!shouldReadLiveDom) {
    return Promise.resolve(
      JSON.stringify(buildStoredCanvasReadResponse(surface, normalizedOptions)),
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
  const surface = surfaces.get(surfaceId);
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

  const surface = surfaces.get(surfaceId);
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
      buildCanvasReadResponse(surface, pending.options, {
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
  return surfaces.get(id);
}

export function getAllSurfaces(): CanvasSurface[] {
  return Array.from(surfaces.values()).filter((s) => s.state !== 'destroyed');
}

export function getActiveSurfaces(): CanvasSurface[] {
  return Array.from(surfaces.values()).filter((s) => s.state === 'active');
}

export function clearAllSurfaces(): void {
  rejectAllPendingSurfaceRequests('Canvas surfaces were cleared before the request completed.');
  Array.from(surfaces.values()).forEach((surface) => {
    void clearCanvasSourceBundle(surface.sourceBundle);
  });
  surfaces.clear();
  focusedSurfaceId = null;
  persistSurfaces();
  notifySurfaceSubscribers();
  notifyFocusSubscribers();
}

export function deleteSurface(id: string): void {
  processCanvasMessage({ type: 'deleteSurface', surfaceId: id });
}

// ── Process server messages ──────────────────────────────────────────────

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
      surfaces.set(msg.surfaceId, surface);
      focusedSurfaceId = msg.surfaceId;
      persistSurfaces();
      notifySurfaceSubscribers();
      notifyFocusSubscribers();
      eventHandler.onSurfaceCreated?.(surface);
      break;
    }

    case 'updateContent': {
      const surface = surfaces.get(msg.surfaceId);
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
      focusedSurfaceId = msg.surfaceId;
      persistSurfaces();
      notifySurfaceSubscribers();
      notifyFocusSubscribers();
      eventHandler.onSurfaceUpdated?.(msg.surfaceId, surface.components);
      break;
    }

    case 'updateComponents': {
      const surface = surfaces.get(msg.surfaceId);
      if (!surface) return;
      void clearCanvasSourceBundle(surface.sourceBundle);
      surface.components = msg.components;
      surface.renderMode = 'components';
      surface.rawHtml = undefined;
      surface.sourceBundle = undefined;
      focusedSurfaceId = msg.surfaceId;
      persistSurfaces();
      notifySurfaceSubscribers();
      notifyFocusSubscribers();
      eventHandler.onSurfaceUpdated?.(msg.surfaceId, msg.components);
      break;
    }

    case 'updateDataModel': {
      const surface = surfaces.get(msg.surfaceId);
      if (!surface) return;
      applyDataModelOperations(surface.dataModel, msg.operations);
      focusedSurfaceId = msg.surfaceId;
      persistSurfaces();
      notifySurfaceSubscribers();
      notifyFocusSubscribers();
      eventHandler.onDataModelUpdated?.(msg.surfaceId, surface.dataModel);
      break;
    }

    case 'deleteSurface': {
      const surface = surfaces.get(msg.surfaceId);
      if (surface) {
        rejectPendingSurfaceRequests(
          msg.surfaceId,
          'Canvas surface was deleted before the request completed.',
        );
        void clearCanvasSourceBundle(surface.sourceBundle);
        surface.state = 'destroyed';
        surfaces.delete(msg.surfaceId);
        if (focusedSurfaceId === msg.surfaceId) {
          focusedSurfaceId = null;
        }
        persistSurfaces();
        notifySurfaceSubscribers();
        notifyFocusSubscribers();
        eventHandler.onSurfaceDeleted?.(msg.surfaceId);
      }
      break;
    }

    case 'navigate': {
      const surface = surfaces.get(msg.surfaceId);
      if (!surface) return;
      void clearCanvasSourceBundle(surface.sourceBundle);
      surface.renderMode = 'url';
      surface.url = msg.url;
      surface.sourceBundle = undefined;
      focusedSurfaceId = msg.surfaceId;
      persistSurfaces();
      notifySurfaceSubscribers();
      notifyFocusSubscribers();
      eventHandler.onNavigate?.(msg.surfaceId, msg.url);
      break;
    }

    case 'eval': {
      const surface = surfaces.get(msg.surfaceId);
      if (!surface) return;
      eventHandler.onEval?.(msg.surfaceId, msg.script);
      break;
    }

    case 'snapshot': {
      const surface = surfaces.get(msg.surfaceId);
      if (!surface) return;
      eventHandler.onSnapshot?.(msg.surfaceId, msg.format, msg.quality);
      break;
    }
  }
}

// ── Data model operations (JSON-Patch subset) ────────────────────────────

function applyDataModelOperations(
  model: Record<string, any>,
  operations: DataModelOperation[],
): void {
  for (const op of operations) {
    const parts = op.path.split('/').filter(Boolean);
    if (parts.length === 0) continue;

    const key = parts[parts.length - 1];
    let target = model;

    for (let i = 0; i < parts.length - 1; i++) {
      if (target[parts[i]] === undefined) {
        if (op.op === 'remove') return;
        target[parts[i]] = {};
      }
      target = target[parts[i]];
    }

    switch (op.op) {
      case 'add':
      case 'replace':
        target[key] = op.value;
        break;
      case 'remove':
        delete target[key];
        break;
    }
  }
}

// ── Inject message bridge into raw HTML ──────────────────────────────────

function injectMessageBridge(html: string, surfaceId: string): string {
  const bridge = `<script>\nfunction sendAction(componentId, action, value) {\n  window.ReactNativeWebView?.postMessage(JSON.stringify({\n    type: 'userAction',\n    surfaceId: '${surfaceId}',\n    componentId: componentId,\n    action: action,\n    value: value\n  }));\n}\n</script>`;

  // Inject bridge script before closing </body> or </html> tag, or append at end
  if (html.includes('</body>')) {
    return html.replace('</body>', `${bridge}\n</body>`);
  }
  if (html.includes('</html>')) {
    return html.replace('</html>', `${bridge}\n</html>`);
  }
  return html + bridge;
}

// ── Render surface to HTML (for WebView) ────────────────────────────────

export function renderSurfaceToHtml(surfaceOrId: CanvasSurface | string): string | null {
  const surface = typeof surfaceOrId === 'string' ? surfaces.get(surfaceOrId) : surfaceOrId;
  if (!surface) return null;

  // Raw HTML mode: return the HTML directly (with message bridge injected)
  if (surface.renderMode === 'html' && surface.rawHtml) {
    return injectMessageBridge(surface.rawHtml, surface.id);
  }

  const resolvedComponents = resolveDataBindings(surface.components, surface.dataModel);
  const componentHtml = resolvedComponents.map(renderComponent).join('\n');

  return `<!DOCTYPE html>
<html>
<head>
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
         padding: 16px; background: #1a1a2e; color: #e0e0e0; }
  .container { display: flex; flex-direction: column; gap: 12px; }
  .card { background: #16213e; border-radius: 12px; padding: 16px; }
  .text { font-size: 16px; line-height: 1.5; }
  .heading { font-size: 20px; font-weight: 700; margin-bottom: 8px; }
  .button { background: #0f3460; color: #e94560; border: none; border-radius: 8px;
            padding: 12px 24px; font-size: 16px; cursor: pointer; text-align: center; }
  .button:active { opacity: 0.7; }
  .input { background: #0f3460; border: 1px solid #333; border-radius: 8px;
           padding: 12px; color: #e0e0e0; font-size: 16px; width: 100%; }
  .image { max-width: 100%; border-radius: 8px; }
  .list { list-style: none; }
  .list-item { padding: 12px 0; border-bottom: 1px solid #333; }
  .row { display: flex; gap: 8px; align-items: center; }
  .spacer { flex: 1; }
  .badge { background: #e94560; color: white; border-radius: 12px;
           padding: 2px 8px; font-size: 12px; }
  .progress { width: 100%; height: 8px; background: #0f3460; border-radius: 4px;
              overflow: hidden; }
  .progress-bar { height: 100%; background: #e94560; border-radius: 4px;
                  transition: width 0.3s ease; }
  .select { background: #0f3460; border: 1px solid #333; border-radius: 8px;
            padding: 12px; color: #e0e0e0; font-size: 16px; width: 100%; }
  .checkbox-label, .radio-label { display: flex; align-items: center; gap: 8px;
                                  font-size: 16px; padding: 4px 0; cursor: pointer; }
  .checkbox-label input, .radio-label input { width: 18px; height: 18px; accent-color: #e94560; }
  .form { display: flex; flex-direction: column; gap: 12px; }
  table { width: 100%; border-collapse: collapse; font-size: 14px; }
  th { background: #0f3460; text-align: left; padding: 10px; border-bottom: 2px solid #e94560; }
  td { padding: 10px; border-bottom: 1px solid #333; }
  tr:hover td { background: #16213e; }
</style>
</head>
<body>
<div class="container" data-surface-id="${surface.id}">
${componentHtml}
</div>
<script>
function sendAction(componentId, action, value) {
  window.ReactNativeWebView?.postMessage(JSON.stringify({
    type: 'userAction',
    surfaceId: '${surface.id}',
    componentId: componentId,
    action: action,
    value: value
  }));
}
document.querySelectorAll('[data-action]').forEach(el => {
  el.addEventListener('click', () => {
    sendAction(el.dataset.componentId, el.dataset.action, el.dataset.value);
  });
});
document.querySelectorAll('input[type="text"], input[type="email"], input[type="number"], input[type="password"], input[type="tel"], input[type="url"], input:not([type]), textarea').forEach(el => {
  el.addEventListener('change', () => {
    sendAction(el.dataset.componentId, 'change', el.value);
  });
});
document.querySelectorAll('select').forEach(el => {
  el.addEventListener('change', () => {
    sendAction(el.dataset.componentId, 'change', el.value);
  });
});
document.querySelectorAll('input[type="checkbox"]').forEach(el => {
  el.addEventListener('change', () => {
    sendAction(el.dataset.componentId, 'change', el.checked);
  });
});
document.querySelectorAll('input[type="radio"]').forEach(el => {
  el.addEventListener('change', () => {
    sendAction(el.dataset.componentId, 'change', el.value);
  });
});
</script>
</body>
</html>`;
}

function renderComponent(comp: CanvasComponent): string {
  const id = comp.id;
  const props = comp.props || {};

  switch (comp.type) {
    case 'text':
      return `<p class="text" data-component-id="${id}">${escapeHtml(props.text || '')}</p>`;

    case 'heading':
      return `<h2 class="heading" data-component-id="${id}">${escapeHtml(props.text || '')}</h2>`;

    case 'button':
      return `<button class="button" data-component-id="${id}" data-action="${props.action || 'click'}" data-value="${escapeHtml(props.value || '')}">${escapeHtml(props.label || 'Button')}</button>`;

    case 'input':
      return `<input class="input" data-component-id="${id}" placeholder="${escapeHtml(props.placeholder || '')}" value="${escapeHtml(props.value || '')}" type="${props.inputType || 'text'}" />`;

    case 'textarea':
      return `<textarea class="input" data-component-id="${id}" placeholder="${escapeHtml(props.placeholder || '')}" rows="${props.rows || 3}">${escapeHtml(props.value || '')}</textarea>`;

    case 'image':
      return `<img class="image" data-component-id="${id}" src="${escapeHtml(props.src || '')}" alt="${escapeHtml(props.alt || '')}" />`;

    case 'card':
      const inner = (comp.children || []).map(renderComponent).join('\n');
      return `<div class="card" data-component-id="${id}">${inner}</div>`;

    case 'row':
      const rowInner = (comp.children || []).map(renderComponent).join('\n');
      return `<div class="row" data-component-id="${id}">${rowInner}</div>`;

    case 'list':
      const items = (comp.children || [])
        .map((c) => `<li class="list-item">${renderComponent(c)}</li>`)
        .join('\n');
      return `<ul class="list" data-component-id="${id}">${items}</ul>`;

    case 'badge':
      return `<span class="badge" data-component-id="${id}">${escapeHtml(props.text || '')}</span>`;

    case 'progress':
      const pct = Math.max(0, Math.min(100, Number(props.value) || 0));
      return `<div class="progress" data-component-id="${id}"><div class="progress-bar" style="width:${pct}%"></div></div>`;

    case 'spacer':
      return `<div class="spacer"></div>`;

    case 'divider':
      return `<hr style="border-color: #333; margin: 8px 0;" />`;

    case 'select': {
      const optionsHtml = (props.options || [])
        .map((opt: any) => {
          const val = typeof opt === 'string' ? opt : opt.value;
          const label = typeof opt === 'string' ? opt : opt.label || opt.value;
          const sel = val === props.value ? ' selected' : '';
          return `<option value="${escapeHtml(val)}"${sel}>${escapeHtml(label)}</option>`;
        })
        .join('');
      return `<select class="select" data-component-id="${id}">${optionsHtml}</select>`;
    }

    case 'checkbox':
      return `<label class="checkbox-label" data-component-id="${id}"><input type="checkbox" data-component-id="${id}" ${props.checked ? 'checked' : ''} />${escapeHtml(props.label || '')}</label>`;

    case 'radio': {
      const name = escapeHtml(props.name || props.group || id);
      return `<label class="radio-label" data-component-id="${id}"><input type="radio" name="${name}" data-component-id="${id}" value="${escapeHtml(props.value || '')}" ${props.checked ? 'checked' : ''} />${escapeHtml(props.label || '')}</label>`;
    }

    case 'form': {
      const formInner = (comp.children || []).map(renderComponent).join('\n');
      return `<form class="form" data-component-id="${id}" onsubmit="event.preventDefault(); sendAction('${id}', 'submit', Object.fromEntries(new FormData(this)));">${formInner}</form>`;
    }

    case 'table': {
      const headers = (props.headers || [])
        .map((h: string) => `<th>${escapeHtml(h)}</th>`)
        .join('');
      const rows = (props.rows || [])
        .map(
          (row: string[]) =>
            `<tr>${row.map((cell: string) => `<td>${escapeHtml(String(cell))}</td>`).join('')}</tr>`,
        )
        .join('');
      return `<table data-component-id="${id}"><thead><tr>${headers}</tr></thead><tbody>${rows}</tbody></table>`;
    }

    case 'container':
    default: {
      const inside = (comp.children || []).map(renderComponent).join('\n');
      return `<div class="container" data-component-id="${id}">${inside}</div>`;
    }
  }
}

// ── Data binding resolution ──────────────────────────────────────────────

function resolveDataBindings(
  components: CanvasComponent[],
  dataModel: Record<string, any>,
): CanvasComponent[] {
  return components.map((comp) => {
    const resolved = { ...comp, props: { ...comp.props } };

    if (comp.dataBindings) {
      for (const [propKey, dataPath] of Object.entries(comp.dataBindings)) {
        const value = getNestedValue(dataModel, dataPath);
        if (value !== undefined) {
          resolved.props[propKey] = value;
        }
      }
    }

    if (comp.children) {
      resolved.children = resolveDataBindings(comp.children, dataModel);
    }

    return resolved;
  });
}

function getNestedValue(obj: any, path: string): any {
  const parts = path.split('.');
  let current = obj;
  for (const part of parts) {
    if (current === undefined || current === null) return undefined;
    current = current[part];
  }
  return current;
}

function escapeHtml(str: string): string {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
