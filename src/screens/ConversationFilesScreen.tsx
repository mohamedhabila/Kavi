import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { DrawerNavigationProp } from '@react-navigation/drawer';
import { RouteProp, useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
import { ConversationFiles } from '../components/files/ConversationFiles';
import { onSubAgentEvent, listActiveSubAgents } from '../services/agents/subAgent';
import { resolveOwningConversationId } from '../services/agents/lifecycle/stateMachine';
import { getConversationWorkspaceFallbackConversationIds } from '../services/conversationWorkspace/fallbacks';
import { useBackToChat } from '../navigation/useBackToChat';
import { normalizeConversationWorkspacePath } from '../services/files/pathUtils';
import { useChatStore } from '../store/useChatStore';

type ConversationFilesRouteParams = {
  ConversationFiles: {
    conversationId?: string | null;
    initialFilePath?: string | null;
    initialDirectoryPath?: string | null;
  };
};

function getParentWorkspacePath(path: string): string {
  const normalized = normalizeConversationWorkspacePath(path);
  if (!normalized || !normalized.includes('/')) {
    return '';
  }

  return normalized.split('/').slice(0, -1).join('/');
}

export const ConversationFilesScreen: React.FC = () => {
  const navigation = useNavigation<DrawerNavigationProp<any>>();
  const route = useRoute<RouteProp<ConversationFilesRouteParams, 'ConversationFiles'>>();
  const activeConversationId = useChatStore((state) => state.activeConversationId);
  const conversations = useChatStore((state) => state.conversations);
  const handleBack = useBackToChat();
  const [workspaceRefreshVersion, setWorkspaceRefreshVersion] = useState(0);

  const params = route.params ?? {};
  const conversationId = useMemo(() => {
    if (typeof params.conversationId === 'string' && params.conversationId.trim()) {
      return params.conversationId.trim();
    }

    return activeConversationId;
  }, [activeConversationId, params.conversationId]);

  const conversation = useMemo(
    () => conversations.find((candidate) => candidate.id === conversationId),
    [conversationId, conversations],
  );

  useFocusEffect(
    useCallback(() => {
      setWorkspaceRefreshVersion((value) => value + 1);
      return undefined;
    }, []),
  );

  useEffect(() => {
    if (!conversationId) {
      return undefined;
    }

    return onSubAgentEvent((agent) => {
      const ownerConversationId =
        resolveOwningConversationId(agent.sessionId, listActiveSubAgents()) ||
        agent.parentConversationId;

      if (ownerConversationId?.trim() !== conversationId) {
        return;
      }

      setWorkspaceRefreshVersion((value) => value + 1);
    });
  }, [conversationId]);

  const fallbackConversationIds = useMemo(
    () =>
      getConversationWorkspaceFallbackConversationIds({
        conversationId,
        messages: conversation?.messages,
        usageEntries: conversation?.usage?.entries,
        agentRuns: conversation?.agentRuns,
      }),
    [conversation?.agentRuns, conversation?.messages, conversation?.usage?.entries, conversationId],
  );
  const refreshToken = `${conversation?.updatedAt ?? 0}:${workspaceRefreshVersion}`;

  const handleOpenTextFile = useCallback(
    (filePath: string, content: string, sourceConversationId?: string) => {
      const editorConversationId = sourceConversationId?.trim() || conversationId;
      if (!conversationId || !editorConversationId) {
        return;
      }

      navigation.navigate('CodeEditor' as any, {
        source: 'local',
        conversationId: editorConversationId,
        filePath,
        content,
        returnToConversationFiles: {
          conversationId,
          initialDirectoryPath: getParentWorkspacePath(filePath),
        },
      });
    },
    [conversationId, navigation],
  );

  return (
    <ConversationFiles
      visible={true}
      presentation="screen"
      onClose={handleBack}
      conversationId={conversationId}
      fallbackConversationIds={fallbackConversationIds}
      refreshToken={refreshToken}
      initialFilePath={params.initialFilePath}
      initialDirectoryPath={params.initialDirectoryPath}
      onOpenTextFile={handleOpenTextFile}
    />
  );
};
