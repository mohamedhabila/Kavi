import { processCanvasMessage, getSurface, renderSurfaceToHtml, clearAllSurfaces, requestCanvasRead, resolveCanvasRead, setCanvasEventHandler } from '../../src/services/canvas/renderer';
import AsyncStorage from '@react-native-async-storage/async-storage';

describe('Canvas Renderer', () => {
  beforeEach(() => {
    clearAllSurfaces();
    setCanvasEventHandler({});
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue(null);
    (AsyncStorage.setItem as jest.Mock).mockResolvedValue(undefined);
  });
  describe('setCanvasEventHandler', () => {
    it('calls handler on surface created', () => {
      const { setCanvasEventHandler } = require('../../src/services/canvas/renderer');
      const handler = { onSurfaceCreated: jest.fn() };
      setCanvasEventHandler(handler);
      processCanvasMessage({ type: 'createSurface', surfaceId: 'ev1', title: 'T', components: [] });
      expect(handler.onSurfaceCreated).toHaveBeenCalled();
      setCanvasEventHandler({});
    });
  });
  describe('requestCanvasEval', () => {
    const {
      requestCanvasEval,
      resolveCanvasEval,
      setCanvasEventHandler: setHandler,
    } = require('../../src/services/canvas/renderer');

    beforeEach(() => {
      clearAllSurfaces();
      setHandler({});
    });

    it('returns error for non-existent surface', async () => {
      const result = await requestCanvasEval('no-such-surface', 'code');
      expect(result).toContain('Error: surface not found');
    });

    it('resolves immediately when no event handler is registered', async () => {
      processCanvasMessage({
        type: 'createSurface',
        surfaceId: 'ev-test',
        title: 'T',
        components: [],
      });
      const result = await requestCanvasEval('ev-test', '1+1');
      const parsed = JSON.parse(result);
      expect(parsed.status).toBe('eval_dispatched');
      expect(parsed.note).toContain('Canvas preview is not available yet');
    });

    it('calls onEval handler and resolves when result arrives', async () => {
      processCanvasMessage({ type: 'createSurface', surfaceId: 'ev2', title: 'T', components: [] });
      const onEval = jest.fn();
      setHandler({ onEval });

      const promise = requestCanvasEval('ev2', 'document.title');
      expect(onEval).toHaveBeenCalledWith('ev2', 'document.title');

      resolveCanvasEval('ev2', 'My Title');
      const result = await promise;
      const parsed = JSON.parse(result);
      expect(parsed.status).toBe('eval_completed');
      expect(parsed.result).toBe('My Title');
      setHandler({});
    });

    it('times out if result never arrives', async () => {
      jest.useFakeTimers();
      processCanvasMessage({ type: 'createSurface', surfaceId: 'ev3', title: 'T', components: [] });
      setHandler({ onEval: jest.fn() });

      const promise = requestCanvasEval('ev3', 'slowOp()');
      jest.advanceTimersByTime(11_000);
      const result = await promise;
      const parsed = JSON.parse(result);
      expect(parsed.status).toBe('timeout');
      jest.useRealTimers();
      setHandler({});
    });

    it('resolveCanvasEval ignores unknown surfaceId', () => {
      // Should not throw
      resolveCanvasEval('unknown-surface', 'value');
    });
  });
  describe('requestCanvasRead', () => {
    beforeEach(() => {
      clearAllSurfaces();
      setCanvasEventHandler({});
    });

    it('returns stored raw HTML for HTML-mode surfaces', async () => {
      processCanvasMessage({
        type: 'createSurface',
        surfaceId: 'read-html',
        title: 'HTML Surface',
        rawHtml: '<html><body><h1>Hello</h1></body></html>',
        sourceBundle: {
          sourceType: 'directory',
          directoryPath: 'canvas/app',
          entryFilePath: 'canvas/app/index.html',
          importedFiles: ['canvas/app/index.html', 'canvas/app/styles.css', 'canvas/app/app.js'],
        },
        components: [],
      });

      const result = await requestCanvasRead('read-html');
      const parsed = JSON.parse(result);

      expect(parsed.status).toBe('read_completed');
      expect(parsed.contentType).toBe('raw_html');
      expect(parsed.modeUsed).toBe('source');
      expect(parsed.content).toContain('<h1>Hello</h1>');
      expect(parsed.sourceBundle).toEqual({
        sourceType: 'directory',
        directoryPath: 'canvas/app',
        entryFilePath: 'canvas/app/index.html',
        importedFiles: ['canvas/app/index.html', 'canvas/app/styles.css', 'canvas/app/app.js'],
      });
    });

    it('returns generated HTML and structured metadata for component surfaces', async () => {
      processCanvasMessage({
        type: 'createSurface',
        surfaceId: 'read-components',
        title: 'Component Surface',
        components: [{ id: 'c1', type: 'text', props: { text: 'Hello world' } }],
        dataModel: { mode: 'draft' },
      });

      const result = await requestCanvasRead('read-components', { mode: 'source' });
      const parsed = JSON.parse(result);

      expect(parsed.status).toBe('read_completed');
      expect(parsed.contentType).toBe('generated_html');
      expect(parsed.content).toContain('Hello world');
      expect(parsed.components).toHaveLength(1);
      expect(parsed.dataModel).toEqual({ mode: 'draft' });
    });

    it('falls back to URL metadata when live DOM is unavailable', async () => {
      processCanvasMessage({
        type: 'createSurface',
        surfaceId: 'read-url',
        title: 'URL Surface',
        components: [],
      });
      processCanvasMessage({
        type: 'navigate',
        surfaceId: 'read-url',
        url: 'https://example.com/app',
      });

      const result = await requestCanvasRead('read-url');
      const parsed = JSON.parse(result);

      expect(parsed.status).toBe('read_completed');
      expect(parsed.contentType).toBe('url');
      expect(parsed.url).toBe('https://example.com/app');
      expect(parsed.note).toContain('Live DOM read is not available');
    });

    it('calls onRead handler and resolves live DOM reads', async () => {
      const onRead = jest.fn((surfaceId: string) => {
        resolveCanvasRead(surfaceId, {
          content: '<html><body><main>Live DOM</main></body></html>',
          contentType: 'live_dom',
          title: 'Live DOM Title',
          url: 'https://example.com/live',
          contentLength: 46,
        });
      });
      setCanvasEventHandler({ onRead });

      processCanvasMessage({
        type: 'createSurface',
        surfaceId: 'read-live',
        title: 'Live Surface',
        components: [],
      });
      processCanvasMessage({
        type: 'navigate',
        surfaceId: 'read-live',
        url: 'https://example.com/live',
      });

      const result = await requestCanvasRead('read-live', { mode: 'dom', maxChars: 4096 });
      const parsed = JSON.parse(result);

      expect(parsed.status).toBe('read_completed');
      expect(parsed.modeUsed).toBe('dom');
      expect(parsed.contentType).toBe('live_dom');
      expect(parsed.title).toBe('Live DOM Title');
      expect(parsed.content).toContain('Live DOM');
      expect(onRead).toHaveBeenCalledWith('read-live', { mode: 'dom', maxChars: 4096 });
    });
  });
  describe('requestCanvasSnapshot', () => {
    const {
      requestCanvasSnapshot,
      resolveCanvasSnapshot,
      setCanvasEventHandler: setHandler,
    } = require('../../src/services/canvas/renderer');

    beforeEach(() => {
      clearAllSurfaces();
      setHandler({});
    });

    it('returns error for non-existent surface', async () => {
      const result = await requestCanvasSnapshot('no-surf', 'png');
      expect(result).toContain('Error: surface not found');
    });

    it('resolves immediately when no snapshot handler registered', async () => {
      processCanvasMessage({
        type: 'createSurface',
        surfaceId: 'snap1',
        title: 'T',
        components: [],
      });
      const result = await requestCanvasSnapshot('snap1', 'png');
      const parsed = JSON.parse(result);
      expect(parsed.status).toBe('snapshot_requested');
      expect(parsed.note).toContain('Canvas preview is not available yet');
    });

    it('calls onSnapshot handler and resolves when result arrives', async () => {
      processCanvasMessage({
        type: 'createSurface',
        surfaceId: 'snap2',
        title: 'T',
        components: [],
      });
      const onSnapshot = jest.fn();
      setHandler({ onSnapshot });

      const promise = requestCanvasSnapshot('snap2', 'jpeg', 0.8);
      expect(onSnapshot).toHaveBeenCalledWith('snap2', 'jpeg', 0.8);

      resolveCanvasSnapshot('snap2', { dataUri: 'data:image/jpeg;base64,abc' });
      const result = await promise;
      const parsed = JSON.parse(result);
      expect(parsed.status).toBe('snapshot_captured');
      expect(parsed.dataUri).toBe('data:image/jpeg;base64,abc');
      setHandler({});
    });

    it('times out if snapshot never provided', async () => {
      jest.useFakeTimers();
      processCanvasMessage({
        type: 'createSurface',
        surfaceId: 'snap3',
        title: 'T',
        components: [],
      });
      setHandler({ onSnapshot: jest.fn() });

      const promise = requestCanvasSnapshot('snap3', 'png');
      jest.advanceTimersByTime(16_000);
      const result = await promise;
      const parsed = JSON.parse(result);
      expect(parsed.status).toBe('timeout');
      jest.useRealTimers();
      setHandler({});
    });

    it('resolveCanvasSnapshot ignores unknown surfaceId', () => {
      resolveCanvasSnapshot('unknown-surface', { dataUri: 'data:x' });
    });

    it('truncates at valid base64 boundary', async () => {
      jest.useFakeTimers();
      processCanvasMessage({
        type: 'createSurface',
        surfaceId: 'b64-test',
        title: 'Base64 Test',
        components: [],
      });

      setHandler({
        onSnapshot: jest.fn(),
      });

      const promise = requestCanvasSnapshot('b64-test', 'png');

      // Create a data URI longer than 200000 chars
      const prefix = 'data:image/png;base64,';
      const padding = 'AAAA'.repeat(50100); // 200400 chars of base64
      const longDataUri = prefix + padding;

      resolveCanvasSnapshot('b64-test', { dataUri: longDataUri });
      const result = await promise;
      const parsed = JSON.parse(result);

      expect(parsed.status).toBe('snapshot_captured');
      const base64Payload = String(parsed.dataUri).split(',')[1] || '';
      expect(base64Payload.length % 4).toBe(0);
      // Should be at most 200000 chars
      expect(parsed.dataUri.length).toBeLessThanOrEqual(200_000);

      jest.useRealTimers();
      setHandler({});
    });

    it('does not truncate when data URI fits within limit', async () => {
      jest.useFakeTimers();
      processCanvasMessage({
        type: 'createSurface',
        surfaceId: 'b64-short',
        title: 'Short',
        components: [],
      });

      setHandler({
        onSnapshot: jest.fn(),
      });

      const promise = requestCanvasSnapshot('b64-short', 'png');
      const shortDataUri = 'data:image/png;base64,AAAA';

      resolveCanvasSnapshot('b64-short', { dataUri: shortDataUri });
      const result = await promise;
      const parsed = JSON.parse(result);

      expect(parsed.dataUri).toBe(shortDataUri);

      jest.useRealTimers();
      setHandler({});
    });
  });
  describe('updateContent (raw HTML update)', () => {
    it('updates rawHtml on an existing HTML-mode surface', () => {
      processCanvasMessage({
        type: 'createSurface',
        surfaceId: 'html-upd',
        title: 'HTML',
        rawHtml: '<h1>Original</h1>',
        components: [],
      });
      const before = getSurface('html-upd');
      expect(before!.renderMode).toBe('html');
      expect(before!.rawHtml).toBe('<h1>Original</h1>');

      processCanvasMessage({
        type: 'updateContent',
        surfaceId: 'html-upd',
        rawHtml: '<h1>Updated</h1>',
      });
      const after = getSurface('html-upd');
      expect(after!.rawHtml).toBe('<h1>Updated</h1>');
      expect(after!.renderMode).toBe('html');
    });

    it('switches a component-mode surface to html mode', () => {
      processCanvasMessage({
        type: 'createSurface',
        surfaceId: 'comp-to-html',
        title: 'Comp',
        components: [{ id: 'c1', type: 'text', props: { text: 'Hello' } }],
      });
      expect(getSurface('comp-to-html')!.renderMode).toBe('components');

      processCanvasMessage({
        type: 'updateContent',
        surfaceId: 'comp-to-html',
        rawHtml: '<div>Now HTML</div>',
      });
      const surface = getSurface('comp-to-html');
      expect(surface!.renderMode).toBe('html');
      expect(surface!.rawHtml).toBe('<div>Now HTML</div>');
    });

    it('renderSurfaceToHtml reflects updated rawHtml', () => {
      processCanvasMessage({
        type: 'createSurface',
        surfaceId: 'html-render-upd',
        title: 'HTML',
        rawHtml: '<body><p>V1</p></body>',
        components: [],
      });
      const html1 = renderSurfaceToHtml('html-render-upd');
      expect(html1).toContain('V1');

      processCanvasMessage({
        type: 'updateContent',
        surfaceId: 'html-render-upd',
        rawHtml: '<body><p>V2</p></body>',
      });
      const html2 = renderSurfaceToHtml('html-render-upd');
      expect(html2).toContain('V2');
      expect(html2).not.toContain('V1');
    });

    it('stores source bundle metadata for HTML-backed surfaces', () => {
      processCanvasMessage({
        type: 'createSurface',
        surfaceId: 'bundle-meta',
        title: 'Bundle Meta',
        rawHtml: '<body><p>V1</p></body>',
        sourceBundle: {
          sourceType: 'file',
          filePath: 'canvas/app/index.html',
          entryFilePath: 'canvas/app/index.html',
          importedFiles: ['canvas/app/index.html'],
        },
        components: [],
      });

      expect(getSurface('bundle-meta')?.sourceBundle).toEqual({
        sourceType: 'file',
        filePath: 'canvas/app/index.html',
        entryFilePath: 'canvas/app/index.html',
        importedFiles: ['canvas/app/index.html'],
      });

      processCanvasMessage({
        type: 'updateContent',
        surfaceId: 'bundle-meta',
        rawHtml: '<body><p>V2</p></body>',
        sourceBundle: {
          sourceType: 'directory',
          directoryPath: 'canvas/app',
          entryFilePath: 'canvas/app/index.html',
          importedFiles: ['canvas/app/index.html', 'canvas/app/app.js'],
        },
      });

      expect(getSurface('bundle-meta')?.sourceBundle).toEqual({
        sourceType: 'directory',
        directoryPath: 'canvas/app',
        entryFilePath: 'canvas/app/index.html',
        importedFiles: ['canvas/app/index.html', 'canvas/app/app.js'],
      });
    });

    it('ignores updateContent for non-existent surface', () => {
      processCanvasMessage({
        type: 'updateContent',
        surfaceId: 'nope',
        rawHtml: '<p>Nope</p>',
      });
      expect(getSurface('nope')).toBeUndefined();
    });
  });
  describe('updateComponents switches renderMode', () => {
    it('switches HTML-mode surface to components mode on updateComponents', () => {
      processCanvasMessage({
        type: 'createSurface',
        surfaceId: 'html-to-comp',
        title: 'HTML First',
        rawHtml: '<h1>HTML</h1>',
        sourceBundle: {
          sourceType: 'directory',
          directoryPath: 'canvas/app',
          entryFilePath: 'canvas/app/index.html',
          importedFiles: ['canvas/app/index.html'],
        },
        components: [],
      });
      expect(getSurface('html-to-comp')!.renderMode).toBe('html');

      processCanvasMessage({
        type: 'updateComponents',
        surfaceId: 'html-to-comp',
        components: [{ id: 'c1', type: 'text', props: { text: 'Now components' } }],
      });
      const surface = getSurface('html-to-comp');
      expect(surface!.renderMode).toBe('components');
      expect(surface!.rawHtml).toBeUndefined();
      expect(surface!.sourceBundle).toBeUndefined();
      const html = renderSurfaceToHtml('html-to-comp');
      expect(html).toContain('Now components');
      expect(html).toContain('<!DOCTYPE html>');
    });
  });
});
