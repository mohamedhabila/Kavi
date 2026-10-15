import { ExpoSpeechRecognitionModule } from 'expo-speech-recognition';
import {
  isSpeechRecognitionAvailable,
  requestSpeechRecognitionPermission,
  startSpeechRecognition,
} from '../../src/services/voice/speechRecognition';

const { __emitSpeechRecognitionEvent: emit, __speechRecognitionListenerCount: listenerCount } =
  jest.requireMock('expo-speech-recognition');
const recognizer = ExpoSpeechRecognitionModule as jest.Mocked<typeof ExpoSpeechRecognitionModule>;

function handlers() {
  return { onPartial: jest.fn(), onEnd: jest.fn(), onError: jest.fn() };
}

function heard(transcript: string, isFinal: boolean) {
  emit('result', { isFinal, results: [{ transcript, confidence: 0.9, segments: [] }] });
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('speech recognition', () => {
  it('streams the words heard, then ends the utterance with its final transcript', () => {
    const events = handlers();
    startSpeechRecognition(events);

    heard('What time', false);
    heard('What time is it in Tokyo', false);
    heard('What time is it in Tokyo?', true);
    emit('end');

    expect(recognizer.start).toHaveBeenCalledWith(
      expect.objectContaining({ interimResults: true, continuous: false, addsPunctuation: true }),
    );
    expect(events.onPartial.mock.calls).toEqual([['What time'], ['What time is it in Tokyo']]);
    expect(events.onEnd).toHaveBeenCalledWith('What time is it in Tokyo?');
    expect(events.onError).not.toHaveBeenCalled();
    expect(listenerCount()).toBe(0);
  });

  it.each(['no-speech', 'speech-timeout'])(
    'treats %s as an utterance with nothing said',
    (code) => {
      const events = handlers();
      startSpeechRecognition(events);

      emit('error', { error: code, message: 'quiet' });
      emit('end');

      expect(events.onEnd).toHaveBeenCalledWith('');
      expect(events.onError).not.toHaveBeenCalled();
    },
  );

  it('keeps what was heard when the person finishes early, and drops it when aborted', () => {
    const kept = handlers();
    const session = startSpeechRecognition(kept);
    heard('Remind me at six', false);
    session.stop();
    emit('end');
    expect(recognizer.stop).toHaveBeenCalledTimes(1);
    expect(kept.onEnd).toHaveBeenCalledWith('Remind me at six');

    const dropped = handlers();
    const aborted = startSpeechRecognition(dropped);
    heard('never mind', false);
    aborted.abort();
    emit('error', { error: 'aborted', message: 'aborted' });
    emit('end');
    expect(recognizer.abort).toHaveBeenCalledTimes(1);
    expect(dropped.onEnd).toHaveBeenCalledWith('');
    expect(dropped.onError).not.toHaveBeenCalled();
  });

  it.each([
    ['not-allowed', 'permission_denied'],
    ['language-not-supported', 'provider_unavailable'],
    ['network', 'transport'],
    ['audio-capture', 'unexpected'],
  ])('reports %s as a %s voice error, once', (code, kind) => {
    const events = handlers();
    startSpeechRecognition(events);

    emit('error', { error: code, message: 'native detail' });
    emit('end');

    expect(events.onError).toHaveBeenCalledTimes(1);
    expect(events.onError.mock.calls[0][0]).toMatchObject({ name: 'VoiceOperationError', kind });
    expect(events.onEnd).not.toHaveBeenCalled();
  });

  it('reports a recognizer that cannot start, and lets the next session start', () => {
    recognizer.start.mockImplementationOnce(() => {
      throw new Error('no recognizer');
    });
    const failed = handlers();
    startSpeechRecognition(failed);
    expect(failed.onError.mock.calls[0][0]).toMatchObject({ kind: 'unexpected' });

    const next = handlers();
    startSpeechRecognition(next);
    heard('hello', true);
    emit('end');
    expect(next.onEnd).toHaveBeenCalledWith('hello');
  });

  it('starts a new session only after the previous one has ended, and hears none of it', async () => {
    const first = handlers();
    const firstSession = startSpeechRecognition(first);
    firstSession.abort();

    const second = handlers();
    startSpeechRecognition(second);
    expect(recognizer.start).toHaveBeenCalledTimes(1);

    emit('error', { error: 'aborted', message: 'aborted' });
    emit('end');
    await Promise.resolve();
    expect(first.onEnd).toHaveBeenCalledWith('');
    expect(second.onEnd).not.toHaveBeenCalled();
    expect(recognizer.start).toHaveBeenCalledTimes(2);

    heard('Second utterance', true);
    emit('end');
    expect(second.onEnd).toHaveBeenCalledWith('Second utterance');
  });

  it('ends a session cancelled before it could start, without starting it', async () => {
    startSpeechRecognition(handlers());
    const cancelled = handlers();
    const session = startSpeechRecognition(cancelled);
    session.abort();

    emit('end');
    await Promise.resolve();

    expect(recognizer.start).toHaveBeenCalledTimes(1);
    expect(cancelled.onEnd).toHaveBeenCalledWith('');
    expect(listenerCount()).toBe(0);
  });

  it('waits for the recognizer to end after an error before the next session listens', async () => {
    const failed = handlers();
    startSpeechRecognition(failed);
    emit('error', { error: 'network', message: 'offline' });
    expect(failed.onError).toHaveBeenCalledTimes(1);

    const next = handlers();
    startSpeechRecognition(next);
    expect(recognizer.start).toHaveBeenCalledTimes(1);
    emit('end');
    await Promise.resolve();

    expect(failed.onEnd).not.toHaveBeenCalled();
    expect(recognizer.start).toHaveBeenCalledTimes(2);
    emit('end');
    expect(next.onEnd).toHaveBeenCalledWith('');
  });

  it('reads availability and permission from the recognizer', async () => {
    expect(isSpeechRecognitionAvailable()).toBe(true);
    recognizer.isRecognitionAvailable.mockImplementationOnce(() => {
      throw new Error('module missing');
    });
    expect(isSpeechRecognitionAvailable()).toBe(false);

    await expect(requestSpeechRecognitionPermission()).resolves.toBe(true);
    recognizer.requestPermissionsAsync.mockResolvedValueOnce({ granted: false } as never);
    await expect(requestSpeechRecognitionPermission()).resolves.toBe(false);
  });
});
