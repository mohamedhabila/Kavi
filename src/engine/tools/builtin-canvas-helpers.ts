import {
  getAllSurfaces,
  getFocusedCanvasSurfaceId,
  getSurface,
} from '../../services/canvas/renderer';
import type { CanvasReadMode } from '../../services/canvas/types';
import { sanitizeWorkspaceRelativePath } from './fileArgumentUtils';

export function normalizeCanvasTextContent(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }

  const fencedMatch = trimmed.match(/^```(?:html|htm|xml|svg)?\s*\n([\s\S]*?)\n```$/i);
  return fencedMatch ? fencedMatch[1].trim() : trimmed;
}

export function looksLikeHtml(value: string): boolean {
  return /<!doctype html|<html\b|<body\b|<div\b|<section\b|<main\b|<style\b|<script\b/i.test(value);
}

export function looksLikeCanvasHtmlContent(value: string): boolean {
  return /<!doctype html|<html\b|<head\b|<body\b|<[a-z][\w:-]*\b[^>]*>/i.test(value);
}

export function pickFirstCanvasString(
  args: Record<string, unknown>,
  keys: string[],
): string | undefined {
  for (const key of keys) {
    const normalized = normalizeCanvasTextContent(args[key]);
    if (normalized) {
      return normalized;
    }
  }
  return undefined;
}

export function pickFirstCanvasFilePath(
  args: Record<string, unknown>,
  keys: string[],
): string | undefined {
  for (const key of keys) {
    const value = args[key];
    if (typeof value !== 'string') {
      continue;
    }

    const normalized = sanitizeWorkspaceRelativePath(value);
    if (normalized) {
      return normalized;
    }
  }

  return undefined;
}

export function normalizeCanvasDirectoryPath(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  return value.replace(/\/+$/, '');
}

function summarizeAvailableSurfaces(): string | undefined {
  const surfaces = getAllSurfaces();
  if (!surfaces.length) {
    return undefined;
  }

  return surfaces
    .slice(0, 5)
    .map((surface) => `${surface.id}${surface.title ? ` (${surface.title})` : ''}`)
    .join(', ');
}

export function resolveCanvasSurfaceTarget(
  args: Record<string, unknown>,
  operation: string,
): { surfaceId?: string; note?: string; error?: string } {
  const candidate = pickFirstCanvasString(args, [
    'surfaceId',
    'canvasId',
    'id',
    'surface',
    'canvas',
  ]);
  const allSurfaces = getAllSurfaces();

  const tryResolve = (identifier?: string) => {
    if (!identifier) return undefined;
    const direct = getSurface(identifier);
    if (direct) return direct;
    const normalized = identifier.trim().toLowerCase();
    return allSurfaces.find(
      (surface) =>
        surface.id.toLowerCase() === normalized ||
        (surface.title || '').trim().toLowerCase() === normalized,
    );
  };

  const matchedSurface = tryResolve(candidate);
  if (matchedSurface) {
    return {
      surfaceId: matchedSurface.id,
      ...(candidate && candidate !== matchedSurface.id
        ? {
            note: `Resolved ${operation} target "${candidate}" to surfaceId "${matchedSurface.id}".`,
          }
        : {}),
    };
  }

  const focusedSurfaceId = getFocusedCanvasSurfaceId();
  if (focusedSurfaceId && getSurface(focusedSurfaceId)) {
    return {
      surfaceId: focusedSurfaceId,
      note: candidate
        ? `Using focused surface "${focusedSurfaceId}" for ${operation} because "${candidate}" was not found.`
        : `Using focused surface "${focusedSurfaceId}" for ${operation}.`,
    };
  }

  if (allSurfaces.length === 1) {
    return {
      surfaceId: allSurfaces[0].id,
      note: candidate
        ? `Using the only active surface "${allSurfaces[0].id}" for ${operation} because "${candidate}" was not found.`
        : `Using the only active surface "${allSurfaces[0].id}" for ${operation}.`,
    };
  }

  const available = summarizeAvailableSurfaces();
  if (candidate) {
    return {
      error: available
        ? `Error: unable to find canvas surface "${candidate}" for ${operation}. Available surfaces: ${available}. Call canvas_list if unsure.`
        : `Error: unable to find canvas surface "${candidate}" for ${operation}. No active surfaces exist. Create one with canvas_create first.`,
    };
  }

  return {
    error: available
      ? `Error: surfaceId is required for ${operation} when multiple canvas surfaces exist. Available surfaces: ${available}. Call canvas_list if unsure.`
      : `Error: surfaceId is required for ${operation}. No active surfaces exist. Create one with canvas_create first.`,
  };
}

export function normalizeCanvasReadArgs(args: Record<string, unknown>) {
  const rawMode = pickFirstCanvasString(args, ['mode', 'readMode', 'output', 'contentMode']);
  const mode: CanvasReadMode = rawMode === 'dom' || rawMode === 'source' ? rawMode : 'auto';
  const rawMaxChars = args.maxChars ?? args.maxLength ?? args.limit;
  const maxChars =
    typeof rawMaxChars === 'number' && Number.isFinite(rawMaxChars)
      ? Math.max(1_000, Math.floor(rawMaxChars))
      : undefined;

  return {
    ...resolveCanvasSurfaceTarget(args, 'canvas_read'),
    mode,
    maxChars,
  };
}