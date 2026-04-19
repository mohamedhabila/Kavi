// ---------------------------------------------------------------------------
// Kavi — Voice / Talk Mode Screen
// ---------------------------------------------------------------------------
// Full-screen voice interface: tap to start, auto-listen, visual feedback.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import {
  ArrowLeft,
  Mic,
  MicOff,
  Volume2,
  Loader,
  AlertCircle,
  PauseCircle,
} from 'lucide-react-native';
import { useAppTheme, AppPalette } from '../theme/useAppTheme';
import { useTranslation } from '../i18n';
import {
  TalkModeManager,
  TalkModeState,
  TalkModeConfig,
  AgentHandler,
} from '../services/voice/talkMode';
import { runOrchestrator, OrchestratorCallbacks } from '../engine/orchestrator';
import { useSettingsStore } from '../store/useSettingsStore';
import { generateId } from '../utils/id';
import { emitVoiceEvent } from '../services/events/bus';
import { useBackToChat } from '../navigation/useBackToChat';
import {
  providerRequiresApiKey,
  resolveEnabledProvider,
  resolveProviderApiKey,
} from '../services/llm/providerSupport';

const defaultConfig: TalkModeConfig = {
  ttsProvider: 'auto',
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
  idle: 'voice.tapToSpeak',
  listening: 'voice.listening',
  transcribing: 'voice.transcribing',
  processing: 'voice.processing',
  speaking: 'voice.speaking',
  paused: 'voice.paused',
  error: 'voice.error',
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

export const VoiceScreen: React.FC = () => {
  const navigation = useNavigation();
  const { colors } = useAppTheme();
  const { t } = useTranslation();
  const handleBack = useBackToChat();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const [state, setState] = useState<TalkModeState>('idle');
  const [transcript, setTranscript] = useState<string>('');
  const [response, setResponse] = useState<string>('');
  const [errorMsg, setErrorMsg] = useState<string>('');

  const agentHandlerRef = useRef<AgentHandler>(async (input: string) => {
    const settings = useSettingsStore.getState();
    const provider = resolveEnabledProvider(settings.providers, settings.activeProviderId);
    if (!provider) return t('chat.noProvider');

    const model =
      (provider.id === settings.activeProviderId ? settings.activeModel || '' : '') ||
      provider.model;
    if (!model) return t('chat.noModel');

    const apiKey = await resolveProviderApiKey(provider);
    if (providerRequiresApiKey(provider) && !apiKey) return t('chat.noApiKey');

    const voiceSystemPrompt = settings.systemPrompt
      ? `${settings.systemPrompt}\n${t('voice.conciseResponseInstruction')}`
      : t('voice.defaultSystemPrompt');

    let result = '';
    const convId = `voice_${generateId()}`;
    const callbacks: OrchestratorCallbacks = {
      onStateChange: () => {},
      onToken: (token: string) => {
        result += token;
      },
      onReasoning: () => {},
      onAssistantStreamReset: () => {
        result = '';
      },
      onToolCallStart: () => {},
      onToolCallComplete: () => {},
      onAssistantMessage: (content) => {
        if (content) result = content;
      },
      onToolMessage: () => {},
      onError: (error) => {
        result = result || `Error: ${error.message}`;
      },
      onUsage: () => {},
      onDone: () => {},
    };
    try {
      await runOrchestrator(
        {
          provider: { ...provider, apiKey },
          model,
          conversationId: convId,
          systemPrompt: voiceSystemPrompt,
          messages: [{ id: generateId(), role: 'user', content: input, timestamp: Date.now() }],
          linkUnderstandingEnabled: settings.linkUnderstandingEnabled,
          mediaUnderstandingEnabled: settings.mediaUnderstandingEnabled,
          maxLinks: settings.maxLinks,
        },
        callbacks,
      );
    } catch (err: unknown) {
      if (!result) result = `Error: ${err instanceof Error ? err.message : String(err)}`;
    }
    return result;
  });

  const [manager] = useState(
    () =>
      new TalkModeManager(
        agentHandlerRef.current,
        {
          onError: (err) => setErrorMsg(err.message),
        },
        defaultConfig,
      ),
  );

  useEffect(() => {
    const unsubState = manager.onStateChange((s) => {
      setState(s);
      if (s !== 'error') setErrorMsg('');
      if (s === 'error') void emitVoiceEvent('error');
    });
    const unsubTranscript = manager.onTranscript((text) => {
      setTranscript(text);
      if (text) void emitVoiceEvent('transcript', { transcript: text });
    });
    const unsubResponse = manager.onResponse((r) => {
      setResponse(r);
      if (r) void emitVoiceEvent('response');
    });

    return () => {
      unsubState();
      unsubTranscript();
      unsubResponse();
      manager.stop();
    };
  }, [manager]);

  const handleToggle = useCallback(() => {
    if (state === 'idle' || state === 'error') {
      setErrorMsg('');
      manager.start();
      void emitVoiceEvent('started');
    } else {
      manager.stop();
      void emitVoiceEvent('stopped');
    }
  }, [state, manager]);

  const isActive = state !== 'idle' && state !== 'error';
  const sColors = useMemo(() => stateColors(colors), [colors]);

  const stateIcon = useMemo(() => {
    switch (state) {
      case 'listening':
        return <Mic size={48} color={colors.primary} />;
      case 'transcribing':
        return <Loader size={48} color={sColors[state]} />;
      case 'processing':
        return <Loader size={48} color={sColors[state]} />;
      case 'speaking':
        return <Volume2 size={48} color={sColors[state]} />;
      case 'paused':
        return <PauseCircle size={48} color={sColors[state]} />;
      case 'error':
        return <AlertCircle size={48} color={sColors[state]} />;
      default:
        return <Mic size={48} color={colors.textTertiary} />;
    }
  }, [state, colors, sColors]);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity
          onPress={handleBack}
          accessibilityRole="button"
          accessibilityLabel={t('common.back')}
        >
          <ArrowLeft size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{t('voice.title')}</Text>
        <View style={{ width: 24 }} />
      </View>

      <View style={styles.content}>
        {/* Microphone button — centered prominently */}
        <View style={styles.micSection}>
          <TouchableOpacity
            style={[
              styles.micButton,
              isActive && styles.micButtonActive,
              state === 'error' && styles.micButtonError,
              { borderColor: sColors[state] },
            ]}
            onPress={handleToggle}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel={isActive ? t('voice.tapToStop') : t('voice.tapToStart')}
            accessibilityState={{ busy: state === 'processing' || state === 'transcribing' }}
          >
            {stateIcon}
          </TouchableOpacity>

          <Text style={[styles.stateLabel, { color: sColors[state] }]}>
            {t(stateLabelsMap[state])}
          </Text>

          <Text style={styles.hint}>
            {state === 'error'
              ? t('voice.tapToStart')
              : isActive
                ? t('voice.tapToStop')
                : t('voice.tapToStart')}
          </Text>
        </View>

        {/* Error message */}
        {errorMsg ? (
          <View style={styles.errorBox}>
            <AlertCircle size={14} color={colors.danger} />
            <Text style={styles.errorText} numberOfLines={3}>
              {errorMsg}
            </Text>
          </View>
        ) : null}

        {/* Conversation area */}
        <ScrollView
          style={styles.conversationArea}
          contentContainerStyle={styles.conversationContent}
        >
          {transcript ? (
            <View style={styles.transcriptBox}>
              <Text style={styles.boxLabel}>{t('voice.you')}</Text>
              <Text style={styles.transcriptText}>{transcript}</Text>
            </View>
          ) : null}

          {response ? (
            <View style={styles.responseBox}>
              <Text style={styles.boxLabel}>{t('voice.ai')}</Text>
              <Text style={styles.responseText}>{response}</Text>
            </View>
          ) : null}

          {!transcript && !response && (
            <Text style={styles.placeholderText}>{t('voice.conversationPlaceholder')}</Text>
          )}
        </ScrollView>
      </View>
    </SafeAreaView>
  );
};

const createStyles = (colors: AppPalette) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
    header: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingHorizontal: 16,
      paddingVertical: 12,
      backgroundColor: colors.header,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    headerTitle: {
      fontSize: 18,
      fontWeight: '700',
      color: colors.text,
    },
    content: {
      flex: 1,
      padding: 16,
    },
    micSection: {
      alignItems: 'center',
      paddingVertical: 24,
    },
    stateLabel: {
      fontSize: 16,
      fontWeight: '600',
      marginTop: 16,
    },
    hint: {
      fontSize: 13,
      color: colors.textTertiary,
      marginTop: 4,
    },
    micButton: {
      width: 120,
      height: 120,
      borderRadius: 60,
      backgroundColor: colors.surface,
      justifyContent: 'center',
      alignItems: 'center',
      borderWidth: 3,
      borderColor: colors.border,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.1,
      shadowRadius: 8,
      elevation: 4,
    },
    micButtonActive: {
      backgroundColor: colors.primarySoft,
      shadowOpacity: 0.2,
      shadowRadius: 12,
    },
    micButtonError: {
      backgroundColor: colors.dangerSoft,
    },
    errorBox: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      backgroundColor: colors.dangerSoft,
      borderRadius: 10,
      padding: 12,
      marginBottom: 12,
    },
    errorText: {
      flex: 1,
      fontSize: 13,
      color: colors.danger,
    },
    conversationArea: {
      flex: 1,
    },
    conversationContent: {
      flexGrow: 1,
      gap: 12,
    },
    transcriptBox: {
      backgroundColor: colors.surface,
      borderRadius: 12,
      padding: 14,
      borderWidth: 1,
      borderColor: colors.border,
    },
    responseBox: {
      backgroundColor: colors.surface,
      borderRadius: 12,
      padding: 14,
      borderWidth: 1,
      borderColor: colors.primarySoft,
    },
    boxLabel: {
      fontSize: 11,
      fontWeight: '700',
      color: colors.textTertiary,
      textTransform: 'uppercase',
      letterSpacing: 0.5,
      marginBottom: 6,
    },
    transcriptText: {
      fontSize: 15,
      color: colors.text,
      lineHeight: 22,
    },
    responseText: {
      fontSize: 15,
      color: colors.text,
      lineHeight: 22,
    },
    placeholderText: {
      fontSize: 14,
      color: colors.textTertiary,
      textAlign: 'center',
      marginTop: 24,
    },
  });
