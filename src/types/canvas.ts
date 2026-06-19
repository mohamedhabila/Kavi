export type CanvasSurfaceState = 'active' | 'hidden' | 'destroyed';

export type CanvasSourceType = 'content' | 'file' | 'directory';

export interface CanvasSourceBundle {
  sourceType: CanvasSourceType;
  filePath?: string;
  directoryPath?: string;
  entryFilePath?: string;
  importedFiles?: string[];
  bundleRootUri?: string;
  bundleEntryUri?: string;
}

export interface CanvasSurface {
  id: string;
  catalogId: string;
  title?: string;
  state: CanvasSurfaceState;
  renderMode?: 'components' | 'url' | 'html';
  url?: string;
  rawHtml?: string;
  sourceBundle?: CanvasSourceBundle;
  components: CanvasComponent[];
  dataModel: Record<string, any>;
  createdAt: number;
}

export interface CanvasComponent {
  id: string;
  type: string;
  props: Record<string, any>;
  children?: CanvasComponent[];
  dataBindings?: Record<string, string>;
}

export interface CanvasAction {
  type:
    | 'createSurface'
    | 'updateContent'
    | 'updateComponents'
    | 'updateDataModel'
    | 'deleteSurface'
    | 'navigate'
    | 'eval'
    | 'snapshot';
  surfaceId: string;
  payload: any;
}
