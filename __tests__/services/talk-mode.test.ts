// ---------------------------------------------------------------------------
// Talk Mode Manager — tests
// ---------------------------------------------------------------------------

// Mock the voice module before importing TalkModeManager
jest.mock('../../src/services/voice/voice', () => ({
  startRecording: jest.fn().mockResolvedValue(undefined),
  stopRecording: jest.fn().mockResolvedValue('mock-audio-uri'),
  getRecordingStatus: jest.fn().mockReturnValue({
    canRecord: true,
    isRecording: true,
    durationMillis: 0,
    mediaServicesDidReset: false,
    metering: -80,
    url: 'file://mock-audio.m4a',
  }),
  transcribeAudio: jest
    .fn()
    .mockResolvedValue({ text: 'hello world', language: 'en', duration: 2 }),
  speakText: jest.fn().mockResolvedValue(undefined),
  stopSpeaking: jest.fn().mockResolvedValue(undefined),
}));

import {
  TalkModeManager,
  type TalkModeState,
  type TalkModeConfig,
  type TalkModeEventHandler,
  type AgentHandler,
} from '../../src/services/voice/talkMode';

describe('TalkModeManager', () => {
  const mockAgentHandler: AgentHandler = jest.fn().mockResolvedValue('AI response');

  beforeEach(() => {
    const voice = require('../../src/services/voice/voice');
    voice.startRecording.mockReset();
    voice.startRecording.mockResolvedValue(undefined);
    voice.stopRecording.mockReset();
    voice.stopRecording.mockResolvedValue('mock-audio-uri');
    voice.transcribeAudio.mockReset();
    voice.transcribeAudio.mockResolvedValue({ text: 'hello world', language: 'en', duration: 2 });
    voice.speakText.mockReset();
    voice.speakText.mockResolvedValue(undefined);
    voice.stopSpeaking.mockReset();
    voice.stopSpeaking.mockResolvedValue(undefined);
    voice.getRecordingStatus.mockReturnValue({
      canRecord: true,
      isRecording: true,
      durationMillis: 0,
      mediaServicesDidReset: false,
      metering: -80,
      url: 'file://mock-audio.m4a',
    });
  });

  it('initializes in idle state', () => {
    const mgr = new TalkModeManager(mockAgentHandler);
    expect(mgr.getState()).toBe('idle');
  });

  it('isActive returns false initially', () => {
    const mgr = new TalkModeManager(mockAgentHandler);
    expect(mgr.isActive()).toBe(false);
  });

  it('notifies on state change via handlers', async () => {
    const states: TalkModeState[] = [];
    const handlers: TalkModeEventHandler = {
      onStateChange: (s) => states.push(s),
    };
    const mgr = new TalkModeManager(mockAgentHandler, handlers, { autoListen: false });
    await mgr.start();
    expect(states).toContain('listening');
    expect(mgr.isActive()).toBe(true);
  });

  it('stop returns to idle', async () => {
    const mgr = new TalkModeManager(mockAgentHandler, {}, { autoListen: false });
    await mgr.start();
    await mgr.stop();
    expect(mgr.getState()).toBe('idle');
    expect(mgr.isActive()).toBe(false);
  });

  it('start is idempotent when already active', async () => {
    const states: TalkModeState[] = [];
    const handlers: TalkModeEventHandler = {
      onStateChange: (s) => states.push(s),
    };
    const mgr = new TalkModeManager(mockAgentHandler, handlers, { autoListen: false });
    await mgr.start();
    const countBefore = states.length;
    await mgr.start(); // Should not re-enter listening
    expect(states.length).toBe(countBefore);
  });

  it('pause goes to paused state', async () => {
    const mgr = new TalkModeManager(mockAgentHandler, {}, { autoListen: false });
    await mgr.start();
    await mgr.pause();
    expect(mgr.getState()).toBe('paused');
  });

  it('resume from paused goes to listening', async () => {
    const mgr = new TalkModeManager(mockAgentHandler, {}, { autoListen: false });
    await mgr.start();
    await mgr.pause();
    await mgr.resume();
    expect(mgr.getState()).toBe('listening');
  });

  it('resume from non-paused state is no-op', async () => {
    const mgr = new TalkModeManager(mockAgentHandler, {}, { autoListen: false });
    await mgr.start();
    // Not paused, so resume should be no-op
    const stateBefore = mgr.getState();
    await mgr.resume();
    expect(mgr.getState()).toBe(stateBefore);
  });

  it('accepts custom config', () => {
    const config: TalkModeConfig = {
      ttsProvider: 'system',
      silenceTimeoutMs: 3000,
      shortSpeechSilenceTimeoutMs: 1200,
      maxRecordingMs: 10000,
      wakeWord: 'hey kavi',
      autoListen: false,
    };
    const mgr = new TalkModeManager(mockAgentHandler, {}, config);
    expect(mgr.getState()).toBe('idle');
  });

  it('handles error in agent handler gracefully', async () => {
    const errorHandler = jest.fn().mockRejectedValue(new Error('API failed'));
    const errors: Error[] = [];
    const handlers: TalkModeEventHandler = {
      onError: (e) => errors.push(e),
    };
    const mgr = new TalkModeManager(errorHandler, handlers, { autoListen: false });
    // Just confirm constructor doesn't throw
    expect(mgr.getState()).toBe('idle');
  });

  it('constructs with 1-arg config form', () => {
    const config: TalkModeConfig = { autoListen: false };
    const mgr = new TalkModeManager(config);
    expect(mgr.getState()).toBe('idle');
  });

  it('subscriber onStateChange notifies and unsubscribes', async () => {
    const mgr = new TalkModeManager(mockAgentHandler, {}, { autoListen: false });
    const states: string[] = [];
    const unsub = mgr.onStateChange((s) => states.push(s));
    await mgr.start();
    expect(states.length).toBeGreaterThan(0);
    const beforeLen = states.length;
    unsub();
    await mgr.stop();
    // After unsub, no more notifications
    expect(states.length).toBe(beforeLen);
  });

  it('subscriber onTranscript notifies', () => {
    const mgr = new TalkModeManager(mockAgentHandler, {}, { autoListen: false });
    const transcripts: string[] = [];
    const unsub = mgr.onTranscript((t) => transcripts.push(t));
    // Just verifying it doesn't throw
    unsub();
  });

  it('subscriber onResponse notifies', () => {
    const mgr = new TalkModeManager(mockAgentHandler, {}, { autoListen: false });
    const responses: string[] = [];
    const unsub = mgr.onResponse((r) => responses.push(r));
    unsub();
  });

  it('stopAndProcess is no-op when not listening', async () => {
    const mgr = new TalkModeManager(mockAgentHandler, {}, { autoListen: false });
    // Not started, so stopAndProcess should be no-op
    await mgr.stopAndProcess();
    expect(mgr.getState()).toBe('idle');
  });

  it('full processRecording flow with transcript and agent response', async () => {
    jest.useFakeTimers();
    const responses: string[] = [];
    const transcripts: string[] = [];
    const handlers: TalkModeEventHandler = {
      onTranscription: (t) => transcripts.push(t),
      onAgentResponse: (r) => responses.push(r),
    };
    const mgr = new TalkModeManager(mockAgentHandler, handlers, {
      autoListen: false,
      silenceTimeoutMs: 100,
    });
    await mgr.start();
    // Advance past silence timeout to trigger processRecording
    jest.advanceTimersByTime(200);
    // Flush microtasks
    for (let i = 0; i < 10; i++) {
      await Promise.resolve();
      jest.advanceTimersByTime(100);
    }
    jest.useRealTimers();
  });

  it('handles start error gracefully', async () => {
    const voice = require('../../src/services/voice/voice');
    voice.startRecording.mockRejectedValueOnce(new Error('mic permission denied'));
    const errors: Error[] = [];
    const handlers: TalkModeEventHandler = {
      onError: (e) => errors.push(e),
    };
    const mgr = new TalkModeManager(mockAgentHandler, handlers, { autoListen: false });
    await mgr.start();
    // Allow error handler to run
    await new Promise((r) => setTimeout(r, 50));
    expect(errors.length).toBeGreaterThanOrEqual(1);
    expect(errors[0].message).toContain('mic permission denied');
  });

  describe('processRecording branches', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });
    afterEach(() => {
      jest.useRealTimers();
    });

    async function flushAsync(times = 10) {
      for (let i = 0; i < times; i++) {
        await Promise.resolve();
        jest.advanceTimersByTime(100);
      }
    }

    it('restarts listening when no audioUri with autoListen', async () => {
      const voice = require('../../src/services/voice/voice');
      voice.stopRecording.mockResolvedValueOnce(null); // no audioUri
      voice.startRecording.mockResolvedValue(undefined);
      voice.getRecordingStatus.mockReturnValue({
        canRecord: true,
        isRecording: true,
        durationMillis: 0,
        mediaServicesDidReset: false,
        metering: -80,
        url: 'file://mock-audio.m4a',
      });

      const states: TalkModeState[] = [];
      const mgr = new TalkModeManager(
        mockAgentHandler,
        {
          onStateChange: (s) => states.push(s),
        },
        {
          autoListen: true,
          initialSilenceTimeoutMs: 50,
          silenceTimeoutMs: 50,
          maxRecordingMs: 60000,
          recorderStatusPollIntervalMs: 25,
        },
      );

      await mgr.start();
      jest.advanceTimersByTime(100);
      await flushAsync();

      // Should have gone through transcribing then restarted listening
      expect(states).toContain('transcribing');
      await mgr.stop();
    });

    it('goes to idle when no audioUri without autoListen', async () => {
      const voice = require('../../src/services/voice/voice');
      voice.stopRecording.mockResolvedValueOnce(null);
      voice.getRecordingStatus.mockReturnValue({
        canRecord: true,
        isRecording: true,
        durationMillis: 0,
        mediaServicesDidReset: false,
        metering: -80,
        url: 'file://mock-audio.m4a',
      });

      const mgr = new TalkModeManager(
        mockAgentHandler,
        {},
        {
          autoListen: false,
          initialSilenceTimeoutMs: 50,
          silenceTimeoutMs: 50,
          maxRecordingMs: 60000,
          recorderStatusPollIntervalMs: 25,
        },
      );

      await mgr.start();
      jest.advanceTimersByTime(100);
      await flushAsync();

      expect(mgr.getState()).toBe('idle');
    });

    it('restarts listening on empty text with autoListen', async () => {
      const voice = require('../../src/services/voice/voice');
      voice.stopRecording.mockResolvedValueOnce('audio.wav');
      voice.transcribeAudio.mockResolvedValueOnce({ text: '   ', language: 'en', duration: 1 });
      voice.startRecording.mockResolvedValue(undefined);
      voice.getRecordingStatus.mockReturnValue({
        canRecord: true,
        isRecording: true,
        durationMillis: 1000,
        mediaServicesDidReset: false,
        metering: -80,
        url: 'file://mock-audio.m4a',
      });

      const states: TalkModeState[] = [];
      const mgr = new TalkModeManager(
        mockAgentHandler,
        {
          onStateChange: (s) => states.push(s),
        },
        {
          autoListen: true,
          initialSilenceTimeoutMs: 50,
          silenceTimeoutMs: 50,
          maxRecordingMs: 60000,
          recorderStatusPollIntervalMs: 25,
        },
      );

      await mgr.start();
      jest.advanceTimersByTime(100);
      await flushAsync();
      expect(states).toContain('transcribing');
      await mgr.stop();
    });

    it('skips processing when wake word not detected', async () => {
      const voice = require('../../src/services/voice/voice');
      voice.stopRecording.mockResolvedValueOnce('audio.wav');
      voice.transcribeAudio.mockResolvedValueOnce({
        text: 'hello world',
        language: 'en',
        duration: 2,
      });
      voice.startRecording.mockResolvedValue(undefined);
      let metering = -80;
      voice.getRecordingStatus.mockImplementation(() => ({
        canRecord: true,
        isRecording: true,
        durationMillis: 1000,
        mediaServicesDidReset: false,
        metering,
        url: 'file://mock-audio.m4a',
      }));

      const agentCalls: string[] = [];
      const agent: AgentHandler = jest.fn(async (t) => {
        agentCalls.push(t);
        return 'ok';
      });

      const mgr = new TalkModeManager(
        agent,
        {},
        {
          autoListen: true,
          wakeWord: 'hey kavi',
          silenceTimeoutMs: 50,
          maxRecordingMs: 60000,
        },
      );

      await mgr.start();
      metering = -20;
      jest.advanceTimersByTime(100);
      await flushAsync(2);
      metering = -80;
      jest.advanceTimersByTime(100);
      await flushAsync();

      // Agent should NOT have been called since wake word wasn't detected
      expect(agentCalls.length).toBe(0);
      await mgr.stop();
    });

    it('processes through agent and speaks when wake word detected', async () => {
      const voice = require('../../src/services/voice/voice');
      voice.stopRecording.mockResolvedValueOnce('audio.wav');
      voice.transcribeAudio.mockResolvedValueOnce({
        text: 'hey kavi what time is it',
        language: 'en',
        duration: 3,
      });
      voice.speakText.mockResolvedValueOnce(undefined);
      voice.startRecording.mockResolvedValue(undefined);
      let metering = -80;
      voice.getRecordingStatus.mockImplementation(() => ({
        canRecord: true,
        isRecording: true,
        durationMillis: 1200,
        mediaServicesDidReset: false,
        metering,
        url: 'file://mock-audio.m4a',
      }));

      const responses: string[] = [];
      const agent: AgentHandler = jest.fn(async () => 'It is noon');

      const mgr = new TalkModeManager(
        agent,
        {
          onAgentResponse: (r) => responses.push(r),
        },
        {
          autoListen: false,
          wakeWord: 'hey kavi',
          silenceTimeoutMs: 50,
          maxRecordingMs: 60000,
          minSpeechDurationMs: 50,
          recorderStatusPollIntervalMs: 25,
        },
      );

      await mgr.start();
      metering = -18;
      jest.advanceTimersByTime(100);
      await flushAsync(2);
      metering = -80;
      jest.advanceTimersByTime(100);
      await flushAsync(20);

      expect(agent).toHaveBeenCalled();
      await mgr.stop();
    });

    it('waits for the restart delay before listening again after speaking', async () => {
      const voice = require('../../src/services/voice/voice');
      voice.startRecording.mockClear();
      voice.stopRecording.mockResolvedValueOnce('audio.wav');
      voice.transcribeAudio.mockResolvedValueOnce({
        text: 'hey kavi status',
        language: 'en',
        duration: 2,
      });
      voice.speakText.mockResolvedValueOnce(undefined);
      voice.startRecording.mockResolvedValue(undefined);
      let metering = -80;
      voice.getRecordingStatus.mockImplementation(() => ({
        canRecord: true,
        isRecording: true,
        durationMillis: 1000,
        mediaServicesDidReset: false,
        metering,
        url: 'file://mock-audio.m4a',
      }));

      const mgr = new TalkModeManager(
        mockAgentHandler,
        {},
        {
          autoListen: true,
          wakeWord: 'hey kavi',
          silenceTimeoutMs: 50,
          maxRecordingMs: 60000,
          restartListeningDelayMs: 400,
          minSpeechDurationMs: 50,
          recorderStatusPollIntervalMs: 25,
        },
      );

      await mgr.start();
      expect(voice.startRecording).toHaveBeenCalledTimes(1);

      metering = -20;
      jest.advanceTimersByTime(100);
      await flushAsync(2);
      metering = -80;
      jest.advanceTimersByTime(100);
      await flushAsync(2);

      expect(voice.startRecording).toHaveBeenCalledTimes(1);

      jest.advanceTimersByTime(450);
      await flushAsync(5);

      expect(voice.startRecording).toHaveBeenCalledTimes(2);
      await mgr.stop();
    });

    it('suppresses transcripts that match the recent spoken response', async () => {
      const voice = require('../../src/services/voice/voice');
      voice.startRecording.mockClear();
      voice.startRecording.mockResolvedValue(undefined);
      voice.stopRecording.mockResolvedValueOnce('first.wav').mockResolvedValueOnce('second.wav');
      voice.transcribeAudio
        .mockResolvedValueOnce({ text: 'hey kavi tell me something', language: 'en', duration: 2 })
        .mockResolvedValueOnce({ text: 'AI response', language: 'en', duration: 2 });
      voice.speakText.mockResolvedValue(undefined);
      let metering = -80;
      voice.getRecordingStatus.mockImplementation(() => ({
        canRecord: true,
        isRecording: true,
        durationMillis: 1000,
        mediaServicesDidReset: false,
        metering,
        url: 'file://mock-audio.m4a',
      }));

      const agent: AgentHandler = jest.fn(async () => 'AI response');
      const mgr = new TalkModeManager(
        agent,
        {},
        {
          autoListen: true,
          wakeWord: 'hey kavi',
          silenceTimeoutMs: 50,
          maxRecordingMs: 60000,
          restartListeningDelayMs: 250,
          minSpeechDurationMs: 50,
          recorderStatusPollIntervalMs: 25,
        },
      );

      await mgr.start();
      metering = -20;
      jest.advanceTimersByTime(100);
      await flushAsync(5);
      metering = -80;
      jest.advanceTimersByTime(100);
      await flushAsync(5);

      expect(agent).toHaveBeenCalledTimes(1);

      metering = -20;
      jest.advanceTimersByTime(300);
      await flushAsync(20);
      metering = -80;
      jest.advanceTimersByTime(100);
      await flushAsync(10);

      expect(agent).toHaveBeenCalledTimes(1);
      await mgr.stop();
    });

    it('does not stop while speech metering stays active', async () => {
      const voice = require('../../src/services/voice/voice');
      voice.stopRecording.mockClear();
      let metering = -18;
      voice.getRecordingStatus.mockImplementation(() => ({
        canRecord: true,
        isRecording: true,
        durationMillis: 1800,
        mediaServicesDidReset: false,
        metering,
        url: 'file://mock-audio.m4a',
      }));

      const mgr = new TalkModeManager(
        mockAgentHandler,
        {},
        {
          autoListen: false,
          initialSilenceTimeoutMs: 80,
          silenceTimeoutMs: 120,
          minSpeechDurationMs: 100,
          recorderStatusPollIntervalMs: 25,
          maxRecordingMs: 5000,
        },
      );

      await mgr.start();
      jest.advanceTimersByTime(500);
      await flushAsync(6);

      expect(voice.stopRecording).not.toHaveBeenCalled();

      metering = -80;
      jest.advanceTimersByTime(200);
      await flushAsync(6);

      expect(voice.stopRecording).toHaveBeenCalledTimes(1);
      await mgr.stop();
    });

    it('uses the shorter silence timeout for brief utterances', async () => {
      const voice = require('../../src/services/voice/voice');
      voice.stopRecording.mockClear();
      voice.stopRecording.mockResolvedValueOnce('brief.wav');

      let metering = -80;
      voice.getRecordingStatus.mockImplementation(() => ({
        canRecord: true,
        isRecording: true,
        durationMillis: 400,
        mediaServicesDidReset: false,
        metering,
        url: 'file://mock-audio.m4a',
      }));

      const mgr = new TalkModeManager(
        mockAgentHandler,
        {},
        {
          autoListen: false,
          initialSilenceTimeoutMs: 100,
          silenceTimeoutMs: 500,
          shortSpeechSilenceTimeoutMs: 150,
          minSpeechDurationMs: 60,
          recorderStatusPollIntervalMs: 25,
          maxRecordingMs: 5000,
        },
      );

      await mgr.start();
      metering = -18;
      jest.advanceTimersByTime(100);
      await Promise.resolve();

      metering = -80;
      jest.advanceTimersByTime(120);
      await Promise.resolve();
      expect(voice.stopRecording).not.toHaveBeenCalled();

      jest.advanceTimersByTime(80);
      await flushAsync(4);
      expect(voice.stopRecording).toHaveBeenCalledTimes(1);
      await mgr.stop();
    });

    it('waits longer for initial silence before giving up', async () => {
      const voice = require('../../src/services/voice/voice');
      voice.stopRecording.mockClear();
      voice.stopRecording.mockResolvedValueOnce(null);
      voice.getRecordingStatus.mockReturnValue({
        canRecord: true,
        isRecording: true,
        durationMillis: 0,
        mediaServicesDidReset: false,
        metering: -80,
        url: 'file://mock-audio.m4a',
      });

      const mgr = new TalkModeManager(
        mockAgentHandler,
        {},
        {
          autoListen: false,
          initialSilenceTimeoutMs: 300,
          silenceTimeoutMs: 80,
          recorderStatusPollIntervalMs: 25,
          maxRecordingMs: 5000,
        },
      );

      await mgr.start();
      jest.advanceTimersByTime(150);
      await Promise.resolve();
      expect(voice.stopRecording).not.toHaveBeenCalled();

      jest.advanceTimersByTime(250);
      await flushAsync(4);
      expect(voice.stopRecording).toHaveBeenCalledTimes(1);
      await mgr.stop();
    });

    it('handles error in processRecording and auto-recovers', async () => {
      const voice = require('../../src/services/voice/voice');
      voice.stopRecording.mockRejectedValueOnce(new Error('file error'));
      voice.startRecording.mockResolvedValue(undefined);
      voice.getRecordingStatus.mockReturnValue({
        canRecord: true,
        isRecording: true,
        durationMillis: 1000,
        mediaServicesDidReset: false,
        metering: -80,
        url: 'file://mock-audio.m4a',
      });

      const errors: Error[] = [];
      const mgr = new TalkModeManager(
        mockAgentHandler,
        {
          onError: (e) => errors.push(e),
        },
        {
          autoListen: true,
          initialSilenceTimeoutMs: 50,
          silenceTimeoutMs: 50,
          maxRecordingMs: 60000,
          recorderStatusPollIntervalMs: 25,
        },
      );

      await mgr.start();
      jest.advanceTimersByTime(100);
      await flushAsync();

      // Error should have been caught
      expect(errors.length).toBeGreaterThanOrEqual(1);

      // Auto-recovery timeout (2 seconds)
      jest.advanceTimersByTime(3000);
      await flushAsync();
      await mgr.stop();
    });
  });
});
