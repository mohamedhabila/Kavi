// ---------------------------------------------------------------------------
// Tests - Builtin Tool Executor: executeAudioTranscribe
// ---------------------------------------------------------------------------

import { executeAudioTranscribe } from '../../helpers/builtinExecutorHarness';

describe('Builtin Tool Executor', () => {
  describe('executeAudioTranscribe', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });
    afterEach(() => {
      jest.useRealTimers();
    });

    const flushPromisesAndTimers = async () => {
      // Alternate between flushing microtask queue and advancing timers
      for (let i = 0; i < 10; i++) {
        await Promise.resolve();
        jest.advanceTimersByTime(1000);
      }
    };

    it('returns transcription result', async () => {
      const promise = executeAudioTranscribe({ durationMs: 100 });
      await flushPromisesAndTimers();
      const result = await promise;
      const parsed = JSON.parse(result);
      expect(parsed.status).toBe('transcribed');
      expect(parsed.text).toBe('hello');
    });

    it('handles null audio URI', async () => {
      const voice = require('../../../src/services/voice/voice');
      voice.stopRecording.mockResolvedValueOnce(null);
      const promise = executeAudioTranscribe({});
      await flushPromisesAndTimers();
      const result = await promise;
      const parsed = JSON.parse(result);
      expect(parsed.status).toBe('error');
      expect(parsed.error).toContain('No audio');
    });

    it('handles transcription error', async () => {
      const voice = require('../../../src/services/voice/voice');
      voice.startRecording.mockRejectedValueOnce(new Error('mic denied'));
      const result = await executeAudioTranscribe({});
      const parsed = JSON.parse(result);
      expect(parsed.status).toBe('error');
      expect(parsed.error).toBe('mic denied');
    });
  });
});
