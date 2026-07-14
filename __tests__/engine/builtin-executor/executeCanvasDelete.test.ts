// ---------------------------------------------------------------------------
// Tests - Builtin Tool Executor: executeCanvasDelete
// ---------------------------------------------------------------------------

import { executeCanvasDelete } from '../../helpers/builtinExecutorHarness';
import { parseCompletedToolOutcome } from '../../helpers/toolRuntimeOutcome';

describe('Builtin Tool Executor', () => {
  describe('executeCanvasDelete', () => {
    it('deletes a surface', async () => {
      const { getSurface } = require('../../../src/services/canvas/renderer');
      getSurface.mockImplementation((id: string) =>
        id === 'any-surface' ? { id: 'any-surface', title: 'Delete Me' } : undefined,
      );

      const result = await executeCanvasDelete({ surfaceId: 'any-surface' });
      const parsed = parseCompletedToolOutcome(result);
      expect(parsed.status).toBe('deleted');
    });
  });
});
