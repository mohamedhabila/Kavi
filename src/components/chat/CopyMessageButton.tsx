import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Alert } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { Check, Copy } from 'lucide-react-native';

import { createLogger } from '../../utils/logger';
import { MessageActionButton } from './MessageActionButton';

const logger = createLogger('CopyMessageButton');

/** How long the button shows that the copy landed before it reads "Copy" again. */
export const COPY_CONFIRMATION_MS = 1_500;

type TranslationFn = (key: string, params?: Record<string, string | number>) => string;

type CopyMessageButtonProps = {
  color: string;
  confirmedColor: string;
  t: TranslationFn;
  testID?: string;
  /** Empty text disables the button. */
  text: string;
};

/**
 * Copies a message and says so: the icon turns into a check, a light haptic lands, and
 * screen readers hear "Copied". The copy used to be fire-and-forget, so nothing showed
 * it worked and a failed write was an unhandled rejection.
 */
export const CopyMessageButton = React.memo(function CopyMessageButton(
  props: CopyMessageButtonProps,
) {
  const [copied, setCopied] = useState(false);
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mounted = useRef(true);

  useEffect(
    () => () => {
      mounted.current = false;
      if (resetTimer.current) clearTimeout(resetTimer.current);
    },
    [],
  );

  const { t, text } = props;
  const copy = useCallback(async () => {
    try {
      await Clipboard.setStringAsync(text);
    } catch (error: unknown) {
      logger.warn('Could not copy a message', {
        error: error instanceof Error ? error.message : String(error),
      });
      Alert.alert(t('common.error'), t('chat.copyMessageFailed'));
      return;
    }
    if (!mounted.current) return;
    setCopied(true);
    AccessibilityInfo.announceForAccessibility(t('common.copied'));
    if (resetTimer.current) clearTimeout(resetTimer.current);
    resetTimer.current = setTimeout(() => {
      if (mounted.current) setCopied(false);
    }, COPY_CONFIRMATION_MS);
    // Feedback, not function: a device without haptics still copied.
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch((error: unknown) => {
      logger.debug('Copy haptic unavailable', {
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }, [t, text]);

  return (
    <MessageActionButton
      accessibilityLabel={copied ? t('common.copied') : t('chat.copyMessage')}
      disabled={!text}
      onPress={() => {
        void copy();
      }}
      testID={props.testID}
    >
      {copied ? (
        <Check size={16} color={props.confirmedColor} />
      ) : (
        <Copy size={16} color={props.color} />
      )}
    </MessageActionButton>
  );
});
