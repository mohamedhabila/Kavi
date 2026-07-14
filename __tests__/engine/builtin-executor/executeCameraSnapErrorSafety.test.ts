// ---------------------------------------------------------------------------
// Tests - Builtin Tool Executor: executeCameraSnap — error safety
// ---------------------------------------------------------------------------

import { executeCameraSnap } from '../../helpers/builtinExecutorHarness';
import { parseFailedToolOutcome } from '../../helpers/toolRuntimeOutcome';

describe('Builtin Tool Executor', () => {
  describe('executeCameraSnap — error safety', () => {
    it('handles non-Error thrown objects', async () => {
      const ImagePicker = require('expo-image-picker');
      ImagePicker.launchCameraAsync.mockRejectedValueOnce({ code: 'PERMS' });
      const result = await executeCameraSnap({});
      const parsed = parseFailedToolOutcome(result);
      expect(parsed.status).toBe('error');
      expect(typeof parsed.error).toBe('string');
    });
  });
});
