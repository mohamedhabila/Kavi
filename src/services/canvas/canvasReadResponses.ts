import type { CanvasSurface } from '../../types/canvas';
import type { CanvasReadRequestOptions } from './types';
import { renderCanvasSurfaceToHtml } from './canvasHtmlRenderer';

const DEFAULT_CANVAS_READ_MAX_CHARS = 20_000;
const MAX_CANVAS_READ_MAX_CHARS = 120_000;

export function getSurfaceRenderMode(surface: CanvasSurface): 'components' | 'url' | 'html' {
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

export function normalizeCanvasReadOptions(
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

export function truncateDataUri(dataUri: string, maxLen = 200_000): string {
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

export function buildCanvasReadResponse(
  surface: CanvasSurface,
  options: Required<CanvasReadRequestOptions>,
  focusedSurfaceId: string | null,
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

export function buildStoredCanvasReadResponse(
  surface: CanvasSurface,
  options: Required<CanvasReadRequestOptions>,
  focusedSurfaceId: string | null,
  note?: string,
): Record<string, unknown> {
  const renderMode = getSurfaceRenderMode(surface);

  if (renderMode === 'html' && surface.rawHtml) {
    const truncated = truncateCanvasText(surface.rawHtml, options.maxChars);
    return buildCanvasReadResponse(surface, options, focusedSurfaceId, {
      modeUsed: 'source',
      contentType: 'raw_html',
      content: truncated.content,
      contentLength: truncated.contentLength,
      truncated: truncated.truncated,
      note,
    });
  }

  if (renderMode === 'components') {
    const html = renderCanvasSurfaceToHtml(surface) || '';
    const truncated = truncateCanvasText(html, options.maxChars);
    return buildCanvasReadResponse(surface, options, focusedSurfaceId, {
      modeUsed: 'source',
      contentType: 'generated_html',
      content: truncated.content,
      contentLength: truncated.contentLength,
      truncated: truncated.truncated,
      note,
    });
  }

  return buildCanvasReadResponse(surface, options, focusedSurfaceId, {
    modeUsed: 'source',
    contentType: 'url',
    content: surface.url || '',
    contentLength: surface.url?.length || 0,
    truncated: false,
    note: note || 'This canvas is URL-backed. Use mode="dom" when you need the live page DOM.',
  });
}
