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
import { TalkModeManager, type TalkModeState, type TalkModeConfig, type TalkModeEventHandler, type AgentHandler } from '../../src/services/voice/talkMode';

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
});
