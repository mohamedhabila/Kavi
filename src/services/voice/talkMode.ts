// ---------------------------------------------------------------------------
// Kavi — Voice Talk Mode
// ---------------------------------------------------------------------------
// Continuous voice conversation: listen → transcribe → agent → speak.
// State machine: idle → listening → transcribing → processing → speaking → idle

import {
  startRecording,
  stopRecording,
  getRecordingStatus,
  transcribeAudio,
  speakText,
  stopSpeaking,
  type TTSProvider,
} from './voice';
import { unrefTimerIfSupported } from '../../utils/timers';

// ── Types ────────────────────────────────────────────────────────────────

export type TalkModeState =
  | 'idle'
  | 'listening'
  | 'transcribing'
  | 'processing'
  | 'speaking'
  | 'paused'
  | 'error';

export interface TalkModeConfig {
  ttsProvider?: TTSProvider;
  initialSilenceTimeoutMs?: number;
  silenceTimeoutMs?: number;
  shortSpeechSilenceTimeoutMs?: number;
  maxRecordingMs?: number;
  wakeWord?: string;
  autoListen?: boolean;
  restartListeningDelayMs?: number;
  echoSuppressionWindowMs?: number;
  speechMeteringThreshold?: number;
  minSpeechDurationMs?: number;
  recorderStatusPollIntervalMs?: number;
}

export type TalkModeEventHandler = {
  onStateChange?: (state: TalkModeState) => void;
  onTranscription?: (text: string) => void;
  onAgentResponse?: (text: string) => void;
  onError?: (error: Error) => void;
};

export type AgentHandler = (input: string) => Promise<string>;

// ── Talk Mode Manager ────────────────────────────────────────────────────

export class TalkModeManager {
  private state: TalkModeState = 'idle';
  private config: TalkModeConfig;
  private handlers: TalkModeEventHandler;
  private agentHandler: AgentHandler;
  private maxTimer: ReturnType<typeof setTimeout> | null = null;
  private recorderPollTimer: ReturnType<typeof setInterval> | null = null;
  private active = false;
  private stateListeners: Array<(s: TalkModeState) => void> = [];
  private transcriptListeners: Array<(t: string) => void> = [];
  private responseListeners: Array<(r: string) => void> = [];
  private restartTimer: ReturnType<typeof setTimeout> | null = null;
  private recoveryTimer: ReturnType<typeof setTimeout> | null = null;
  private lastSpokenResponse = '';
  private lastSpokenAt = 0;
  private listeningStartedAt = 0;
  private speechDetectedAt = 0;
  private lastSpeechAt = 0;
  private heardSpeechDuringCurrentTurn = false;
  private pendingProcessing = false;

  constructor(
    configOrAgent: TalkModeConfig | AgentHandler,
    handlers?: TalkModeEventHandler,
    config?: TalkModeConfig,
  ) {
    if (typeof configOrAgent === 'function') {
      // 3-arg form: (agentHandler, handlers, config)
      this.agentHandler = configOrAgent;
      this.handlers = handlers || {};
      config = config || {};
    } else {
      // 1-arg form: (config) — used by VoiceScreen
      this.agentHandler = async (input: string) => input;
      this.handlers = {};
      config = configOrAgent || {};
    }
    this.config = {
      ttsProvider: config.ttsProvider || 'system',
      initialSilenceTimeoutMs: config.initialSilenceTimeoutMs ?? 1800,
      silenceTimeoutMs: config.silenceTimeoutMs ?? 900,
      shortSpeechSilenceTimeoutMs: config.shortSpeechSilenceTimeoutMs ?? 550,
      maxRecordingMs: config.maxRecordingMs || 30000,
      wakeWord: config.wakeWord,
      autoListen: config.autoListen ?? true,
      restartListeningDelayMs: config.restartListeningDelayMs ?? 280,
      echoSuppressionWindowMs: config.echoSuppressionWindowMs ?? 12000,
      speechMeteringThreshold: config.speechMeteringThreshold ?? -52,
      minSpeechDurationMs: config.minSpeechDurationMs ?? 250,
      recorderStatusPollIntervalMs: config.recorderStatusPollIntervalMs ?? 80,
    };
  }

  getState(): TalkModeState {
    return this.state;
  }

  isActive(): boolean {
    return this.active;
  }

  // ── Subscriber-based event registration (for React components) ────

  onStateChange(cb: (s: TalkModeState) => void): () => void {
    this.stateListeners.push(cb);
    return () => {
      this.stateListeners = this.stateListeners.filter((l) => l !== cb);
    };
  }

  onTranscript(cb: (t: string) => void): () => void {
    this.transcriptListeners.push(cb);
    return () => {
      this.transcriptListeners = this.transcriptListeners.filter((l) => l !== cb);
    };
  }

  onResponse(cb: (r: string) => void): () => void {
    this.responseListeners.push(cb);
    return () => {
      this.responseListeners = this.responseListeners.filter((l) => l !== cb);
    };
  }

  // ── Lifecycle ─────────────────────────────────────────────────────

  async start(): Promise<void> {
    if (this.active) return;
    this.active = true;
    await this.startListening();
  }

  async stop(): Promise<void> {
    this.active = false;
    this.clearTimers();
    await stopSpeaking();

    if (this.state === 'listening') {
      await stopRecording();
    }

    this.setState('idle');
  }

  async pause(): Promise<void> {
    this.clearTimers();
    if (this.state === 'speaking') {
      await stopSpeaking();
    }
    if (this.state === 'listening') {
      await stopRecording();
    }
    this.setState('paused');
  }

  async resume(): Promise<void> {
    if (this.state !== 'paused') return;
    await this.startListening();
  }

  // ── Internal state machine ────────────────────────────────────────

  private async startListening(): Promise<void> {
    if (!this.active) return;

    try {
      this.clearRestartTimer();
      this.pendingProcessing = false;
      this.listeningStartedAt = Date.now();
      this.speechDetectedAt = 0;
      this.lastSpeechAt = 0;
      this.heardSpeechDuringCurrentTurn = false;
      await stopSpeaking();
      this.setState('listening');
      await startRecording();

      this.startRecorderStatusPolling();

      // Hard max recording limit
      this.maxTimer = setTimeout(async () => {
        if (this.state === 'listening') {
          await this.processRecording();
        }
      }, this.config.maxRecordingMs!);
      unrefTimerIfSupported(this.maxTimer);
    } catch (err: unknown) {
      this.handleError(err instanceof Error ? err : new Error(String(err)));
    }
  }

  private async processRecording(): Promise<void> {
    if (this.state !== 'listening' || this.pendingProcessing) return;
    this.pendingProcessing = true;
    this.clearTimers();

    try {
      this.setState('transcribing');
      const audioUri = await stopRecording();
      if (!audioUri) {
        if (this.config.autoListen && this.active) {
          await this.startListening();
        } else {
          this.setState('idle');
        }
        return;
      }

      const result = await transcribeAudio(audioUri);
      const text = result.text.trim();

      if (!text) {
        // No speech detected, restart listening
        if (this.config.autoListen && this.active) {
          await this.startListening();
        } else {
          this.setState('idle');
        }
        return;
      }

      if (this.isLikelyEcho(text)) {
        if (this.config.autoListen && this.active) {
          this.scheduleListeningRestart();
        } else {
          this.setState('idle');
        }
        return;
      }

      this.handlers.onTranscription?.(text);
      for (const cb of this.transcriptListeners) cb(text);

      // Check for wake word if configured
      if (this.config.wakeWord) {
        const lowerText = text.toLowerCase();
        const lowerWake = this.config.wakeWord.toLowerCase();
        if (!lowerText.includes(lowerWake)) {
          // Wake word not detected, restart listening
          if (this.config.autoListen && this.active) {
            await this.startListening();
          }
          return;
        }
      }

      // Process through agent
      this.setState('processing');
      const response = await this.agentHandler(text);
      this.handlers.onAgentResponse?.(response);
      for (const cb of this.responseListeners) cb(response);

      // Speak the response
      if (response && this.active) {
        this.setState('speaking');
        this.lastSpokenResponse = response;
        this.lastSpokenAt = Date.now();
        await speakText(response, this.config.ttsProvider);
      }

      // Auto-restart listening
      if (this.config.autoListen && this.active) {
        this.scheduleListeningRestart();
      } else {
        this.setState('idle');
      }
    } catch (err: unknown) {
      this.handleError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      this.pendingProcessing = false;
    }
  }

  /**
   * Manually trigger stop recording and process
   */
  async stopAndProcess(): Promise<void> {
    if (this.state === 'listening') {
      await this.processRecording();
    }
  }

  // ── Helpers ───────────────────────────────────────────────────────

  private setState(state: TalkModeState): void {
    if (this.state === state) return;
    this.state = state;
    this.handlers.onStateChange?.(state);
    for (const cb of this.stateListeners) cb(state);
  }

  private handleError(error: Error): void {
    this.handlers.onError?.(error);
    this.setState('error');

    // Auto-recover: restart listening after a short delay
    if (this.active) {
      if (this.recoveryTimer) {
        clearTimeout(this.recoveryTimer);
      }
      this.recoveryTimer = setTimeout(async () => {
        this.recoveryTimer = null;
        if (this.active) {
          await this.startListening();
        }
      }, 2000);
      unrefTimerIfSupported(this.recoveryTimer);
    }
  }

  private clearTimers(): void {
    if (this.maxTimer) {
      clearTimeout(this.maxTimer);
      this.maxTimer = null;
    }
    if (this.recorderPollTimer) {
      clearInterval(this.recorderPollTimer);
      this.recorderPollTimer = null;
    }
    if (this.recoveryTimer) {
      clearTimeout(this.recoveryTimer);
      this.recoveryTimer = null;
    }
    this.clearRestartTimer();
  }

  private clearRestartTimer(): void {
    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }
  }

  private scheduleListeningRestart(): void {
    this.clearRestartTimer();
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null;
      void this.startListening();
    }, this.config.restartListeningDelayMs);
    unrefTimerIfSupported(this.restartTimer);
  }

  private startRecorderStatusPolling(): void {
    if (this.recorderPollTimer) {
      clearInterval(this.recorderPollTimer);
    }

    this.recorderPollTimer = setInterval(() => {
      void this.handleRecorderStatusTick();
    }, this.config.recorderStatusPollIntervalMs);
    unrefTimerIfSupported(this.recorderPollTimer);
  }

  private async handleRecorderStatusTick(): Promise<void> {
    if (this.state !== 'listening' || this.pendingProcessing) {
      return;
    }

    const now = Date.now();
    const status = getRecordingStatus();
    const metering = status?.metering;
    const durationMillis = status?.durationMillis ?? 0;
    const hasMetering = typeof metering === 'number' && Number.isFinite(metering);
    const isSpeechActive = hasMetering && metering >= (this.config.speechMeteringThreshold ?? -52);

    if (isSpeechActive) {
      if (!this.heardSpeechDuringCurrentTurn) {
        this.speechDetectedAt = now;
      }
      this.heardSpeechDuringCurrentTurn = true;
      this.lastSpeechAt = now;
      return;
    }

    if (!this.heardSpeechDuringCurrentTurn) {
      const initialSilenceElapsed = now - this.listeningStartedAt;
      if (initialSilenceElapsed >= (this.config.initialSilenceTimeoutMs ?? 0)) {
        await this.processRecording();
      }
      return;
    }

    const observedSpeechDuration = Math.max(0, this.lastSpeechAt - this.speechDetectedAt);
    const speechDuration = observedSpeechDuration > 0 ? observedSpeechDuration : durationMillis;
    const silenceElapsed = now - this.lastSpeechAt;
    const silenceTimeout =
      observedSpeechDuration >= 1500
        ? (this.config.silenceTimeoutMs ?? 0)
        : Math.min(
            this.config.shortSpeechSilenceTimeoutMs ?? this.config.silenceTimeoutMs ?? 0,
            this.config.silenceTimeoutMs ?? 0,
          );

    if (speechDuration < (this.config.minSpeechDurationMs ?? 0)) {
      return;
    }

    if (silenceElapsed >= silenceTimeout) {
      await this.processRecording();
    }
  }

  private isLikelyEcho(transcript: string): boolean {
    const response = this.lastSpokenResponse.trim();
    if (!response) return false;
    if (Date.now() - this.lastSpokenAt > (this.config.echoSuppressionWindowMs || 0)) {
      return false;
    }

    const normalize = (value: string) =>
      value
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    const normalizedTranscript = normalize(transcript);
    const normalizedResponse = normalize(response);

    if (!normalizedTranscript || !normalizedResponse) {
      return false;
    }

    if (normalizedTranscript === normalizedResponse) {
      return true;
    }

    if (
      normalizedResponse.includes(normalizedTranscript) ||
      normalizedTranscript.includes(normalizedResponse)
    ) {
      return normalizedTranscript.length >= 12 || normalizedResponse.length >= 12;
    }

    const transcriptTokens = new Set(normalizedTranscript.split(' '));
    const responseTokens = normalizedResponse.split(' ');
    const sharedTokenCount = responseTokens.filter((token) => transcriptTokens.has(token)).length;
    const overlapRatio = sharedTokenCount / Math.max(responseTokens.length, 1);

    return overlapRatio >= 0.8 && sharedTokenCount >= 4;
  }
}
