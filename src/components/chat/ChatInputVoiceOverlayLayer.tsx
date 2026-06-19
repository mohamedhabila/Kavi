import React from 'react';
import { View } from 'react-native';
import type { ChatInputStyles } from './ChatInput.styles';
import { VoiceRecorderOverlay } from './VoiceRecorderOverlay';

type TranslationFn = (key: string, params?: Record<string, string | number>) => string;

type ChatInputVoiceOverlayLayerProps = {
  elapsedMs: number;
  isActive: boolean;
  isCancelling: boolean;
  isTranscribing: boolean;
  styles: ChatInputStyles;
  t: TranslationFn;
  waveformLevels: number[];
};

export const ChatInputVoiceOverlayLayer = React.memo(function ChatInputVoiceOverlayLayer(
  props: ChatInputVoiceOverlayLayerProps,
) {
  if (!props.isActive) {
    return null;
  }

  return (
    <View
      pointerEvents="none"
      style={props.styles.voiceOverlayLayer}
      testID="chat-voice-overlay-layer"
    >
      <VoiceRecorderOverlay
        elapsedMs={props.elapsedMs}
        waveformLevels={props.waveformLevels}
        isCancelling={props.isCancelling}
        isTranscribing={props.isTranscribing}
        title={
          props.isTranscribing
            ? props.t('chat.voiceTranscribingTitle')
            : props.isCancelling
              ? props.t('chat.voiceReleaseToCancel')
              : props.t('chat.voiceSpeakNow')
        }
        subtitle={props.isTranscribing ? props.t('voice.transcribing') : props.t('voice.listening')}
        primaryHint={
          props.isTranscribing
            ? props.t('chat.voicePreparingTranscript')
            : props.t('chat.voiceReleaseToSend')
        }
        secondaryHint={props.isTranscribing ? undefined : props.t('chat.voiceSlideUpToCancel')}
        pillLabel={props.isTranscribing ? props.t('voice.transcribing') : props.t('voice.listening')}
      />
    </View>
  );
});
