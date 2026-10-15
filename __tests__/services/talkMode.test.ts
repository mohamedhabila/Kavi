import type { SpeechRecognitionHandlers } from '../../src/services/voice/speechRecognition';
import {
  TalkModeManager,
  type AgentHandler,
  type AgentReply,
  type TalkModeDependencies,
  type TalkModeState,
} from '../../src/services/voice/talkMode';
import { VoiceOperationError } from '../../src/services/voice/voiceErrors';

type FakeSession = { handlers: SpeechRecognitionHandlers; stop: jest.Mock; abort: jest.Mock };

function fakeVoice() {
  const sessions: FakeSession[] = [];
  const spoken: string[] = [];
  const finishSpeech: Array<() => void> = [];
  const dependencies: TalkModeDependencies = {
    recognize: jest.fn((handlers: SpeechRecognitionHandlers) => {
      const session = { handlers, stop: jest.fn(), abort: jest.fn() };
      sessions.push(session);
      return session;
    }),
    speak: jest.fn(
      (sentence: string) =>
        new Promise<void>((resolve) => {
          spoken.push(sentence);
          finishSpeech.push(resolve);
        }),
    ),
    stopSpeaking: jest.fn(async () => {
      finishSpeech.splice(0).forEach((resolve) => resolve());
    }),
  };
  return {
    dependencies,
    sessions,
    spoken,
    latestSession: () => sessions[sessions.length - 1],
    /** The current sentence finishes playing. */
    finishSentence: async () => {
      finishSpeech.shift()?.();
      await flush();
    },
  };
}

async function flush(times = 8) {
  for (let index = 0; index < times; index += 1) await Promise.resolve();
}

function deferredReply() {
  let resolve!: (reply: AgentReply) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<AgentReply>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function createManager(agentHandler: AgentHandler, voice = fakeVoice()) {
  const onError = jest.fn();
  const manager = new TalkModeManager(agentHandler, { onError }, voice.dependencies);
  const states: TalkModeState[] = [];
  manager.onStateChange((state) => states.push(state));
  return { manager, voice, onError, states };
}

beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

describe('TalkModeManager', () => {
  it('listens, sends what was said, speaks the reply as it streams, then listens again', async () => {
    const reply = deferredReply();
    let streamReply!: (replySoFar: string) => void;
    const agent: AgentHandler = jest.fn(async (_input, turn) => {
      streamReply = turn.onReplyText;
      return reply.promise;
    });
    const { manager, voice, states } = createManager(agent);
    const partials: string[] = [];
    const transcripts: string[] = [];
    const responses: string[] = [];
    manager.onPartialTranscript((text) => partials.push(text));
    manager.onTranscript((text) => transcripts.push(text));
    manager.onResponse((text) => responses.push(text));

    await manager.start();
    voice.latestSession().handlers.onPartial('What is the');
    voice.latestSession().handlers.onEnd('What is the weather tomorrow?');
    await flush();
    expect(agent).toHaveBeenCalledWith('What is the weather tomorrow?', expect.any(Object));
    expect(manager.getState()).toBe('processing');

    streamReply('Tomorrow will be sunny. It');
    await flush();
    expect(voice.spoken).toEqual(['Tomorrow will be sunny.']);
    expect(manager.getState()).toBe('speaking');

    reply.resolve({
      response: 'Tomorrow will be sunny. It reaches 24 degrees.',
      spokenText: 'Tomorrow will be sunny. It reaches 24 degrees.',
    });
    await voice.finishSentence();
    await voice.finishSentence();
    expect(voice.spoken).toEqual(['Tomorrow will be sunny.', 'It reaches 24 degrees.']);
    expect(voice.sessions).toHaveLength(1);

    jest.advanceTimersByTime(300);
    expect(voice.sessions).toHaveLength(2);
    expect(manager.getState()).toBe('listening');
    expect(partials).toEqual(['What is the']);
    expect(transcripts).toEqual(['What is the weather tomorrow?']);
    expect(responses).toEqual(['Tomorrow will be sunny. It reaches 24 degrees.']);
    expect(states).toEqual(['listening', 'processing', 'speaking', 'listening']);
  });

  it('keeps listening when nothing was said', async () => {
    const agent = jest.fn();
    const { manager, voice } = createManager(agent);

    await manager.start();
    voice.latestSession().handlers.onEnd('');
    jest.advanceTimersByTime(300);

    expect(agent).not.toHaveBeenCalled();
    expect(voice.sessions).toHaveLength(2);
    expect(manager.getState()).toBe('listening');
  });

  it('ends the utterance when the person says they are done', async () => {
    const { manager, voice } = createManager(jest.fn());

    await manager.start();
    manager.finishSpeaking();

    expect(voice.latestSession().stop).toHaveBeenCalledTimes(1);
  });

  it('stops the reply on request and listens once the turn is over', async () => {
    const agent: AgentHandler = jest.fn(async () => ({
      response: 'One. Two. Three.',
      spokenText: 'One. Two. Three.',
    }));
    const { manager, voice } = createManager(agent);

    await manager.start();
    voice.latestSession().handlers.onEnd('Count to three');
    await flush();
    expect(voice.spoken).toEqual(['One.']);

    manager.stopReply();
    await flush();
    jest.advanceTimersByTime(300);

    expect(voice.dependencies.stopSpeaking).toHaveBeenCalled();
    expect(voice.spoken).toEqual(['One.']);
    expect(voice.sessions).toHaveLength(2);
  });

  it('goes back to thinking after speaking what arrived while the run still works', async () => {
    const reply = deferredReply();
    let streamReply!: (replySoFar: string) => void;
    const { manager, voice } = createManager(
      jest.fn(async (_input, turn) => {
        streamReply = turn.onReplyText;
        return reply.promise;
      }),
    );

    await manager.start();
    voice.latestSession().handlers.onEnd('Book a table');
    await flush();
    streamReply('Let me check what is free.\n\n');
    await flush();
    expect(manager.getState()).toBe('speaking');
    await voice.finishSentence();

    expect(manager.getState()).toBe('processing');
  });

  it('stops for good on a recognition error and reports it', async () => {
    const { manager, voice, onError } = createManager(jest.fn());
    const denied = new VoiceOperationError('permission_denied', 'not allowed');

    await manager.start();
    voice.latestSession().handlers.onError(denied);
    await flush();
    jest.advanceTimersByTime(1000);

    expect(onError).toHaveBeenCalledWith(denied);
    expect(manager.getState()).toBe('error');
    expect(manager.isActive()).toBe(false);
    expect(voice.sessions).toHaveLength(1);
  });

  it.each([
    ['the turn fails', () => Promise.reject(new Error('provider down')), 'provider down'],
    [
      'the reply cannot be spoken',
      () => Promise.resolve({ response: 'Hi.', spokenText: 'Hi.' }),
      'no voice',
    ],
  ])('reports an error when %s', async (_label, run, message) => {
    const voice = fakeVoice();
    (voice.dependencies.speak as jest.Mock).mockRejectedValue(new Error('no voice'));
    const { manager, onError } = createManager(jest.fn(run), voice);

    await manager.start();
    voice.latestSession().handlers.onEnd('Hello');
    await flush();

    expect(onError.mock.calls[0][0]).toMatchObject({ message });
    expect(manager.getState()).toBe('error');
  });

  it('ignores a turn that finishes after the session was stopped', async () => {
    const reply = deferredReply();
    const { manager, voice } = createManager(jest.fn(() => reply.promise));

    await manager.start();
    voice.latestSession().handlers.onEnd('Plan my week');
    await flush();
    await manager.stop();
    reply.resolve({ response: 'Here is your week.', spokenText: 'Here is your week.' });
    await flush();
    jest.advanceTimersByTime(1000);

    expect(voice.spoken).toEqual([]);
    expect(voice.sessions).toHaveLength(1);
    expect(manager.getState()).toBe('idle');
  });

  it('abandons the utterance being heard when the session stops', async () => {
    const agent = jest.fn();
    const { manager, voice } = createManager(agent);

    await manager.start();
    const session = voice.latestSession();
    await manager.stop();
    session.handlers.onEnd('too late');
    await flush();

    expect(session.abort).toHaveBeenCalledTimes(1);
    expect(agent).not.toHaveBeenCalled();
  });
});
