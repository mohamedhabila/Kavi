import { useEffect, useRef } from 'react';
import { Alert, Image } from 'react-native';
import { File } from 'expo-file-system';
import { useIncomingShare } from 'expo-sharing';
import { useTranslation } from '../i18n/useTranslation';
import { prepareComposerImageAttachment } from '../services/media/composerImage';
import {
  buildIncomingShareInput,
  type IncomingShareDependencies,
} from '../services/share/incomingShare';
import type { Attachment } from '../types/attachment';
import { generateId } from '../utils/id';
import { createLogger } from '../utils/logger';

const logger = createLogger('IncomingShare');

const SHARE_DEPENDENCIES: IncomingShareDependencies = {
  createId: generateId,
  fileExists: (uri) => {
    try {
      return new File(uri).exists;
    } catch {
      return false;
    }
  },
  measureImage: (uri) => Image.getSize(uri),
  prepareImage: prepareComposerImageAttachment,
};

/**
 * Puts what another app shared into Kavi into the composer: its text after any draft text,
 * its photos and files after any draft attachments. Anything Kavi could not open is named
 * in an alert rather than attached broken. The shared data is then cleared, so the next
 * share (even of the same thing) arrives on its own.
 */
export function useIncomingShareIntoComposer(params: {
  composerAttachments: Attachment[];
  composerText: string;
  onChangeAttachments: (attachments: Attachment[]) => void;
  onChangeText: (text: string) => void;
}): void {
  const { resolvedSharedPayloads, clearSharedPayloads, refreshSharePayloads } = useIncomingShare();
  const { t } = useTranslation();
  const latestRef = useRef({ ...params, t });
  latestRef.current = { ...params, t };

  useEffect(() => {
    if (resolvedSharedPayloads.length === 0) return;
    let cancelled = false;
    void buildIncomingShareInput(resolvedSharedPayloads, SHARE_DEPENDENCIES)
      .then((input) => {
        if (cancelled) return;
        const composer = latestRef.current;
        if (input.text) {
          composer.onChangeText(
            composer.composerText ? `${composer.composerText}\n\n${input.text}` : input.text,
          );
        }
        if (input.attachments.length > 0) {
          composer.onChangeAttachments([...composer.composerAttachments, ...input.attachments]);
        }
        if (input.unreadableCount > 0) {
          Alert.alert(composer.t('chat.sharedItemsUnreadable', { count: input.unreadableCount }));
        }
        clearSharedPayloads();
        refreshSharePayloads();
      })
      .catch((error: unknown) => {
        logger.warn('Could not add shared content to the composer.', { error: String(error) });
      });
    return () => {
      cancelled = true;
    };
  }, [clearSharedPayloads, refreshSharePayloads, resolvedSharedPayloads]);
}
