// ---------------------------------------------------------------------------
// Kavi — Tool surface token budget fixtures (structural)
// ---------------------------------------------------------------------------

export interface ToolSurfaceBudgetFixture {
  id: string;
  /** Tools a discovery call activated for the turn. */
  activatedCatalogToolNames?: ReadonlyArray<string>;
  includeToolCatalog?: boolean;
}

export const TOOL_SURFACE_BUDGET_FIXTURES: ReadonlyArray<ToolSurfaceBudgetFixture> = [
  {
    id: 'canvas-activated',
    activatedCatalogToolNames: ['canvas_create', 'canvas_update', 'canvas_read', 'canvas_list'],
  },
  {
    id: 'media-activated',
    activatedCatalogToolNames: ['pdf_read', 'camera_snap', 'audio_transcribe'],
  },
  {
    id: 'bootstrap-turn',
    includeToolCatalog: true,
  },
];
