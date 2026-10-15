// ---------------------------------------------------------------------------
// Kavi — Speech Recognition
// ---------------------------------------------------------------------------
// Turns what the person says into text with the phone's own speech recognizer, which runs
// on the device where the phone supports it and needs no account or key. Words stream in
// while the person speaks; the system decides when the utterance is over.

import {
  ExpoSpeechRecognitionModule,
  type ExpoSpeechRecognitionErrorCode,
} from 'expo-speech-recognition';
import { i18n } from '../../i18n/manager';
import { getLocaleBcp47Tag } from '../../i18n/localeBcp47';
import { VoiceOperationError, type VoiceOperationFailureKind } from './voiceErrors';

export type SpeechRecognitionHandlers = Readonly<{
  /** The words heard so far in this utterance, replaced on every update. */
  onPartial: (transcript: string) => void;
  /** The utterance is over: its transcript, empty when nothing was said. */
  onEnd: (transcript: string) => void;
  onError: (error: VoiceOperationError) => void;
}>;

export type SpeechRecognitionSession = Readonly<{
  /** Stop listening and keep what was heard (the session still ends with onEnd). */
  stop: () => void;
  /** Stop listening and drop what was heard; the session ends with an empty transcript. */
  abort: () => void;
}>;

/** Ends that mean "nothing more was said", not a failure. */
const QUIET_END_CODES: ReadonlySet<ExpoSpeechRecognitionErrorCode> = new Set([
  'no-speech',
  'speech-timeout',
  'aborted',
]);

const FAILURE_KIND_BY_CODE: Partial<
  Record<ExpoSpeechRecognitionErrorCode, VoiceOperationFailureKind>
> = {
  'not-allowed': 'permission_denied',
  'service-not-allowed': 'provider_unavailable',
  'language-not-supported': 'provider_unavailable',
  network: 'transport',
};

/** Resolves when the native session started last has ended (it always ends with `end`). */
let previousSessionEnded: Promise<void> | null = null;

export function isSpeechRecognitionAvailable(): boolean {
  try {
    return ExpoSpeechRecognitionModule.isRecognitionAvailable();
  } catch {
    return false;
  }
}

/** Asks for the microphone and speech recognition; true when both are granted. */
export async function requestSpeechRecognitionPermission(): Promise<boolean> {
  const result = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
  return result.granted;
}

/**
 * Listens for one utterance in the app's language. Each session ends exactly once, with
 * onEnd or onError. The recognizer's events carry no session, so a session started while
 * the previous one is still winding down waits for its `end` before it listens.
 */
export function startSpeechRecognition(
  handlers: SpeechRecognitionHandlers,
): SpeechRecognitionSession {
  let transcript = '';
  let dropTranscript = false;
  let cancelledBeforeStart = false;
  let listening = false;
  let reported = false;
  let markEnded!: () => void;
  const ended = new Promise<void>((resolve) => {
    markEnded = resolve;
  });
  const subscriptions: Array<{ remove: () => void }> = [];
  const report = (callback: () => void) => {
    if (reported) return;
    reported = true;
    callback();
  };
  const release = () => {
    for (const subscription of subscriptions.splice(0)) subscription.remove();
    if (previousSessionEnded === ended) previousSessionEnded = null;
    markEnded();
  };

  const listen = () => {
    if (cancelledBeforeStart) {
      release();
      report(() => handlers.onEnd(''));
      return;
    }
    subscriptions.push(
      ExpoSpeechRecognitionModule.addListener('result', (event) => {
        if (reported) return;
        transcript = event.results[0]?.transcript?.trim() ?? transcript;
        if (!event.isFinal) handlers.onPartial(transcript);
      }),
      ExpoSpeechRecognitionModule.addListener('error', (event) => {
        if (QUIET_END_CODES.has(event.error)) return;
        report(() =>
          handlers.onError(
            new VoiceOperationError(
              FAILURE_KIND_BY_CODE[event.error] ?? 'unexpected',
              `Speech recognition failed (${event.error}): ${event.message}`,
            ),
          ),
        );
      }),
      ExpoSpeechRecognitionModule.addListener('end', () => {
        release();
        report(() => handlers.onEnd(dropTranscript ? '' : transcript));
      }),
    );
    try {
      ExpoSpeechRecognitionModule.start({
        lang: getLocaleBcp47Tag(i18n.locale),
        interimResults: true,
        continuous: false,
        addsPunctuation: true,
        maxAlternatives: 1,
      });
      listening = true;
    } catch (error) {
      release();
      report(() =>
        handlers.onError(
          new VoiceOperationError('unexpected', 'Speech recognition could not start', {
            cause: error,
          }),
        ),
      );
    }
  };

  const waitFor = previousSessionEnded;
  previousSessionEnded = ended;
  if (waitFor) void waitFor.then(listen);
  else listen();

  return {
    stop: () => {
      if (listening && !reported) ExpoSpeechRecognitionModule.stop();
      else if (!listening) cancelledBeforeStart = true;
    },
    abort: () => {
      dropTranscript = true;
      if (listening && !reported) ExpoSpeechRecognitionModule.abort();
      else if (!listening) cancelledBeforeStart = true;
    },
  };
}
