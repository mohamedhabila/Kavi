import { processCanvasMessage, getSurface, getAllSurfaces, getActiveSurfaces, renderSurfaceToHtml, deleteSurface, clearAllSurfaces, hydrateCanvasSurfaces, setCanvasEventHandler } from '../../src/services/canvas/renderer';
import type { ServerToClientMessage } from '../../src/services/canvas/types';
import AsyncStorage from '@react-native-async-storage/async-storage';

describe('Canvas Renderer', () => {
  beforeEach(() => {
    clearAllSurfaces();
    setCanvasEventHandler({});
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue(null);
    (AsyncStorage.setItem as jest.Mock).mockResolvedValue(undefined);
  });
  describe('processCanvasMessage', () => {
    it('creates a surface', () => {
      const msg: ServerToClientMessage = {
        type: 'createSurface',
        surfaceId: 'surf-1',
        title: 'Test Surface',
        components: [{ id: 'c1', type: 'text', props: { text: 'Hello' } }],
      };
      processCanvasMessage(msg);
      const surface = getSurface('surf-1');
      expect(surface).toBeDefined();
      expect(surface!.title).toBe('Test Surface');
      expect(surface!.components).toHaveLength(1);
    });

    it('updates components of an existing surface', () => {
      processCanvasMessage({
        type: 'createSurface',
        surfaceId: 's2',
        title: 'S2',
        components: [{ id: 'c1', type: 'text', props: { text: 'v1' } }],
      });
      processCanvasMessage({
        type: 'updateComponents',
        surfaceId: 's2',
        components: [
          { id: 'c1', type: 'text', props: { text: 'v2' } },
          { id: 'c2', type: 'button', props: { label: 'Click' } },
        ],
      });
      const surface = getSurface('s2');
      expect(surface!.components).toHaveLength(2);
      expect(surface!.components[0].props.text).toBe('v2');
    });

    it('ignores updateComponents for non-existent surface', () => {
      processCanvasMessage({
        type: 'updateComponents',
        surfaceId: 'nope',
        components: [],
      });
      expect(getSurface('nope')).toBeUndefined();
    });

    it('deletes a surface', () => {
      processCanvasMessage({
        type: 'createSurface',
        surfaceId: 'del-1',
        title: 'Delete Me',
        components: [],
      });
      expect(getSurface('del-1')).toBeDefined();
      processCanvasMessage({ type: 'deleteSurface', surfaceId: 'del-1' });
      expect(getSurface('del-1')).toBeUndefined();
    });

    it('applies data model operations', () => {
      processCanvasMessage({
        type: 'createSurface',
        surfaceId: 'dm-1',
        title: 'Data',
        components: [],
        dataModel: { count: 0 },
      });
      processCanvasMessage({
        type: 'updateDataModel',
        surfaceId: 'dm-1',
        operations: [{ op: 'replace', path: '/count', value: 42 }],
      });
      const surface = getSurface('dm-1');
      expect(surface!.dataModel).toEqual({ count: 42 });
    });
  });
  describe('getAllSurfaces / getActiveSurfaces', () => {
    it('returns all created surfaces', () => {
      processCanvasMessage({ type: 'createSurface', surfaceId: 'a', title: 'A', components: [] });
      processCanvasMessage({ type: 'createSurface', surfaceId: 'b', title: 'B', components: [] });
      expect(getAllSurfaces()).toHaveLength(2);
    });

    it('getActiveSurfaces excludes deleted', () => {
      processCanvasMessage({ type: 'createSurface', surfaceId: 'a', title: 'A', components: [] });
      processCanvasMessage({ type: 'createSurface', surfaceId: 'b', title: 'B', components: [] });
      processCanvasMessage({ type: 'deleteSurface', surfaceId: 'a' });
      const active = getActiveSurfaces();
      expect(active).toHaveLength(1);
      expect(active[0].id).toBe('b');
    });
  });
  describe('deleteSurface', () => {
    it('removes by id', () => {
      processCanvasMessage({ type: 'createSurface', surfaceId: 'x', title: 'X', components: [] });
      deleteSurface('x');
      expect(getSurface('x')).toBeUndefined();
    });

    it('no-op for non-existent surface', () => {
      expect(() => deleteSurface('nope')).not.toThrow();
    });
  });
  describe('clearAllSurfaces', () => {
    it('clears everything', () => {
      processCanvasMessage({ type: 'createSurface', surfaceId: 'a', title: 'A', components: [] });
      processCanvasMessage({ type: 'createSurface', surfaceId: 'b', title: 'B', components: [] });
      clearAllSurfaces();
      expect(getAllSurfaces()).toHaveLength(0);
    });
  });
  describe('persistence', () => {
    it('persists surfaces when they change', () => {
      processCanvasMessage({
        type: 'createSurface',
        surfaceId: 'persist-1',
        title: 'Persisted',
        components: [],
      });

      expect(AsyncStorage.setItem).toHaveBeenCalledWith(
        'kavi_canvas_surfaces_v1',
        expect.stringContaining('persist-1'),
      );
    });

    it('hydrates persisted surfaces from storage', async () => {
      (AsyncStorage.getItem as jest.Mock).mockResolvedValueOnce(
        JSON.stringify([
          {
            id: 'stored-1',
            catalogId: 'default',
            title: 'Stored Surface',
            state: 'active',
            renderMode: 'components',
            components: [],
            dataModel: {},
            createdAt: 123,
          },
        ]),
      );

      await hydrateCanvasSurfaces();

      expect(getSurface('stored-1')?.title).toBe('Stored Surface');
    });
  });
  describe('renderSurfaceToHtml', () => {
    it('returns null for non-existent surface', () => {
      expect(renderSurfaceToHtml('nope')).toBeNull();
    });

    it('renders a valid HTML page', () => {
      processCanvasMessage({
        type: 'createSurface',
        surfaceId: 'html-1',
        title: 'HTML Test',
        components: [
          { id: 'h1', type: 'heading', props: { text: 'Title', level: 1 } },
          { id: 't1', type: 'text', props: { text: 'Hello world' } },
          { id: 'b1', type: 'button', props: { label: 'Click Me', action: 'doStuff' } },
        ],
      });
      const html = renderSurfaceToHtml('html-1');
      expect(html).toContain('<!DOCTYPE html>');
      expect(html).toContain('Title');
      expect(html).toContain('Hello world');
      expect(html).toContain('Click Me');
    });

    it('renders text component', () => {
      processCanvasMessage({
        type: 'createSurface',
        surfaceId: 'r1',
        title: 'T',
        components: [{ id: 'c1', type: 'text', props: { text: 'Some text' } }],
      });
      const html = renderSurfaceToHtml('r1');
      expect(html).toContain('Some text');
    });

    it('renders image component', () => {
      processCanvasMessage({
        type: 'createSurface',
        surfaceId: 'r2',
        title: 'T',
        components: [
          { id: 'c1', type: 'image', props: { src: 'https://example.com/img.png', alt: 'test' } },
        ],
      });
      const html = renderSurfaceToHtml('r2');
      expect(html).toContain('img');
      expect(html).toContain('https://example.com/img.png');
    });

    it('renders input component', () => {
      processCanvasMessage({
        type: 'createSurface',
        surfaceId: 'r3',
        title: 'T',
        components: [{ id: 'c1', type: 'input', props: { placeholder: 'Type here' } }],
      });
      const html = renderSurfaceToHtml('r3');
      expect(html).toContain('input');
      expect(html).toContain('Type here');
    });

    it('renders card component', () => {
      processCanvasMessage({
        type: 'createSurface',
        surfaceId: 'r4',
        title: 'T',
        components: [{ id: 'c1', type: 'card', props: {} }],
      });
      const html = renderSurfaceToHtml('r4');
      expect(html).toContain('card');
    });

    it('renders progress component', () => {
      processCanvasMessage({
        type: 'createSurface',
        surfaceId: 'r5',
        title: 'T',
        components: [{ id: 'c1', type: 'progress', props: { value: 75, max: 100 } }],
      });
      const html = renderSurfaceToHtml('r5');
      expect(html).toContain('75');
    });

    it('renders divider component', () => {
      processCanvasMessage({
        type: 'createSurface',
        surfaceId: 'r6',
        title: 'T',
        components: [{ id: 'c1', type: 'divider', props: {} }],
      });
      const html = renderSurfaceToHtml('r6');
      expect(html).toContain('hr');
    });

    it('renders badge component', () => {
      processCanvasMessage({
        type: 'createSurface',
        surfaceId: 'r7',
        title: 'T',
        components: [{ id: 'c1', type: 'badge', props: { text: 'New' } }],
      });
      const html = renderSurfaceToHtml('r7');
      expect(html).toContain('New');
    });

    it('renders textarea component', () => {
      processCanvasMessage({
        type: 'createSurface',
        surfaceId: 'r8',
        title: 'T',
        components: [
          {
            id: 'c1',
            type: 'textarea',
            props: { placeholder: 'Enter text', rows: 5, value: 'Hi' },
          },
        ],
      });
      const html = renderSurfaceToHtml('r8');
      expect(html).toContain('textarea');
      expect(html).toContain('Enter text');
    });

    it('renders row component with children', () => {
      processCanvasMessage({
        type: 'createSurface',
        surfaceId: 'r9',
        title: 'T',
        components: [
          {
            id: 'c1',
            type: 'row',
            props: {},
            children: [
              { id: 'c2', type: 'text', props: { text: 'Left' } },
              { id: 'c3', type: 'text', props: { text: 'Right' } },
            ],
          },
        ],
      });
      const html = renderSurfaceToHtml('r9');
      expect(html).toContain('Left');
      expect(html).toContain('Right');
      expect(html).toContain('row');
    });

    it('renders list component with items', () => {
      processCanvasMessage({
        type: 'createSurface',
        surfaceId: 'r10',
        title: 'T',
        components: [
          {
            id: 'c1',
            type: 'list',
            props: {},
            children: [
              { id: 'i1', type: 'text', props: { text: 'Item 1' } },
              { id: 'i2', type: 'text', props: { text: 'Item 2' } },
            ],
          },
        ],
      });
      const html = renderSurfaceToHtml('r10');
      expect(html).toContain('Item 1');
      expect(html).toContain('Item 2');
      expect(html).toContain('list-item');
    });

    it('renders spacer component', () => {
      processCanvasMessage({
        type: 'createSurface',
        surfaceId: 'r11',
        title: 'T',
        components: [{ id: 'c1', type: 'spacer', props: {} }],
      });
      const html = renderSurfaceToHtml('r11');
      expect(html).toContain('spacer');
    });

    it('renders container/default component', () => {
      processCanvasMessage({
        type: 'createSurface',
        surfaceId: 'r12',
        title: 'T',
        components: [
          {
            id: 'c1',
            type: 'container',
            props: {},
            children: [{ id: 'c2', type: 'text', props: { text: 'Inside' } }],
          },
        ],
      });
      const html = renderSurfaceToHtml('r12');
      expect(html).toContain('Inside');
    });

    it('renders unknown component type as container', () => {
      processCanvasMessage({
        type: 'createSurface',
        surfaceId: 'r13',
        title: 'T',
        components: [{ id: 'c1', type: 'unknown' as any, props: {} }],
      });
      const html = renderSurfaceToHtml('r13');
      expect(html).toContain('container');
    });

    it('accepts surface object directly', () => {
      processCanvasMessage({
        type: 'createSurface',
        surfaceId: 'direct-1',
        title: 'Direct',
        components: [{ id: 'c1', type: 'text', props: { text: 'Direct render' } }],
      });
      const surface = getSurface('direct-1')!;
      const html = renderSurfaceToHtml(surface);
      expect(html).toContain('Direct render');
    });

    it('resolves data bindings in components', () => {
      processCanvasMessage({
        type: 'createSurface',
        surfaceId: 'bind-1',
        title: 'Bound',
        components: [
          {
            id: 'c1',
            type: 'text',
            props: { text: 'default' },
            dataBindings: { text: 'title' },
          },
        ],
        dataModel: { title: 'Bound Value' },
      });
      const html = renderSurfaceToHtml('bind-1');
      expect(html).toContain('Bound Value');
    });

    it('escapes HTML in text', () => {
      processCanvasMessage({
        type: 'createSurface',
        surfaceId: 'esc-1',
        title: 'T',
        components: [{ id: 'c1', type: 'text', props: { text: '<b>bold</b>' } }],
      });
      const html = renderSurfaceToHtml('esc-1');
      expect(html).toContain('&lt;b&gt;bold&lt;/b&gt;');
    });

    it('clamps progress value between 0 and 100', () => {
      processCanvasMessage({
        type: 'createSurface',
        surfaceId: 'prog-1',
        title: 'T',
        components: [{ id: 'c1', type: 'progress', props: { value: 150 } }],
      });
      const html = renderSurfaceToHtml('prog-1');
      expect(html).toContain('width:100%');
    });
  });
  describe('data model operations', () => {
    it('handles add operation', () => {
      processCanvasMessage({
        type: 'createSurface',
        surfaceId: 'dm-add',
        title: 'DM',
        components: [],
        dataModel: {},
      });
      processCanvasMessage({
        type: 'updateDataModel',
        surfaceId: 'dm-add',
        operations: [{ op: 'add', path: '/newKey', value: 'hello' }],
      });
      expect(getSurface('dm-add')!.dataModel.newKey).toBe('hello');
    });

    it('handles remove operation', () => {
      processCanvasMessage({
        type: 'createSurface',
        surfaceId: 'dm-rm',
        title: 'DM',
        components: [],
        dataModel: { removeMe: 'yes' },
      });
      processCanvasMessage({
        type: 'updateDataModel',
        surfaceId: 'dm-rm',
        operations: [{ op: 'remove', path: '/removeMe' }],
      });
      expect(getSurface('dm-rm')!.dataModel.removeMe).toBeUndefined();
    });

    it('handles nested path', () => {
      processCanvasMessage({
        type: 'createSurface',
        surfaceId: 'dm-nest',
        title: 'DM',
        components: [],
        dataModel: { root: {} },
      });
      processCanvasMessage({
        type: 'updateDataModel',
        surfaceId: 'dm-nest',
        operations: [{ op: 'add', path: '/root/child', value: 42 }],
      });
      expect(getSurface('dm-nest')!.dataModel.root.child).toBe(42);
    });

    it('ignores updateDataModel for non-existent surface', () => {
      processCanvasMessage({
        type: 'updateDataModel',
        surfaceId: 'nosurf',
        operations: [{ op: 'add', path: '/key', value: 1 }],
      });
      expect(getSurface('nosurf')).toBeUndefined();
    });
  });
});
