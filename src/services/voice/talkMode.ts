// ---------------------------------------------------------------------------
// Kavi — Voice Talk Mode
// ---------------------------------------------------------------------------
// A spoken conversation: listen → send what was said → speak the reply while it streams
// → listen again. The phone's recognizer hears the person and decides when they finished;
// the reply is spoken sentence by sentence as it arrives.
//
// idle → listening → processing ⇄ speaking → listening …   (error ends the session)

import { createLogger } from '../../utils/logger';
import { unrefTimerIfSupported } from '../../utils/timers';
import {
  startSpeechRecognition,
  type SpeechRecognitionHandlers,
  type SpeechRecognitionSession,
} from './speechRecognition';
import { createSpokenReply, type SpokenReply } from './spokenReply';
import { speakText, stopSpeaking, type TTSProvider } from './voice';

const logger = createLogger('TalkMode');

export type TalkModeState = 'idle' | 'listening' | 'processing' | 'speaking' | 'error';

/** What the agent says back for one spoken turn. */
export type AgentReply = Readonly<{
  /** The final answer, shown in the session transcript. */
  response: string;
  /** Everything the turn said, in order, as streamed through onReplyText. */
  spokenText: string;
}>;

export type AgentHandler = (
  input: string,
  turn: Readonly<{ onReplyText: (replySoFar: string) => void }>,
) => Promise<AgentReply>;

export type TalkModeEventHandlers = Readonly<{
  onError?: (error: Error) => void;
}>;

export type TalkModeDependencies = Readonly<{
  recognize: (handlers: SpeechRecognitionHandlers) => SpeechRecognitionSession;
  speak: (sentence: string) => Promise<void>;
  stopSpeaking: () => Promise<void>;
}>;

/** Pause before listening again, so a recognizer that ends at once cannot spin. */
const RESTART_LISTENING_DELAY_MS = 300;

export function createTalkModeDependencies(ttsProvider: TTSProvider): TalkModeDependencies {
  return {
    recognize: startSpeechRecognition,
    speak: (sentence) => speakText(sentence, ttsProvider),
    stopSpeaking,
  };
}

type Listener<T> = (value: T) => void;

export class TalkModeManager {
  private state: TalkModeState = 'idle';
  private active = false;
  /** Bumped on every start and stop; callbacks from an older session are ignored. */
  private generation = 0;
  private recognition: SpeechRecognitionSession | null = null;
  private reply: SpokenReply | null = null;
  private restartTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly stateListeners = new Set<Listener<TalkModeState>>();
  private readonly partialListeners = new Set<Listener<string>>();
  private readonly transcriptListeners = new Set<Listener<string>>();
  private readonly responseListeners = new Set<Listener<string>>();

  constructor(
    private readonly agentHandler: AgentHandler,
    private readonly handlers: TalkModeEventHandlers,
    private readonly dependencies: TalkModeDependencies,
  ) {}

  getState(): TalkModeState {
    return this.state;
  }

  isActive(): boolean {
    return this.active;
  }

  onStateChange(listener: Listener<TalkModeState>): () => void {
    return this.subscribe(this.stateListeners, listener);
  }

  /** The words heard so far while the person is speaking. */
  onPartialTranscript(listener: Listener<string>): () => void {
    return this.subscribe(this.partialListeners, listener);
  }

  /** What the person said, once per turn. */
  onTranscript(listener: Listener<string>): () => void {
    return this.subscribe(this.transcriptListeners, listener);
  }

  onResponse(listener: Listener<string>): () => void {
    return this.subscribe(this.responseListeners, listener);
  }

  async start(): Promise<void> {
    if (this.active) return;
    this.active = true;
    this.generation += 1;
    this.listen(this.generation);
  }

  async stop(): Promise<void> {
    await this.halt();
    this.setState('idle');
  }

  /** The person is done speaking: end the utterance now instead of waiting for silence. */
  finishSpeaking(): void {
    if (this.state === 'listening') this.recognition?.stop();
  }

  /** Stop the reply being spoken; Kavi listens as soon as the turn is over. */
  stopReply(): void {
    this.reply?.stop();
  }

  private listen(generation: number): void {
    if (!this.isCurrent(generation)) return;
    this.setState('listening');
    try {
      this.recognition = this.dependencies.recognize({
        onPartial: (transcript) => {
          if (!this.isCurrent(generation)) return;
          for (const listener of this.partialListeners) listener(transcript);
        },
        onEnd: (transcript) => {
          if (!this.isCurrent(generation)) return;
          this.recognition = null;
          if (transcript) void this.takeTurn(generation, transcript);
          else this.listenAgainSoon(generation);
        },
        onError: (error) => {
          if (!this.isCurrent(generation)) return;
          this.recognition = null;
          void this.fail(error);
        },
      });
    } catch (error) {
      void this.fail(error instanceof Error ? error : new Error(String(error)));
    }
  }

  private async takeTurn(generation: number, transcript: string): Promise<void> {
    for (const listener of this.transcriptListeners) listener(transcript);
    this.setState('processing');
    const reply = createSpokenReply({
      speak: async (sentence) => {
        if (this.isCurrent(generation)) this.setState('speaking');
        await this.dependencies.speak(sentence);
      },
      stopSpeaking: this.dependencies.stopSpeaking,
      // Spoken all that has arrived while the run is still working (a tool, say).
      onQuiet: () => {
        if (this.isCurrent(generation)) this.setState('processing');
      },
    });
    this.reply = reply;
    try {
      const { response, spokenText } = await this.agentHandler(transcript, {
        onReplyText: (replySoFar) => {
          if (this.isCurrent(generation)) reply.update(replySoFar);
        },
      });
      if (!this.isCurrent(generation)) return;
      for (const listener of this.responseListeners) listener(response);
      await reply.finish(spokenText || response);
      if (!this.isCurrent(generation)) return;
      this.reply = null;
      this.listenAgainSoon(generation);
    } catch (error) {
      if (this.isCurrent(generation)) {
        await this.fail(error instanceof Error ? error : new Error(String(error)));
      }
    }
  }

  private listenAgainSoon(generation: number): void {
    this.clearRestartTimer();
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null;
      this.listen(generation);
    }, RESTART_LISTENING_DELAY_MS);
    unrefTimerIfSupported(this.restartTimer);
  }

  private async halt(): Promise<void> {
    this.active = false;
    this.generation += 1;
    this.clearRestartTimer();
    this.recognition?.abort();
    this.recognition = null;
    this.reply?.stop();
    this.reply = null;
    await this.dependencies.stopSpeaking().catch((error: unknown) => {
      logger.warn('Could not stop speaking.', { error: String(error) });
    });
  }

  private async fail(error: Error): Promise<void> {
    await this.halt();
    this.handlers.onError?.(error);
    this.setState('error');
  }

  private isCurrent(generation: number): boolean {
    return this.active && this.generation === generation;
  }

  private clearRestartTimer(): void {
    if (!this.restartTimer) return;
    clearTimeout(this.restartTimer);
    this.restartTimer = null;
  }

  private setState(state: TalkModeState): void {
    if (this.state === state) return;
    this.state = state;
    for (const listener of this.stateListeners) listener(state);
  }

  private subscribe<T>(listeners: Set<Listener<T>>, listener: Listener<T>): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }
}
