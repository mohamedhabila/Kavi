import React, { useMemo } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { Pause, Play, Mic } from 'lucide-react-native';
import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import type { Attachment } from '../../types/attachment';
import { AppPalette, useAppTheme } from '../../theme/useAppTheme';
import { compactVoiceWaveformLevels } from '../../services/voice/voiceNote';

interface AudioAttachmentCardProps {
  attachment: Attachment;
  isUser?: boolean;
  compact?: boolean;
  interactive?: boolean;
}

function formatAudioDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return '0:00';
  }

  const totalSeconds = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(totalSeconds / 60);
  const remainder = totalSeconds % 60;
  return `${minutes}:${String(remainder).padStart(2, '0')}`;
}

function buildDurationLabel(currentTime: number, duration: number): string {
  if (currentTime > 0.15 && duration > 0.15) {
    return `${formatAudioDuration(currentTime)} / ${formatAudioDuration(duration)}`;
  }

  return formatAudioDuration(duration);
}

export const AudioAttachmentCard: React.FC<AudioAttachmentCardProps> = ({
  attachment,
  isUser = false,
  compact = false,
  interactive = true,
}) => {
  const { colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors, isUser, compact), [colors, compact, isUser]);
  const player = useAudioPlayer(attachment.uri, {
    updateInterval: compact ? 250 : 120,
    downloadFirst: /^https?:\/\//i.test(attachment.uri),
  });
  const status = useAudioPlayerStatus(player);
  const transcript = attachment.transcript?.trim() || '';
  const waveformLevels = useMemo(
    () => compactVoiceWaveformLevels(attachment.waveformLevels ?? [], compact ? 14 : 24),
    [attachment.waveformLevels, compact],
  );

  const durationSeconds =
    status.duration > 0 ? status.duration : Math.max(0, (attachment.durationMs ?? 0) / 1000);
  const currentTimeSeconds = Math.max(0, status.currentTime || 0);
  const progress = durationSeconds > 0 ? Math.min(1, currentTimeSeconds / durationSeconds) : 0;
  const playedBarCount = Math.round(progress * waveformLevels.length);

  const handleTogglePlayback = () => {
    if (!interactive) {
      return;
    }

    if (status.playing) {
      player.pause();
      return;
    }

    if (durationSeconds > 0 && currentTimeSeconds >= durationSeconds - 0.12) {
      player.seekTo(0);
    }

    player.play();
  };

  return (
    <View style={styles.card} testID={`audio-attachment-card-${attachment.id}`}>
      <Pressable
        style={styles.playButton}
        onPress={handleTogglePlayback}
        disabled={!interactive}
        accessibilityRole={interactive ? 'button' : undefined}
        accessibilityLabel={
          interactive
            ? `${status.playing ? 'Pause' : 'Play'} ${attachment.name || 'voice note'}`
            : attachment.name || 'voice note'
        }
        testID={`audio-attachment-toggle-${attachment.id}`}
      >
        {interactive && status.isBuffering ? (
          <ActivityIndicator size="small" color={isUser ? colors.onPrimary : colors.text} />
        ) : interactive ? (
          status.playing ? (
            <Pause size={compact ? 14 : 16} color={isUser ? colors.onPrimary : colors.text} />
          ) : (
            <Play size={compact ? 14 : 16} color={isUser ? colors.onPrimary : colors.text} />
          )
        ) : (
          <Mic size={compact ? 14 : 16} color={isUser ? colors.onPrimary : colors.text} />
        )}
      </Pressable>

      <View style={styles.content}>
        <View style={styles.metaRow}>
          <Text style={styles.title} numberOfLines={1}>
            {attachment.name || 'Voice note'}
          </Text>
          <Text style={styles.duration} numberOfLines={1}>
            {buildDurationLabel(currentTimeSeconds, durationSeconds)}
          </Text>
        </View>

        <View style={styles.waveformRow}>
          {waveformLevels.map((level, index) => (
            <View
              key={`${attachment.id}-wave-${index}`}
              style={[
                styles.waveformBar,
                {
                  height: Math.max(compact ? 8 : 10, Math.round(level * (compact ? 16 : 24))),
                },
                index < playedBarCount ? styles.waveformBarActive : styles.waveformBarInactive,
              ]}
            />
          ))}
        </View>

        {transcript ? (
          <Text style={styles.transcript} numberOfLines={compact ? 1 : 2}>
            {transcript}
          </Text>
        ) : null}
      </View>
    </View>
  );
};

const createStyles = (colors: AppPalette, isUser: boolean, compact: boolean) =>
  StyleSheet.create({
    card: {
      width: '100%',
      borderRadius: compact ? 14 : 18,
      borderWidth: 1,
      borderColor: isUser ? 'rgba(255,255,255,0.18)' : colors.subtleBorder,
      backgroundColor: isUser ? 'rgba(255,255,255,0.12)' : colors.codeBackground,
      paddingHorizontal: compact ? 10 : 12,
      paddingVertical: compact ? 8 : 10,
      flexDirection: 'row',
      alignItems: 'center',
      gap: compact ? 8 : 10,
    },
    playButton: {
      width: compact ? 32 : 40,
      height: compact ? 32 : 40,
      borderRadius: 999,
      backgroundColor: isUser ? 'rgba(255,255,255,0.16)' : colors.surfaceAlt,
      alignItems: 'center',
      justifyContent: 'center',
      flexShrink: 0,
    },
    content: {
      flex: 1,
      minWidth: 0,
      gap: compact ? 4 : 6,
    },
    metaRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    title: {
      flex: 1,
      minWidth: 0,
      color: isUser ? colors.onPrimary : colors.text,
      fontSize: compact ? 11 : 12,
      fontWeight: '700',
    },
    duration: {
      color: isUser ? 'rgba(255,255,255,0.82)' : colors.textSecondary,
      fontSize: compact ? 10 : 11,
      fontVariant: ['tabular-nums'],
    },
    waveformRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: compact ? 2 : 3,
      minHeight: compact ? 16 : 24,
    },
    waveformBar: {
      width: compact ? 3 : 4,
      borderRadius: 999,
    },
    waveformBarActive: {
      backgroundColor: isUser ? colors.onPrimary : colors.primary,
    },
    waveformBarInactive: {
      backgroundColor: isUser ? 'rgba(255,255,255,0.34)' : colors.border,
    },
    transcript: {
      color: isUser ? 'rgba(255,255,255,0.88)' : colors.textSecondary,
      fontSize: compact ? 10 : 11,
      lineHeight: compact ? 14 : 16,
    },
  });
