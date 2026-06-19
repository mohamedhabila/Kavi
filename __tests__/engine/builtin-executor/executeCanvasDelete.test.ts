// ---------------------------------------------------------------------------
// Tests - Builtin Tool Executor: executeCanvasDelete
// ---------------------------------------------------------------------------

import { executeCanvasDelete } from '../../helpers/builtinExecutorHarness';

describe('Builtin Tool Executor', () => {
  describe('executeCanvasDelete', () => {
    it('deletes a surface', async () => {
      const { getSurface } = require('../../../src/services/canvas/renderer');
      getSurface.mockImplementation((id: string) =>
        id === 'any-surface' ? { id: 'any-surface', title: 'Delete Me' } : undefined,
      );

      const result = await executeCanvasDelete({ surfaceId: 'any-surface' });
      const parsed = JSON.parse(result);
      expect(parsed.status).toBe('deleted');
    });
  });
});
