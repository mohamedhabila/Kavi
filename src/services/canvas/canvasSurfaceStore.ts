import AsyncStorage from '@react-native-async-storage/async-storage';
import type { CanvasSurface } from '../../types/canvas';

const surfaces = new Map<string, CanvasSurface>();
const surfaceSubscribers = new Set<() => void>();
const focusSubscribers = new Set<(surfaceId: string | null) => void>();
const CANVAS_STORAGE_KEY = 'kavi_canvas_surfaces_v1';
let hydrationPromise: Promise<void> | null = null;
let focusedSurfaceId: string | null = null;

export function notifyCanvasSurfaceSubscribers(): void {
  surfaceSubscribers.forEach((subscriber) => subscriber());
}

export function notifyCanvasFocusSubscribers(): void {
  focusSubscribers.forEach((subscriber) => subscriber(focusedSurfaceId));
}

function serializeSurfaces(): string {
  return JSON.stringify(Array.from(surfaces.values()));
}

export function persistCanvasSurfaces(): void {
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

export function setFocusedCanvasSurfaceId(surfaceId: string | null): boolean {
  if (focusedSurfaceId === surfaceId) {
    return false;
  }

  focusedSurfaceId = surfaceId;
  return true;
}

export function hasCanvasSurface(surfaceId: string): boolean {
  return surfaces.has(surfaceId);
}

export function getCanvasSurface(id: string): CanvasSurface | undefined {
  return surfaces.get(id);
}

export function setCanvasSurface(surface: CanvasSurface): void {
  surfaces.set(surface.id, surface);
}

export function getAllCanvasSurfaces(): CanvasSurface[] {
  return Array.from(surfaces.values()).filter((surface) => surface.state !== 'destroyed');
}

export function getActiveCanvasSurfaces(): CanvasSurface[] {
  return Array.from(surfaces.values()).filter((surface) => surface.state === 'active');
}

export function getCanvasSurfaceSnapshot(): CanvasSurface[] {
  return Array.from(surfaces.values());
}

export function removeCanvasSurface(id: string): boolean {
  return surfaces.delete(id);
}

export function clearCanvasSurfaceStore(): void {
  surfaces.clear();
  focusedSurfaceId = null;
}

export async function hydrateCanvasSurfaceStore(): Promise<void> {
  if (hydrationPromise) return hydrationPromise;

  hydrationPromise = (async () => {
    try {
      const raw = await AsyncStorage.getItem(CANVAS_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return;
      applyHydratedSurfaces(parsed as CanvasSurface[]);
      notifyCanvasSurfaceSubscribers();
    } catch {
      // Ignore corrupted persisted state.
    }
  })();

  return hydrationPromise;
}
