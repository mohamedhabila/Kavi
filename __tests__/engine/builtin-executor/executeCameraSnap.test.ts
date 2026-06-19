// ---------------------------------------------------------------------------
// Tests - Builtin Tool Executor: executeCameraSnap
// ---------------------------------------------------------------------------

import { executeCameraSnap } from '../../helpers/builtinExecutorHarness';

describe('Builtin Tool Executor', () => {
  describe('executeCameraSnap', () => {
    it('takes a photo', async () => {
      const result = await executeCameraSnap({});
      const parsed = JSON.parse(result);
      expect(parsed.status).toBe('captured');
    });

    it('handles cancelled photo', async () => {
      const ImagePicker = require('expo-image-picker');
      ImagePicker.launchCameraAsync.mockResolvedValueOnce({ canceled: true, assets: [] });
      const result = await executeCameraSnap({});
      const parsed = JSON.parse(result);
      expect(parsed.status).toBe('cancelled');
    });

    it('handles camera error with JSON format', async () => {
      const ImagePicker = require('expo-image-picker');
      ImagePicker.launchCameraAsync.mockRejectedValueOnce(new Error('Camera denied'));
      const result = await executeCameraSnap({});
      const parsed = JSON.parse(result);
      expect(parsed.status).toBe('error');
      expect(parsed.error).toBe('Camera denied');
    });

    it('uses front camera when specified', async () => {
      const result = await executeCameraSnap({ camera: 'front', quality: 0.5 });
      const parsed = JSON.parse(result);
      expect(parsed.status).toBe('captured');
    });
  });
});
