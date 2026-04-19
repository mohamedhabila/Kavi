import React, { useMemo } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import Svg, { Defs, Ellipse, LinearGradient, Path, Rect, Stop } from 'react-native-svg';
import { AppPalette, useAppTheme } from '../../theme/useAppTheme';

interface VoiceRecorderOverlayProps {
  elapsedMs: number;
  waveformLevels: number[];
  isCancelling: boolean;
  isTranscribing: boolean;
  title: string;
  subtitle: string;
  primaryHint: string;
  secondaryHint?: string;
  pillLabel: string;
}

function formatElapsed(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

export const VoiceRecorderOverlay: React.FC<VoiceRecorderOverlayProps> = ({
  elapsedMs,
  waveformLevels,
  isCancelling,
  isTranscribing,
  title,
  subtitle,
  primaryHint,
  secondaryHint,
  pillLabel,
}) => {
  const { colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  return (
    <View
      style={[styles.container, isCancelling ? styles.containerCancelling : null]}
      testID="chat-voice-overlay"
    >
      <Svg style={StyleSheet.absoluteFillObject} viewBox="0 0 100 100" preserveAspectRatio="none">
        <Defs>
          <LinearGradient id="voice-bg" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor="#10192f" />
            <Stop offset="0.42" stopColor="#2f5364" />
            <Stop offset="0.72" stopColor="#7bb8ff" />
            <Stop offset="1" stopColor="#ff9b77" />
          </LinearGradient>
          <LinearGradient id="voice-wave" x1="0" y1="0" x2="1" y2="0">
            <Stop offset="0" stopColor="rgba(255,245,180,0.88)" />
            <Stop offset="1" stopColor="rgba(255,255,255,0.12)" />
          </LinearGradient>
        </Defs>

        <Rect x="0" y="0" width="100" height="100" fill="url(#voice-bg)" />
        <Ellipse cx="20" cy="78" rx="28" ry="20" fill="rgba(198,255,214,0.5)" />
        <Ellipse cx="56" cy="72" rx="26" ry="20" fill="rgba(169,229,255,0.44)" />
        <Ellipse cx="84" cy="76" rx="24" ry="18" fill="rgba(196,178,255,0.34)" />
        <Path
          d="M0 70 C 14 62, 26 84, 40 72 S 68 58, 82 70 S 94 84, 100 73 L 100 100 L 0 100 Z"
          fill="url(#voice-wave)"
        />
      </Svg>

      <View style={styles.headerRow}>
        <Text style={styles.subtitle}>{subtitle}</Text>
        <Text style={styles.elapsed}>{formatElapsed(elapsedMs)}</Text>
      </View>

      <View style={styles.centerBlock}>
        <Text style={styles.title}>{title}</Text>
      </View>

      <View style={styles.waveformRow}>
        {waveformLevels.map((level, index) => (
          <View
            key={`live-wave-${index}`}
            style={[
              styles.waveformBar,
              {
                height: Math.max(10, Math.round(level * 26)),
              },
            ]}
          />
        ))}
      </View>

      <View style={styles.hintsRow}>
        <Text style={styles.hintText}>{primaryHint}</Text>
        {secondaryHint ? <Text style={styles.hintText}>{secondaryHint}</Text> : <View />}
      </View>

      <View style={[styles.pill, isCancelling ? styles.pillCancelling : null]}>
        {isTranscribing ? <ActivityIndicator size="small" color="#ffffff" /> : null}
        <Text style={styles.pillLabel}>{pillLabel}</Text>
      </View>
    </View>
  );
};

const createStyles = (colors: AppPalette) =>
  StyleSheet.create({
    container: {
      position: 'relative',
      minHeight: 188,
      borderRadius: 24,
      overflow: 'hidden',
      marginHorizontal: 10,
      marginTop: 10,
      marginBottom: 6,
      paddingHorizontal: 18,
      paddingTop: 16,
      paddingBottom: 16,
      justifyContent: 'space-between',
      shadowColor: '#000',
      shadowOpacity: 0.22,
      shadowOffset: { width: 0, height: 10 },
      shadowRadius: 20,
      elevation: 12,
    },
    containerCancelling: {
      opacity: 0.86,
    },
    headerRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      gap: 12,
    },
    subtitle: {
      color: 'rgba(255,255,255,0.9)',
      fontSize: 13,
      fontWeight: '600',
    },
    elapsed: {
      color: 'rgba(255,255,255,0.9)',
      fontSize: 13,
      fontWeight: '700',
      fontVariant: ['tabular-nums'],
    },
    centerBlock: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 16,
    },
    title: {
      color: '#ffffff',
      fontSize: 26,
      lineHeight: 32,
      textAlign: 'center',
      fontWeight: '500',
    },
    waveformRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 4,
      minHeight: 28,
    },
    waveformBar: {
      width: 4,
      borderRadius: 999,
      backgroundColor: 'rgba(255,255,255,0.7)',
    },
    hintsRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      gap: 12,
      marginTop: 4,
    },
    hintText: {
      color: 'rgba(17, 20, 28, 0.82)',
      fontSize: 12,
      fontWeight: '600',
    },
    pill: {
      alignSelf: 'stretch',
      minHeight: 46,
      borderRadius: 999,
      backgroundColor: '#17923a',
      alignItems: 'center',
      justifyContent: 'center',
      flexDirection: 'row',
      gap: 8,
      marginTop: 10,
    },
    pillCancelling: {
      backgroundColor: colors.danger,
    },
    pillLabel: {
      color: '#ffffff',
      fontSize: 15,
      fontWeight: '700',
    },
  });
