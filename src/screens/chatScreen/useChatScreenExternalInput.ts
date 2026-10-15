import { useCallback } from 'react';
import type { RunChatOptions } from '../../engine/graph/foregroundRun/contracts';
import type { Attachment } from '../../types/attachment';
import { useIncomingChatRequest } from '../useIncomingChatRequest';
import { useIncomingShareIntoComposer } from '../useIncomingShareIntoComposer';
import { usePreparedChatDraft } from '../usePreparedChatDraft';
import { useVoiceConversationBridge } from './useVoiceConversationBridge';

export type ChatScreenExternalInputParams = Readonly<{
  incomingRequest?: unknown;
  preparedDraft?: unknown;
}>;

/**
 * What reaches the conversation from outside the composer: a draft another screen prepared,
 * shares from other apps (into the composer), turns spoken on the voice screen, and a
 * request Kavi was opened with ("Ask Kavi"). Spoken turns and requests are sent, and wait
 * in the composer if they could not be.
 */
export function useChatScreenExternalInput(params: {
  activeConversationId?: string | null;
  composerAttachments: Attachment[];
  composerText: string;
  editingMessageId: string | null;
  onChangeAttachments: (attachments: Attachment[]) => void;
  onChangeText: (text: string) => void;
  routeParams?: ChatScreenExternalInputParams;
  sendFromOutsideComposer: (text: string, runOptions?: RunChatOptions) => Promise<void>;
  setRouteParams: (params: Partial<Record<keyof ChatScreenExternalInputParams, undefined>>) => void;
}): void {
  const { routeParams, sendFromOutsideComposer, setRouteParams } = params;

  useVoiceConversationBridge(sendFromOutsideComposer);

  const clearPreparedDraft = useCallback(
    () => setRouteParams({ preparedDraft: undefined }),
    [setRouteParams],
  );
  usePreparedChatDraft({
    activeConversationId: params.activeConversationId,
    composerText: params.composerText,
    editingMessageId: params.editingMessageId,
    onApplyText: params.onChangeText,
    onConsumed: clearPreparedDraft,
    preparedDraft: routeParams?.preparedDraft,
  });

  useIncomingShareIntoComposer({
    composerAttachments: params.composerAttachments,
    composerText: params.composerText,
    onChangeAttachments: params.onChangeAttachments,
    onChangeText: params.onChangeText,
  });

  const clearIncomingRequest = useCallback(
    () => setRouteParams({ incomingRequest: undefined }),
    [setRouteParams],
  );
  useIncomingChatRequest({
    incomingRequest: routeParams?.incomingRequest,
    onConsumed: clearIncomingRequest,
    onSend: sendFromOutsideComposer,
  });
}
