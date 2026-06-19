import { useChatStore } from '../../store/useChatStore';
import { useSettingsStore } from '../../store/useSettingsStore';
import type { WorkspaceTargetConfig } from '../../types/remote';
import { resolveWorkspaceTarget } from './config';

export type WorkspaceSource =
  | {
      kind: 'conversation';
      conversationId: string;
      fallbackConversationId?: string;
    }
  | {
      kind: 'target';
      target: WorkspaceTargetConfig;
    };

function normalizeId(value: string | undefined): string | undefined {
  const normalized = typeof value === 'string' ? value.trim() : '';
  return normalized || undefined;
}

export function resolveConversationWorkspaceSource(
  conversationId: string,
  fallbackConversationId?: string,
): WorkspaceSource {
  const normalizedConversationId = normalizeId(conversationId);
  if (!normalizedConversationId) {
    throw new Error('conversationId is required');
  }

  const conversation = useChatStore
    .getState()
    .conversations.find((entry) => entry.id === normalizedConversationId);
  const settings = useSettingsStore.getState();

  if (conversation) {
    const target = resolveWorkspaceTarget({
      workspaceTargetId: conversation.workspaceTargetId,
      defaultWorkspaceTargetId: settings.defaultWorkspaceTargetId,
      workspaceTargets: settings.workspaceTargets,
    });
    if (target) {
      return { kind: 'target', target };
    }
  }

  return {
    kind: 'conversation',
    conversationId: normalizedConversationId,
    ...(normalizeId(fallbackConversationId)
      ? { fallbackConversationId: normalizeId(fallbackConversationId) }
      : {}),
  };
}
