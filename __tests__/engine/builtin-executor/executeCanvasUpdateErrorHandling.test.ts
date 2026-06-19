// ---------------------------------------------------------------------------
// Tests - Builtin Tool Executor: executeCanvasUpdate — error handling
// ---------------------------------------------------------------------------

import { executeCanvasUpdate } from '../../helpers/builtinExecutorHarness';

describe('Builtin Tool Executor', () => {
  describe('executeCanvasUpdate — error handling', () => {
    it('catches processCanvasMessage errors and returns JSON error', async () => {
      const { getSurface, processCanvasMessage } = require('../../../src/services/canvas/renderer');
      getSurface.mockImplementation((id: string) =>
        id === 'surf-1' ? { id: 'surf-1', title: 'Test' } : undefined,
      );
      processCanvasMessage.mockImplementationOnce(() => {
        throw new Error('render crash');
      });
      const result = await executeCanvasUpdate({
        surfaceId: 'surf-1',
        components: [{ id: 'c1', type: 'text', props: { text: 'v2' } }],
      });
      const parsed = JSON.parse(result);
      expect(parsed.status).toBe('error');
      expect(parsed.error).toBe('render crash');
    });
  });
});
