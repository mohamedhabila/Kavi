// ---------------------------------------------------------------------------
// Tests - Builtin Tool Executor: executeCanvasEval
// ---------------------------------------------------------------------------

import { executeCanvasEval } from '../../helpers/builtinExecutorHarness';

describe('Builtin Tool Executor', () => {
  describe('executeCanvasEval', () => {
    it('returns error for non-existent surface', async () => {
      const result = await executeCanvasEval({ surfaceId: 'missing', script: 'console.log(1)' });
      const parsed = JSON.parse(result);
      expect(parsed.status).toBe('error');
      expect(parsed.error).toContain('unable to find canvas surface');
    });

    it('evaluates script on existing surface', async () => {
      const { getSurface } = require('../../../src/services/canvas/renderer');
      getSurface.mockImplementation((id: string) =>
        id === 'surf-1' ? { id: 'surf-1', title: 'Test' } : undefined,
      );
      const result = await executeCanvasEval({ surfaceId: 'surf-1', script: '1+1' });
      expect(result).toBe('eval_result');
    });

    it('catches eval errors and returns JSON', async () => {
      const { getSurface, requestCanvasEval } = require('../../../src/services/canvas/renderer');
      getSurface.mockImplementation((id: string) =>
        id === 'surf-1' ? { id: 'surf-1', title: 'Test' } : undefined,
      );
      requestCanvasEval.mockRejectedValueOnce(new Error('eval syntax error'));
      const result = await executeCanvasEval({ surfaceId: 'surf-1', script: 'bad((' });
      const parsed = JSON.parse(result);
      expect(parsed.status).toBe('error');
      expect(parsed.error).toBe('eval syntax error');
    });
  });
});
