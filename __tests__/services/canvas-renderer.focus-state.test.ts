import { closeCanvasSurface, processCanvasMessage, getFocusedCanvasSurfaceId, openCanvasSurface, clearAllSurfaces, setCanvasEventHandler } from '../../src/services/canvas/renderer';
import AsyncStorage from '@react-native-async-storage/async-storage';

describe('Canvas Renderer', () => {
  beforeEach(() => {
    clearAllSurfaces();
    setCanvasEventHandler({});
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue(null);
    (AsyncStorage.setItem as jest.Mock).mockResolvedValue(undefined);
  });
  describe('focus state', () => {
    it('focuses newly created and updated surfaces', () => {
      processCanvasMessage({
        type: 'createSurface',
        surfaceId: 'focus-1',
        title: 'Focus',
        components: [],
      });
      expect(getFocusedCanvasSurfaceId()).toBe('focus-1');

      processCanvasMessage({
        type: 'updateComponents',
        surfaceId: 'focus-1',
        components: [{ id: 'c1', type: 'text', props: { text: 'Updated' } }],
      });
      expect(getFocusedCanvasSurfaceId()).toBe('focus-1');
    });

    it('supports manually opening and closing focused surfaces', () => {
      processCanvasMessage({
        type: 'createSurface',
        surfaceId: 'focus-2',
        title: 'Manual',
        components: [],
      });
      closeCanvasSurface();
      expect(getFocusedCanvasSurfaceId()).toBeNull();

      openCanvasSurface('focus-2');
      expect(getFocusedCanvasSurfaceId()).toBe('focus-2');

      closeCanvasSurface();
      expect(getFocusedCanvasSurfaceId()).toBeNull();
    });
  });
});
