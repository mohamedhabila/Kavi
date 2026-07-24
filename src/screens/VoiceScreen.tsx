// ---------------------------------------------------------------------------
// Kavi — Immersive voice conversation
// ---------------------------------------------------------------------------

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  ScrollView,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useIsFocused, useNavigation } from '@react-navigation/native';
import {
  AlertCircle,
  ArrowLeft,
  Keyboard,
  Mic,
  PauseCircle,
  RotateCcw,
  Settings,
  ShieldCheck,
  Volume2,
} from 'lucide-react-native';
import { ApprovalBanner } from '../components/approval/ApprovalBanner';
import { useAppTheme, AppPalette } from '../theme/useAppTheme';
import { useTranslation } from '../i18n/useTranslation';
import {
  TalkModeManager,
  TalkModeState,
  TalkModeConfig,
  AgentHandler,
} from '../services/voice/talkMode';
import { VoiceOperationError, type VoiceOperationFailureKind } from '../services/voice/voiceErrors';
import { resolveSpeechBackend } from '../services/voice/voiceBackend';
import {
  sendVoiceConversationTurn,
  VoiceConversationBridgeError,
} from '../services/voice/voiceConversationBridge';
import { emitVoiceEvent } from '../services/events/bus';
import { useBackToChat } from '../navigation/useBackToChat';
import { useChatStore } from '../store/useChatStore';
import { createVoiceScreenStyles } from './VoiceScreen.styles';

const defaultConfig: TalkModeConfig = {
  // System speech keeps assistant replies on-device by default. Recorded audio
  // still uses the explicitly configured transcription service.
  ttsProvider: 'system',
  initialSilenceTimeoutMs: 1800,
  silenceTimeoutMs: 900,
  shortSpeechSilenceTimeoutMs: 550,
  maxRecordingMs: 30000,
  autoListen: true,
  restartListeningDelayMs: 320,
  echoSuppressionWindowMs: 12000,
  speechMeteringThreshold: -52,
  minSpeechDurationMs: 250,
  recorderStatusPollIntervalMs: 80,
};

const stateLabelsMap: Record<TalkModeState, string> = {
  idle: 'voice.ready',
  listening: 'voice.listening',
  transcribing: 'voice.transcribing',
  processing: 'voice.processing',
  speaking: 'voice.speaking',
  paused: 'voice.paused',
  error: 'voice.needsAttention',
};

const stateHintsMap: Record<TalkModeState, string> = {
  idle: 'voice.startHint',
  listening: 'voice.finishSpeakingHint',
  transcribing: 'voice.transcribingHint',
  processing: 'voice.processingHint',
  speaking: 'voice.stopReplyHint',
  paused: 'voice.resumeHint',
  error: 'voice.retryHint',
};

const stateColors = (colors: AppPalette): Record<TalkModeState, string> => ({
  idle: colors.textSecondary,
  listening: colors.primary,
  transcribing: colors.warning || colors.primary,
  processing: colors.info || colors.primary,
  speaking: colors.success || colors.primary,
  paused: colors.textTertiary,
  error: colors.danger,
});

type VoiceTurn = {
  id: number;
  transcript: string;
  response?: string;
};

function resolveFailureKind(error: unknown): VoiceOperationFailureKind {
  return error instanceof VoiceOperationError ? error.kind : 'unexpected';
}

function getFailureMessageKey(kind: VoiceOperationFailureKind): string {
  switch (kind) {
    case 'permission_denied':
      return 'voice.permissionDeniedError';
    case 'provider_unavailable':
      return 'voice.providerUnavailableError';
    case 'invalid_recording':
      return 'voice.invalidRecordingError';
    case 'transport':
      return 'voice.networkError';
    case 'provider_response':
      return 'voice.serviceError';
    case 'unexpected':
      return 'voice.genericError';
  }
}

export const VoiceScreen: React.FC = () => {
  const navigation = useNavigation<any>();
  const isScreenFocused = useIsFocused();
  const { colors } = useAppTheme();
  const { t } = useTranslation();
  const styles = useMemo(() => createVoiceScreenStyles(colors), [colors]);
  const activeConversationTitle = useChatStore((store) => {
    const activeConversation = store.activeConversationId
      ? store.conversations.find((conversation) => conversation.id === store.activeConversationId)
      : undefined;
    return activeConversation?.title;
  });

  const [state, setState] = useState<TalkModeState>('idle');
  const [turns, setTurns] = useState<VoiceTurn[]>([]);
  const [voiceError, setVoiceError] = useState<Error | null>(null);
  const [isPreparing, setIsPreparing] = useState(false);
  const nextTurnIdRef = useRef(1);
  const isScreenFocusedRef = useRef(false);
  const startAttemptRef = useRef(0);
  const isPreparingRef = useRef(false);

  const agentHandlerRef = useRef<AgentHandler>(async () => '');
  agentHandlerRef.current = async (input: string) => {
    try {
      return await sendVoiceConversationTurn(input, {
        additionalSystemPrompt: t('voice.conciseResponseInstruction'),
      });
    } catch (error) {
      const kind =
        error instanceof VoiceConversationBridgeError && error.kind === 'unavailable'
          ? 'unexpected'
          : 'provider_response';
      throw new VoiceOperationError(kind, 'Voice assistant turn failed', { cause: error });
    }
  };

  const [manager] = useState(
    () =>
      new TalkModeManager(
        (input) => agentHandlerRef.current(input),
        {
          onError: (error) => setVoiceError(error),
        },
        defaultConfig,
      ),
  );

  const cancelPendingStart = useCallback(() => {
    startAttemptRef.current += 1;
    isPreparingRef.current = false;
  }, []);

  const handleBack = useBackToChat({
    beforeNavigate: (continueNavigation) => {
      cancelPendingStart();
      void manager.stop().finally(continueNavigation);
    },
  });

  useEffect(() => {
    const unsubscribeState = manager.onStateChange((nextState) => {
      setState(nextState);
      if (nextState !== 'error') {
        setVoiceError(null);
      }
      if (nextState === 'error') {
        void emitVoiceEvent('error');
      }
    });
    const unsubscribeTranscript = manager.onTranscript((text) => {
      const id = nextTurnIdRef.current++;
      setTurns((currentTurns) => [...currentTurns, { id, transcript: text }]);
      if (text) {
        void emitVoiceEvent('transcript', { transcript: text });
      }
    });
    const unsubscribeResponse = manager.onResponse((response) => {
      setTurns((currentTurns) => {
        const lastTurn = currentTurns[currentTurns.length - 1];
        if (!lastTurn || lastTurn.response) {
          return [
            ...currentTurns,
            { id: nextTurnIdRef.current++, transcript: '', response },
          ];
        }
        return [
          ...currentTurns.slice(0, -1),
          {
            ...lastTurn,
            response,
          },
        ];
      });
      if (response) {
        void emitVoiceEvent('response');
      }
    });

    return () => {
      unsubscribeState();
      unsubscribeTranscript();
      unsubscribeResponse();
      void manager.stop();
    };
  }, [manager]);

  useFocusEffect(
    useCallback(
      () => {
        isScreenFocusedRef.current = true;
        isPreparingRef.current = false;
        setIsPreparing(false);

        return () => {
          isScreenFocusedRef.current = false;
          cancelPendingStart();
          void manager.stop();
        };
      },
      [cancelPendingStart, manager],
    ),
  );

  const handleStart = useCallback(async () => {
    if (isPreparingRef.current) {
      return;
    }

    const attempt = startAttemptRef.current + 1;
    startAttemptRef.current = attempt;
    isPreparingRef.current = true;
    setIsPreparing(true);
    setVoiceError(null);
    try {
      const speechBackend = await resolveSpeechBackend();
      if (!isScreenFocusedRef.current || startAttemptRef.current !== attempt) {
        return;
      }
      if (!speechBackend) {
        setVoiceError(
          new VoiceOperationError('provider_unavailable', 'Speech provider unavailable'),
        );
        setState('error');
        void emitVoiceEvent('error');
        return;
      }

      await manager.start();
      if (
        isScreenFocusedRef.current &&
        startAttemptRef.current === attempt &&
        manager.getState() !== 'error'
      ) {
        void emitVoiceEvent('started');
      }
    } catch (error) {
      if (!isScreenFocusedRef.current || startAttemptRef.current !== attempt) {
        return;
      }
      setVoiceError(
        error instanceof Error
          ? error
          : new VoiceOperationError('unexpected', 'Voice conversation failed to start'),
      );
      setState('error');
      void emitVoiceEvent('error');
    } finally {
      if (startAttemptRef.current === attempt) {
        isPreparingRef.current = false;
        if (isScreenFocusedRef.current) {
          setIsPreparing(false);
        }
      }
    }
  }, [manager]);

  const handlePrimaryAction = useCallback(() => {
    if (isPreparing) {
      return;
    }

    switch (state) {
      case 'idle':
      case 'error':
        void handleStart();
        break;
      case 'listening':
        void manager.stopAndProcess();
        break;
      case 'speaking':
        void manager.pause();
        break;
      case 'paused':
        void manager.resume();
        break;
      case 'transcribing':
      case 'processing':
        break;
    }
  }, [handleStart, isPreparing, manager, state]);

  const handleEndSession = useCallback(async () => {
    cancelPendingStart();
    setIsPreparing(false);
    await manager.stop();
    void emitVoiceEvent('stopped');
  }, [cancelPendingStart, manager]);

  const handleContinueWithText = useCallback(async () => {
    cancelPendingStart();
    await manager.stop();
    navigation.navigate('Chat');
  }, [cancelPendingStart, manager, navigation]);

  const failureKind = voiceError ? resolveFailureKind(voiceError) : null;
  const handleOpenRecoverySettings = useCallback(async () => {
    cancelPendingStart();
    await manager.stop();
    if (failureKind === 'permission_denied') {
      try {
        await Linking.openSettings();
      } catch {
        setVoiceError(
          new VoiceOperationError('unexpected', 'Device settings could not be opened'),
        );
        setState('error');
        void emitVoiceEvent('error');
      }
      return;
    }

    navigation.navigate('Settings', {
      destination: 'advanced-ai',
      returnTo: { name: 'Voice' },
    });
  }, [cancelPendingStart, failureKind, manager, navigation]);

  const isSessionActive = state !== 'idle' && state !== 'error';
  const isPrimaryDisabled =
    isPreparing || state === 'transcribing' || state === 'processing';
  const semanticState = isPreparing ? 'processing' : state;
  const statusColors = useMemo(() => stateColors(colors), [colors]);
  const statusLabel = isPreparing ? t('voice.preparing') : t(stateLabelsMap[state]);
  const statusHint = isPreparing ? t('voice.preparingHint') : t(stateHintsMap[state]);
  const primaryActionLabel = (() => {
    if (isPreparing) return t('voice.preparing');
    switch (state) {
      case 'listening':
        return t('voice.finishSpeaking');
      case 'speaking':
        return t('voice.stopReply');
      case 'paused':
        return t('voice.resume');
      case 'error':
        return t('common.retry');
      default:
        return t('voice.start');
    }
  })();

  const stateIcon = (() => {
    if (isPreparing || state === 'transcribing' || state === 'processing') {
      return <ActivityIndicator size="large" color={statusColors[semanticState]} />;
    }
    switch (state) {
      case 'listening':
        return <Mic size={48} color={colors.primary} />;
      case 'speaking':
        return <Volume2 size={48} color={statusColors[state]} />;
      case 'paused':
        return <PauseCircle size={48} color={statusColors[state]} />;
      case 'error':
        return <AlertCircle size={48} color={statusColors[state]} />;
      default:
        return <Mic size={48} color={colors.textTertiary} />;
    }
  })();

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <TouchableOpacity
          onPress={handleBack}
          accessibilityRole="button"
          accessibilityLabel={t('common.back')}
          style={styles.headerAction}
          testID="voice-back-button"
        >
          <ArrowLeft size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{t('voice.title')}</Text>
        <View style={styles.headerAction} />
      </View>

      <ApprovalBanner enabled={isScreenFocused} />

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.micSection}>
          <TouchableOpacity
            style={[
              styles.micButton,
              isSessionActive ? styles.micButtonActive : null,
              state === 'error' ? styles.micButtonError : null,
              { borderColor: statusColors[semanticState] },
            ]}
            onPress={handlePrimaryAction}
            disabled={isPrimaryDisabled}
            activeOpacity={0.72}
            accessibilityRole="button"
            accessibilityLabel={primaryActionLabel}
            accessibilityHint={statusHint}
            accessibilityState={{
              busy: isPreparing || state === 'processing' || state === 'transcribing',
              disabled: isPrimaryDisabled,
            }}
            testID="voice-primary-button"
          >
            {stateIcon}
          </TouchableOpacity>

          <Text
            style={[styles.stateLabel, { color: statusColors[semanticState] }]}
            accessibilityLiveRegion="polite"
            testID="voice-status"
          >
            {statusLabel}
          </Text>
          <Text style={styles.hint}>{statusHint}</Text>
        </View>

        {voiceError ? (
          <View style={styles.errorBox} accessibilityRole="alert" testID="voice-error">
            <AlertCircle size={18} color={colors.danger} />
            <View style={styles.errorCopy}>
              <Text style={styles.errorTitle}>{t('voice.errorTitle')}</Text>
              <Text style={styles.errorText}>{t(getFailureMessageKey(failureKind!))}</Text>
            </View>
          </View>
        ) : null}

        <View style={styles.actionRow}>
          {isSessionActive ? (
            <TouchableOpacity
              accessibilityLabel={t('voice.endSession')}
              accessibilityRole="button"
              onPress={handleEndSession}
              style={styles.secondaryButton}
              testID="voice-end-session"
            >
              <Text style={styles.secondaryButtonText}>{t('voice.endSession')}</Text>
            </TouchableOpacity>
          ) : null}
          {voiceError ? (
            <TouchableOpacity
              accessibilityLabel={t('common.retry')}
              accessibilityRole="button"
              onPress={handleStart}
              style={styles.primaryTextButton}
              testID="voice-retry-button"
            >
              <RotateCcw size={18} color={colors.onPrimary} />
              <Text style={styles.primaryTextButtonText}>{t('common.retry')}</Text>
            </TouchableOpacity>
          ) : null}
          {failureKind === 'permission_denied' || failureKind === 'provider_unavailable' ? (
            <TouchableOpacity
              accessibilityLabel={
                failureKind === 'permission_denied'
                  ? t('voice.openDeviceSettings')
                  : t('voice.setUpVoice')
              }
              accessibilityRole="button"
              onPress={handleOpenRecoverySettings}
              style={styles.secondaryButton}
              testID="voice-recovery-settings"
            >
              <Settings size={18} color={colors.text} />
              <Text style={styles.secondaryButtonText}>
                {failureKind === 'permission_denied'
                  ? t('voice.openDeviceSettings')
                  : t('voice.setUpVoice')}
              </Text>
            </TouchableOpacity>
          ) : null}
          <TouchableOpacity
            accessibilityLabel={t('voice.continueWithText')}
            accessibilityRole="button"
            onPress={handleContinueWithText}
            style={styles.secondaryButton}
            testID="voice-continue-with-text"
          >
            <Keyboard size={18} color={colors.text} />
            <Text style={styles.secondaryButtonText}>{t('voice.continueWithText')}</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.privacyCard}>
          <ShieldCheck size={20} color={colors.primary} />
          <View style={styles.privacyCopy}>
            <Text style={styles.privacyTitle}>{t('voice.privacyTitle')}</Text>
            <Text style={styles.privacyText}>{t('voice.privacyDescription')}</Text>
            <Text style={styles.savedToChatText}>
              {t('voice.savedToChat', {
                title: activeConversationTitle || t('voice.currentChat'),
              })}
            </Text>
          </View>
        </View>

        <View style={styles.conversationSection}>
          <Text style={styles.sectionTitle}>{t('voice.sessionTranscript')}</Text>
          {turns.length === 0 ? (
            <Text style={styles.placeholderText}>{t('voice.conversationPlaceholder')}</Text>
          ) : (
            turns.map((turn) => (
              <View key={turn.id} style={styles.turnGroup}>
                {turn.transcript ? (
                  <View style={styles.transcriptBox}>
                    <Text style={styles.boxLabel}>{t('voice.you')}</Text>
                    <Text style={styles.transcriptText}>{turn.transcript}</Text>
                  </View>
                ) : null}
                {turn.response ? (
                  <View style={styles.responseBox}>
                    <Text style={styles.boxLabel}>{t('voice.kavi')}</Text>
                    <Text style={styles.responseText}>{turn.response}</Text>
                  </View>
                ) : null}
              </View>
            ))
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
};
