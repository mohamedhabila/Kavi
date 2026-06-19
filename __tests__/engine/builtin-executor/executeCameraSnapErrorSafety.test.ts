// ---------------------------------------------------------------------------
// Tests - Builtin Tool Executor: executeCameraSnap — error safety
// ---------------------------------------------------------------------------

import { executeCameraSnap } from '../../helpers/builtinExecutorHarness';

describe('Builtin Tool Executor', () => {
  describe('executeCameraSnap — error safety', () => {
    it('handles non-Error thrown objects', async () => {
      const ImagePicker = require('expo-image-picker');
      ImagePicker.launchCameraAsync.mockRejectedValueOnce({ code: 'PERMS' });
      const result = await executeCameraSnap({});
      const parsed = JSON.parse(result);
      expect(parsed.status).toBe('error');
      expect(typeof parsed.error).toBe('string');
    });
  });
});
