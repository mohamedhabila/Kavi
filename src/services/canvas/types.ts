// ---------------------------------------------------------------------------
// Kavi — Canvas / A2UI Types
// ---------------------------------------------------------------------------

import type { CanvasSurface, CanvasComponent, CanvasSourceBundle } from '../../types/canvas';

// ── Server → Client message types ────────────────────────────────────────

export interface CreateSurfaceMessage {
  type: 'createSurface';
  surfaceId: string;
  catalogId: string;
  title?: string;
  rawHtml?: string;
  sourceBundle?: CanvasSourceBundle;
  components: CanvasComponent[];
  dataModel?: Record<string, any>;
}

export interface UpdateComponentsMessage {
  type: 'updateComponents';
  surfaceId: string;
  components: CanvasComponent[];
}

export interface UpdateContentMessage {
  type: 'updateContent';
  surfaceId: string;
  rawHtml: string;
  sourceBundle?: CanvasSourceBundle;
}

export interface UpdateDataModelMessage {
  type: 'updateDataModel';
  surfaceId: string;
  operations: DataModelOperation[];
}

export interface DeleteSurfaceMessage {
  type: 'deleteSurface';
  surfaceId: string;
}

export interface NavigateSurfaceMessage {
  type: 'navigate';
  surfaceId: string;
  url: string;
}

export interface EvalSurfaceMessage {
  type: 'eval';
  surfaceId: string;
  script: string;
}

export interface SnapshotSurfaceMessage {
  type: 'snapshot';
  surfaceId: string;
  format: 'png' | 'jpeg';
  quality?: number;
}

export type CanvasReadMode = 'auto' | 'source' | 'dom';

export interface CanvasReadRequestOptions {
  mode?: CanvasReadMode;
  maxChars?: number;
}

export interface CanvasReadResultPayload {
  content: string;
  contentType?: 'live_dom';
  title?: string;
  url?: string;
  truncated?: boolean;
  contentLength?: number;
  error?: string;
  note?: string;
}

export type ServerToClientMessage =
  | CreateSurfaceMessage
  | UpdateComponentsMessage
  | UpdateContentMessage
  | UpdateDataModelMessage
  | DeleteSurfaceMessage
  | NavigateSurfaceMessage
  | EvalSurfaceMessage
  | SnapshotSurfaceMessage;

// ── Client → Server event types ──────────────────────────────────────────

export interface UserActionEvent {
  type: 'userAction';
  surfaceId: string;
  componentId: string;
  action: string;
  value?: any;
  context?: Record<string, any>;
}

export interface ClientErrorEvent {
  type: 'error';
  surfaceId: string;
  code: 'VALIDATION_FAILED' | 'RENDER_ERROR' | 'UNKNOWN';
  message: string;
}

export interface ClientCapabilitiesEvent {
  type: 'clientUiCapabilities';
  supportedComponents: string[];
  maxSurfaces: number;
  platform: 'ios' | 'android' | 'web';
}

export type ClientToServerEvent = UserActionEvent | ClientErrorEvent | ClientCapabilitiesEvent;

// ── Data model operations (JSON-Patch like) ──────────────────────────────

export interface DataModelOperation {
  op: 'add' | 'replace' | 'remove';
  path: string;
  value?: any;
}

// ── Canvas handler type ──────────────────────────────────────────────────

export type CanvasEventHandler = {
  onSurfaceCreated?: (surface: CanvasSurface) => void;
  onSurfaceUpdated?: (surfaceId: string, components: CanvasComponent[]) => void;
  onDataModelUpdated?: (surfaceId: string, model: Record<string, any>) => void;
  onSurfaceDeleted?: (surfaceId: string) => void;
  onNavigate?: (surfaceId: string, url: string) => void;
  onEval?: (surfaceId: string, script: string) => void;
  onRead?: (surfaceId: string, options: CanvasReadRequestOptions) => void;
  onSnapshot?: (surfaceId: string, format: 'png' | 'jpeg', quality?: number) => void;
};
