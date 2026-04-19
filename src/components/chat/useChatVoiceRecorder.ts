import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { GestureResponderEvent } from 'react-native';
import type { Attachment } from '../../types';
import {
  ensureRecordingPermission,
  getRecordingStatus,
  startRecording,
  stopRecording,
  transcribeAudio,
  waitForRecordedAudioFile,
} from '../../services/voice/voice';
import {
  compactVoiceWaveformLevels,
  deleteVoiceNoteFile,
  normalizeVoiceMeteringLevel,
  persistVoiceNoteAttachment,
} from '../../services/voice/voiceNote';
import {
  CHAT_VOICE_CANCEL_GESTURE_DISTANCE_PX,
  CHAT_VOICE_FILE_FLUSH_TIMEOUT_MS,
  CHAT_VOICE_MIN_RECORDING_DURATION_MS,
  CHAT_VOICE_MIN_RECORDING_FILE_SIZE_BYTES,
} from './chatVoiceConstants';

const STATUS_POLL_INTERVAL_MS = 80;

type VoiceRecorderPhase = 'idle' | 'starting' | 'recording' | 'transcribing';

interface UseChatVoiceRecorderMessages {
  noSpeechDetected: string;
  microphonePermissionDenied: string;
  genericFailure: string;
}

interface UseChatVoiceRecorderOptions {
  disabled?: boolean;
  messages: UseChatVoiceRecorderMessages;
  onVoiceNoteReady: (payload: {
    transcript: string;
    attachment: Attachment;
  }) => Promise<void> | void;
}

interface TouchEventLike {
  nativeEvent?: {
    pageY?: number;
  };
}

function getPageY(event?: TouchEventLike): number | null {
  const pageY = event?.nativeEvent?.pageY;
  return typeof pageY === 'number' && Number.isFinite(pageY) ? pageY : null;
}

function resolveRecorderErrorMessage(
  error: unknown,
  messages: UseChatVoiceRecorderMessages,
): string {
  const message = error instanceof Error ? error.message.trim() : String(error).trim();
  if (!message) {
    return messages.genericFailure;
  }

  if (
    /could not be decoded|format is not supported|recorded audio file is empty|recorded audio file is unavailable|audio file exceeds/i.test(
      message,
    )
  ) {
    return messages.noSpeechDetected;
  }

  if (/permission denied|microphone/i.test(message)) {
    return messages.microphonePermissionDenied;
  }

  return message;
}

async function emitRecorderHaptic(kind: 'start' | 'cancel' | 'success' | 'error'): Promise<void> {
  try {
    const Haptics = await import('expo-haptics');
    switch (kind) {
      case 'start':
        await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        break;
      case 'cancel':
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        break;
      case 'success':
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        break;
      case 'error':
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        break;
    }
  } catch {
    // Haptics are best-effort only.
  }
}

export function useChatVoiceRecorder({
  disabled = false,
  messages,
  onVoiceNoteReady,
}: UseChatVoiceRecorderOptions) {
  const [phase, setPhase] = useState<VoiceRecorderPhase>('idle');
  const [elapsedMs, setElapsedMs] = useState(0);
  const [waveformLevels, setWaveformLevels] = useState<number[]>(() =>
    compactVoiceWaveformLevels([], 18),
  );
  const [isCancelling, setIsCancelling] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const phaseRef = useRef<VoiceRecorderPhase>('idle');
  const holdStartYRef = useRef<number | null>(null);
  const cancelIntentRef = useRef(false);
  const releaseRequestedRef = useRef(false);
  const waveformSamplesRef = useRef<number[]>([]);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastDurationMsRef = useRef(0);
  const recordingStartedAtRef = useRef<number | null>(null);
  const unmountedRef = useRef(false);

  const updatePhase = useCallback((nextPhase: VoiceRecorderPhase) => {
    phaseRef.current = nextPhase;
    if (!unmountedRef.current) {
      setPhase(nextPhase);
    }
  }, []);

  const clearPolling = useCallback(() => {
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }, []);

  const resetGestureState = useCallback(() => {
    holdStartYRef.current = null;
    cancelIntentRef.current = false;
    releaseRequestedRef.current = false;
    if (!unmountedRef.current) {
      setIsCancelling(false);
    }
  }, []);

  const resetRecorderState = useCallback(() => {
    clearPolling();
    waveformSamplesRef.current = [];
    lastDurationMsRef.current = 0;
    recordingStartedAtRef.current = null;
    if (!unmountedRef.current) {
      setElapsedMs(0);
      setWaveformLevels(compactVoiceWaveformLevels([], 18));
    }
    resetGestureState();
    updatePhase('idle');
  }, [clearPolling, resetGestureState, updatePhase]);

  const handleTouchMove = useCallback((event?: TouchEventLike) => {
    if (phaseRef.current !== 'starting' && phaseRef.current !== 'recording') {
      return;
    }

    const startY = holdStartYRef.current;
    const currentY = getPageY(event);
    if (startY == null || currentY == null) {
      return;
    }

    const nextIsCancelling = startY - currentY >= CHAT_VOICE_CANCEL_GESTURE_DISTANCE_PX;
    cancelIntentRef.current = nextIsCancelling;
    if (!unmountedRef.current) {
      setIsCancelling(nextIsCancelling);
    }
  }, []);

  const finalizeRecording = useCallback(
    async (
      cancelled: boolean,
      options?: {
        suppressShortCaptureError?: boolean;
      },
    ) => {
      if (phaseRef.current === 'idle' || phaseRef.current === 'transcribing') {
        return;
      }

      if (phaseRef.current === 'starting') {
        releaseRequestedRef.current = true;
        cancelIntentRef.current = cancelled;
        return;
      }

      clearPolling();
      const finalStatus = getRecordingStatus();
      const finalDurationMs =
        typeof finalStatus?.durationMillis === 'number'
          ? Math.max(0, finalStatus.durationMillis)
          : 0;
      if (finalDurationMs > 0) {
        lastDurationMsRef.current = Math.max(lastDurationMsRef.current, finalDurationMs);
      }

      if (typeof finalStatus?.metering === 'number') {
        waveformSamplesRef.current.push(normalizeVoiceMeteringLevel(finalStatus.metering));
      }

      const audioUri = await stopRecording().catch(() => null);
      const wallClockDurationMs =
        recordingStartedAtRef.current == null
          ? 0
          : Math.max(0, Date.now() - recordingStartedAtRef.current);
      const durationMs = Math.max(
        0,
        lastDurationMsRef.current,
        finalDurationMs,
        wallClockDurationMs,
      );

      if (!audioUri) {
        resetRecorderState();
        return;
      }

      if (cancelled) {
        deleteVoiceNoteFile(audioUri);
        await emitRecorderHaptic('cancel');
        resetRecorderState();
        return;
      }

      const fileSnapshot = await waitForRecordedAudioFile(audioUri, {
        minimumBytes: CHAT_VOICE_MIN_RECORDING_FILE_SIZE_BYTES,
        timeoutMs: CHAT_VOICE_FILE_FLUSH_TIMEOUT_MS,
      });

      const hasInspectableSnapshot = fileSnapshot.inspected;
      const fileMissing = hasInspectableSnapshot && !fileSnapshot.exists;
      const fileEmpty = hasInspectableSnapshot && fileSnapshot.sizeBytes <= 0;
      const likelyEmptyCapture =
        durationMs < CHAT_VOICE_MIN_RECORDING_DURATION_MS &&
        (!hasInspectableSnapshot ||
          fileSnapshot.sizeBytes < CHAT_VOICE_MIN_RECORDING_FILE_SIZE_BYTES);

      if (fileMissing || fileEmpty || likelyEmptyCapture) {
        deleteVoiceNoteFile(audioUri);
        if (!options?.suppressShortCaptureError) {
          setErrorMessage(messages.noSpeechDetected);
          await emitRecorderHaptic('error');
        }
        resetRecorderState();
        return;
      }

      updatePhase('transcribing');
      if (!unmountedRef.current) {
        setIsCancelling(false);
      }

      let persistedAttachmentUri: string | null = null;

      try {
        const result = await transcribeAudio(audioUri);
        const transcript = result.text.trim();

        if (!transcript) {
          deleteVoiceNoteFile(audioUri);
          setErrorMessage(messages.noSpeechDetected);
          await emitRecorderHaptic('error');
          resetRecorderState();
          return;
        }

        if (unmountedRef.current) {
          deleteVoiceNoteFile(audioUri);
          resetRecorderState();
          return;
        }

        const attachment = persistVoiceNoteAttachment({
          sourceUri: audioUri,
          durationMs,
          transcript,
          waveformLevels: waveformSamplesRef.current,
        });
        persistedAttachmentUri = attachment.uri;

        await onVoiceNoteReady({ transcript, attachment });
        await emitRecorderHaptic('success');
        resetRecorderState();
      } catch (error) {
        deleteVoiceNoteFile(persistedAttachmentUri || audioUri);
        setErrorMessage(resolveRecorderErrorMessage(error, messages));
        await emitRecorderHaptic('error');
        resetRecorderState();
      }
    },
    [clearPolling, messages, onVoiceNoteReady, resetRecorderState, updatePhase],
  );

  const beginRecording = useCallback(
    async (event?: TouchEventLike) => {
      if (disabled || phaseRef.current !== 'idle') {
        return;
      }

      try {
        setErrorMessage(null);

        const permission = await ensureRecordingPermission();
        if (!permission.granted) {
          throw new Error('Microphone permission denied');
        }

        if (permission.requested) {
          resetRecorderState();
          return;
        }

        const startY = getPageY(event);
        holdStartYRef.current = startY;
        cancelIntentRef.current = false;
        releaseRequestedRef.current = false;
        waveformSamplesRef.current = [];
        lastDurationMsRef.current = 0;
        recordingStartedAtRef.current = null;
        if (!unmountedRef.current) {
          setElapsedMs(0);
          setWaveformLevels(compactVoiceWaveformLevels([], 18));
          setIsCancelling(false);
        }
        updatePhase('starting');
        void emitRecorderHaptic('start');

        await startRecording();
        if (unmountedRef.current) {
          const uri = await stopRecording().catch(() => null);
          deleteVoiceNoteFile(uri);
          resetRecorderState();
          return;
        }

        recordingStartedAtRef.current = Date.now();
        updatePhase('recording');
        pollTimerRef.current = setInterval(() => {
          const status = getRecordingStatus();
          if (!status) {
            return;
          }

          const duration =
            typeof status.durationMillis === 'number' ? Math.max(0, status.durationMillis) : 0;
          lastDurationMsRef.current = duration;
          const level = normalizeVoiceMeteringLevel(status.metering);
          waveformSamplesRef.current.push(level);

          if (!unmountedRef.current) {
            setElapsedMs(duration);
            setWaveformLevels(compactVoiceWaveformLevels(waveformSamplesRef.current, 18));
          }
        }, STATUS_POLL_INTERVAL_MS);

        if (releaseRequestedRef.current) {
          await finalizeRecording(cancelIntentRef.current, { suppressShortCaptureError: true });
        }
      } catch (error) {
        setErrorMessage(resolveRecorderErrorMessage(error, messages));
        await emitRecorderHaptic('error');
        resetRecorderState();
      }
    },
    [disabled, finalizeRecording, messages, resetRecorderState, updatePhase],
  );

  const releaseRecording = useCallback(
    async (cancelled: boolean) => {
      await finalizeRecording(cancelled || cancelIntentRef.current);
    },
    [finalizeRecording],
  );

  useEffect(() => {
    return () => {
      unmountedRef.current = true;
      clearPolling();
      if (phaseRef.current === 'starting' || phaseRef.current === 'recording') {
        void stopRecording()
          .then((uri) => deleteVoiceNoteFile(uri))
          .catch(() => {});
      }
    };
  }, [clearPolling]);

  const pressableHandlers = useMemo(
    () => ({
      onPressIn: (event: GestureResponderEvent) => {
        void beginRecording(event);
      },
      onPressOut: (event: GestureResponderEvent) => {
        handleTouchMove(event);
        void releaseRecording(false);
      },
      onTouchMove: (event: GestureResponderEvent) => {
        handleTouchMove(event);
      },
      onTouchCancel: () => {
        void releaseRecording(true);
      },
    }),
    [beginRecording, handleTouchMove, releaseRecording],
  );

  return {
    phase,
    isActive: phase !== 'idle',
    isRecording: phase === 'recording',
    isTranscribing: phase === 'transcribing',
    isCancelling,
    elapsedMs,
    waveformLevels,
    errorMessage,
    clearError: () => setErrorMessage(null),
    pressableHandlers,
  };
}
