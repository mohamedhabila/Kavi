import {
  executeCanvasEval,
  executeCanvasList,
  executeCanvasNavigate,
  executeCanvasRead,
  executeCanvasSnapshot,
  installBuiltinExecutorRuntimeReset,
} from '../helpers/builtinExecutorRuntimeHarness';

describe('builtin executor canvas runtime', () => {
  installBuiltinExecutorRuntimeReset();

  describe('executeCanvasNavigate', () => {
    it('returns error for non-existent surface', async () => {
      const result = await executeCanvasNavigate({ surfaceId: 'none', url: 'https://example.com' });
      expect(result).toContain('Error');
      expect(result).toContain('unable to find canvas surface');
    });

    it('processes navigate message for existing surface', async () => {
      const { getSurface, processCanvasMessage } = require('../../src/services/canvas/renderer');
      getSurface.mockImplementation((id: string) =>
        id === 'surf-1' ? { id: 'surf-1', state: 'active' } : undefined,
      );

      const result = await executeCanvasNavigate({
        surfaceId: 'surf-1',
        url: 'https://example.com',
      });
      const parsed = JSON.parse(result);
      expect(parsed.status).toBe('navigated');
      expect(parsed.url).toBe('https://example.com/');
      expect(processCanvasMessage).toHaveBeenCalledWith({
        type: 'navigate',
        surfaceId: 'surf-1',
        url: 'https://example.com/',
      });
    });

    it('rejects local file paths and non-http urls', async () => {
      const { getSurface, processCanvasMessage } = require('../../src/services/canvas/renderer');
      getSurface.mockImplementation((id: string) =>
        id === 'surf-1' ? { id: 'surf-1', state: 'active' } : undefined,
      );

      const result = await executeCanvasNavigate({
        surfaceId: 'surf-1',
        url: 'file:///tmp/index.html',
      });

      expect(result).toContain('Error');
      expect(result).toContain('http or https');
      expect(processCanvasMessage).not.toHaveBeenCalled();
    });

    it('falls back to the focused surface when alias id is wrong', async () => {
      const {
        getAllSurfaces,
        getFocusedCanvasSurfaceId,
        getSurface,
        processCanvasMessage,
      } = require('../../src/services/canvas/renderer');
      getAllSurfaces.mockReturnValueOnce([
        { id: 'surf-9', title: 'Focused Canvas', state: 'active' },
      ]);
      getFocusedCanvasSurfaceId.mockReturnValueOnce('surf-9');
      getSurface.mockImplementation((id: string) =>
        id === 'surf-9' ? { id: 'surf-9', state: 'active' } : undefined,
      );

      const result = await executeCanvasNavigate({
        canvas: 'wrong-name',
        url: 'https://example.com/app',
      } as any);
      const parsed = JSON.parse(result);

      expect(parsed.status).toBe('navigated');
      expect(parsed.surfaceId).toBe('surf-9');
      expect(parsed.note).toContain('Using focused surface');
      expect(processCanvasMessage).toHaveBeenCalledWith({
        type: 'navigate',
        surfaceId: 'surf-9',
        url: 'https://example.com/app',
      });
    });
  });


  describe('executeCanvasEval', () => {
    it('returns JSON error for non-existent surface', async () => {
      const result = await executeCanvasEval({ surfaceId: 'none', script: 'alert(1)' });
      const parsed = JSON.parse(result);
      expect(parsed.status).toBe('error');
      expect(parsed.error).toContain('unable to find canvas surface');
    });

    it('dispatches eval for existing surface', async () => {
      const { getSurface, requestCanvasEval } = require('../../src/services/canvas/renderer');
      getSurface.mockImplementation((id: string) =>
        id === 'surf-1' ? { id: 'surf-1', title: 'Test' } : undefined,
      );
      requestCanvasEval.mockResolvedValueOnce(
        JSON.stringify({ status: 'eval_completed', surfaceId: 'surf-1', result: '42' }),
      );

      const result = await executeCanvasEval({ surfaceId: 'surf-1', script: 'return 42' });
      const parsed = JSON.parse(result);
      expect(parsed.status).toBe('eval_completed');
      expect(requestCanvasEval).toHaveBeenCalledWith('surf-1', 'return 42');
    });

    it('accepts the code alias and focused surface fallback', async () => {
      const {
        getAllSurfaces,
        getFocusedCanvasSurfaceId,
        getSurface,
        requestCanvasEval,
      } = require('../../src/services/canvas/renderer');
      getAllSurfaces.mockReturnValueOnce([{ id: 'surf-1', title: 'Test', state: 'active' }]);
      getFocusedCanvasSurfaceId.mockReturnValueOnce('surf-1');
      getSurface.mockImplementation((id: string) =>
        id === 'surf-1' ? { id: 'surf-1', title: 'Test' } : undefined,
      );
      requestCanvasEval.mockResolvedValueOnce(
        JSON.stringify({ status: 'eval_completed', surfaceId: 'surf-1', result: 'ok' }),
      );

      const result = await executeCanvasEval({
        surface: 'missing-surface',
        code: 'document.title',
      } as any);
      const parsed = JSON.parse(result);

      expect(parsed.status).toBe('eval_completed');
      expect(parsed.note).toContain('Using focused surface');
      expect(requestCanvasEval).toHaveBeenCalledWith('surf-1', 'document.title');
    });

    it('returns a JSON error when script is missing', async () => {
      const { getSurface } = require('../../src/services/canvas/renderer');
      getSurface.mockImplementation((id: string) =>
        id === 'surf-1' ? { id: 'surf-1', title: 'Test' } : undefined,
      );

      const result = await executeCanvasEval({ surfaceId: 'surf-1' } as any);
      const parsed = JSON.parse(result);

      expect(parsed.status).toBe('error');
      expect(parsed.error).toContain('script');
    });
  });

  describe('executeCanvasList', () => {
    it('lists existing surfaces and returns edit guidance', async () => {
      const {
        getAllSurfaces,
        getFocusedCanvasSurfaceId,
      } = require('../../src/services/canvas/renderer');
      getAllSurfaces.mockReturnValueOnce([
        {
          id: 'surf-1',
          title: 'Draft Board',
          state: 'active',
          renderMode: 'components',
          components: [{ id: 'c1', type: 'text', props: { text: 'Hello' } }],
          dataModel: { mode: 'draft' },
        },
      ]);
      getFocusedCanvasSurfaceId.mockReturnValueOnce('surf-1');

      const result = await executeCanvasList({});
      const parsed = JSON.parse(result);

      expect(parsed.status).toBe('listed');
      expect(parsed.count).toBe(1);
      expect(parsed.focusedSurfaceId).toBe('surf-1');
      expect(parsed.surfaces[0]).toMatchObject({
        surfaceId: 'surf-1',
        title: 'Draft Board',
        componentCount: 1,
        dataKeys: ['mode'],
        isFocused: true,
      });
      expect(parsed.guidance).toContain('canvas_update');
      expect(parsed.guidance).toContain('canvas_read');
      expect(parsed.guidance).toContain('avoid unrelated workspace file tools');
    });
  });

  describe('executeCanvasRead', () => {
    it('reads canvas content for an existing surface', async () => {
      const { getSurface, requestCanvasRead } = require('../../src/services/canvas/renderer');
      getSurface.mockImplementation((id: string) =>
        id === 'surf-1' ? { id: 'surf-1', title: 'Read Test' } : undefined,
      );
      requestCanvasRead.mockResolvedValueOnce(
        JSON.stringify({
          status: 'read_completed',
          surfaceId: 'surf-1',
          modeUsed: 'source',
          contentType: 'raw_html',
          content: '<html><body>Read me</body></html>',
        }),
      );

      const result = await executeCanvasRead({ surfaceId: 'surf-1' });
      const parsed = JSON.parse(result);

      expect(parsed.status).toBe('read_completed');
      expect(parsed.contentType).toBe('raw_html');
      expect(requestCanvasRead).toHaveBeenCalledWith('surf-1', {
        mode: 'auto',
        maxChars: undefined,
      });
    });

    it('accepts aliases and focused-surface fallback', async () => {
      const {
        getAllSurfaces,
        getFocusedCanvasSurfaceId,
        getSurface,
        requestCanvasRead,
      } = require('../../src/services/canvas/renderer');
      getAllSurfaces.mockReturnValueOnce([
        { id: 'surf-3', title: 'Live Preview', state: 'active' },
      ]);
      getFocusedCanvasSurfaceId.mockReturnValueOnce('surf-3');
      getSurface.mockImplementation((id: string) =>
        id === 'surf-3' ? { id: 'surf-3', title: 'Live Preview' } : undefined,
      );
      requestCanvasRead.mockResolvedValueOnce(
        JSON.stringify({
          status: 'read_completed',
          surfaceId: 'surf-3',
          modeUsed: 'dom',
          contentType: 'live_dom',
          content: '<html>dom</html>',
        }),
      );

      const result = await executeCanvasRead({
        canvas: 'missing-surface',
        readMode: 'dom',
        maxLength: 4096,
      } as any);
      const parsed = JSON.parse(result);

      expect(parsed.status).toBe('read_completed');
      expect(parsed.note).toContain('Using focused surface');
      expect(requestCanvasRead).toHaveBeenCalledWith('surf-3', { mode: 'dom', maxChars: 4096 });
    });
  });


  describe('executeCanvasSnapshot', () => {
    it('returns error for non-existent surface', async () => {
      const { requestCanvasSnapshot } = require('../../src/services/canvas/renderer');
      requestCanvasSnapshot.mockResolvedValueOnce(`Error: surface not found: none`);

      const result = await executeCanvasSnapshot({ surfaceId: 'none' });
      expect(result).toContain('Error');
    });

    it('requests snapshot with default format', async () => {
      const { getSurface, requestCanvasSnapshot } = require('../../src/services/canvas/renderer');
      getSurface.mockImplementation((id: string) =>
        id === 'surf-1' ? { id: 'surf-1', title: 'Snap' } : undefined,
      );
      requestCanvasSnapshot.mockResolvedValueOnce(
        JSON.stringify({ status: 'snapshot_captured', surfaceId: 'surf-1', format: 'png' }),
      );

      const result = await executeCanvasSnapshot({ surfaceId: 'surf-1' });
      const parsed = JSON.parse(result);
      expect(parsed.status).toBe('snapshot_captured');
      expect(requestCanvasSnapshot).toHaveBeenCalledWith('surf-1', 'png', undefined);
    });

    it('requests snapshot with jpeg format', async () => {
      const { getSurface, requestCanvasSnapshot } = require('../../src/services/canvas/renderer');
      getSurface.mockImplementation((id: string) =>
        id === 'surf-1' ? { id: 'surf-1', title: 'Snap' } : undefined,
      );
      requestCanvasSnapshot.mockResolvedValueOnce(
        JSON.stringify({ status: 'snapshot_captured', surfaceId: 'surf-1', format: 'jpeg' }),
      );

      const result = await executeCanvasSnapshot({
        surfaceId: 'surf-1',
        format: 'jpeg',
        quality: 0.5,
      });
      const parsed = JSON.parse(result);
      expect(requestCanvasSnapshot).toHaveBeenCalledWith('surf-1', 'jpeg', 0.5);
      expect(parsed.status).toBe('snapshot_captured');
    });

    it('reuses the focused surface when no explicit id is supplied', async () => {
      const {
        getAllSurfaces,
        getFocusedCanvasSurfaceId,
        getSurface,
        requestCanvasSnapshot,
      } = require('../../src/services/canvas/renderer');
      getAllSurfaces.mockReturnValueOnce([{ id: 'surf-7', title: 'Preview', state: 'active' }]);
      getFocusedCanvasSurfaceId.mockReturnValueOnce('surf-7');
      getSurface.mockImplementation((id: string) =>
        id === 'surf-7' ? { id: 'surf-7', title: 'Preview' } : undefined,
      );
      requestCanvasSnapshot.mockResolvedValueOnce(
        JSON.stringify({ status: 'snapshot_captured', surfaceId: 'surf-7', format: 'png' }),
      );

      const result = await executeCanvasSnapshot({} as any);
      const parsed = JSON.parse(result);

      expect(parsed.status).toBe('snapshot_captured');
      expect(parsed.note).toContain('Using focused surface');
      expect(requestCanvasSnapshot).toHaveBeenCalledWith('surf-7', 'png', undefined);
    });
  });
});
